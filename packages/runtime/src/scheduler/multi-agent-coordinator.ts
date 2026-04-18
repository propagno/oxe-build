import { appendEvent } from '../events/bus';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { TaskExecutor, TaskResult, SchedulerContext } from './scheduler';
import { Scheduler } from './scheduler';
import type { WorkspaceLease } from '../models/workspace';

export type CoordinationMode = 'parallel' | 'competitive' | 'cooperative';

export interface AgentSpec {
  id: string;
  executor: TaskExecutor;
  workspaceManager: WorkspaceManager;
  /** Task IDs this agent is responsible for (used in parallel mode) */
  assignedTaskIds?: string[];
}

export interface CoordinationOptions {
  mode: CoordinationMode;
  agents: AgentSpec[];
  projectRoot: string;
  sessionId: string | null;
  runId: string;
  onEvent?: SchedulerContext['onEvent'];
}

export interface CoordinationResult {
  mode: CoordinationMode;
  run_id: string;
  completed: string[];
  failed: string[];
  blocked: string[];
  agent_results: Array<{ agent_id: string; completed: string[]; failed: string[] }>;
}

// ─── Parallel mode ───────────────────────────────────────────────────────────
// Tasks are partitioned across agents. Each agent runs its own Scheduler
// on a sub-graph. Results are merged.

async function runParallel(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  const { agents, projectRoot, sessionId, runId } = opts;

  // Partition tasks across agents (round-robin if assignedTaskIds not set)
  const partitions = agents.map((a) => a.assignedTaskIds ?? []);
  if (partitions.every((p) => p.length === 0)) {
    const allIds = [...graph.nodes.keys()];
    allIds.forEach((id, i) => {
      partitions[i % agents.length].push(id);
    });
  }

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'parallel', agent_count: agents.length },
  });

  const agentResults = await Promise.all(
    agents.map(async (agent, idx) => {
      const subGraph = subGraphFor(graph, partitions[idx]);
      if (subGraph.nodes.size === 0) {
        return { agent_id: agent.id, completed: [], failed: [] };
      }
      const ctx: SchedulerContext = {
        projectRoot,
        sessionId,
        runId: `${runId}-agent${idx}`,
        executor: agent.executor,
        workspaceManager: agent.workspaceManager,
        onEvent: opts.onEvent,
      };
      const scheduler = new Scheduler();
      const result = await scheduler.run(subGraph, ctx);
      return { agent_id: agent.id, completed: result.completed, failed: result.failed };
    })
  );

  const completed = agentResults.flatMap((r) => r.completed);
  const failed = agentResults.flatMap((r) => r.failed);

  appendEvent(projectRoot, sessionId, {
    type: 'RunCompleted',
    run_id: runId,
    payload: { mode: 'parallel', completed: completed.length, failed: failed.length },
  });

  return { mode: 'parallel', run_id: runId, completed, failed, blocked: [], agent_results: agentResults };
}

// ─── Competitive mode ────────────────────────────────────────────────────────
// Two agents attempt the same task. First success wins; the loser's workspace
// is disposed. Requires exactly 2 agents.

async function runCompetitive(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  if (opts.agents.length < 2) {
    throw new Error('Competitive mode requires at least 2 agents');
  }
  const [agentA, agentB] = opts.agents;
  const { projectRoot, sessionId, runId } = opts;

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'competitive' },
  });

  const completed: string[] = [];
  const failed: string[] = [];

  for (const wave of graph.waves) {
    for (const nodeId of wave.node_ids) {
      const node = graph.nodes.get(nodeId)!;
      const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts);
      if (result.success) completed.push(nodeId);
      else failed.push(nodeId);
      if (failed.length > 0) break;
    }
    if (failed.length > 0) break;
  }

  appendEvent(projectRoot, sessionId, {
    type: 'RunCompleted',
    run_id: runId,
    payload: { mode: 'competitive', completed: completed.length },
  });

  return {
    mode: 'competitive',
    run_id: runId,
    completed,
    failed,
    blocked: [],
    agent_results: [
      { agent_id: agentA.id, completed, failed },
      { agent_id: agentB.id, completed: [], failed: [] },
    ],
  };
}

async function competeTwoAgents(
  nodeId: string,
  node: GraphNode,
  agentA: AgentSpec,
  agentB: AgentSpec,
  opts: CoordinationOptions
): Promise<TaskResult> {
  const { projectRoot, sessionId, runId } = opts;

  const allocA = await agentA.workspaceManager.allocate({
    work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
  });
  const allocB = await agentB.workspaceManager.allocate({
    work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
  });

  appendEvent(projectRoot, sessionId, {
    type: 'AttemptStarted',
    run_id: runId,
    work_item_id: nodeId,
    payload: { mode: 'competitive', agents: [agentA.id, agentB.id] },
  });

  // Race both agents — first success wins
  const [resultA, resultB] = await Promise.all([
    agentA.executor.execute(node, allocA, runId, 1).catch((e) => ({
      success: false, failure_class: 'env' as const, evidence: [], output: String(e),
    })),
    agentB.executor.execute(node, allocB, runId, 1).catch((e) => ({
      success: false, failure_class: 'env' as const, evidence: [], output: String(e),
    })),
  ]);

  // Clean up both workspaces
  await Promise.all([
    agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => {}),
    agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => {}),
  ]);

  // Pick winner: prefer success; if both succeed, prefer A (primary agent)
  const winner = resultA.success ? resultA : resultB.success ? resultB : resultA;

  if (winner.success) {
    appendEvent(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive' } });
  } else {
    appendEvent(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', failure_class: winner.failure_class } });
  }

  return winner;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class MultiAgentCoordinator {
  async run(graph: ExecutionGraph, opts: CoordinationOptions): Promise<CoordinationResult> {
    switch (opts.mode) {
      case 'parallel': return runParallel(graph, opts);
      case 'competitive': return runCompetitive(graph, opts);
      case 'cooperative':
        // Cooperative mode: planner (agent[0]) prepares context,
        // executor (agent[1]) implements. For R3, delegate to sequential parallel.
        return runParallel(graph, { ...opts, mode: 'parallel' });
      default:
        throw new Error(`Unknown coordination mode: ${opts.mode}`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function subGraphFor(graph: ExecutionGraph, nodeIds: string[]): ExecutionGraph {
  const ids = new Set(nodeIds);
  const nodes = new Map([...graph.nodes].filter(([id]) => ids.has(id)));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const waves = graph.waves.map((w) => ({
    wave_number: w.wave_number,
    node_ids: w.node_ids.filter((id) => ids.has(id)),
  })).filter((w) => w.node_ids.length > 0);

  return {
    nodes,
    edges,
    waves,
    metadata: { ...graph.metadata, node_count: nodes.size, wave_count: waves.length },
  };
}
