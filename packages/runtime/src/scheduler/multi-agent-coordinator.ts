import fs from 'fs';
import path from 'path';
import { appendEvent } from '../events/bus';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { TaskExecutor, TaskResult, SchedulerContext } from './scheduler';
import { Scheduler } from './scheduler';
import { buildHandoff } from './agent-roles';
import type { CooperativeHandoff } from './agent-roles';

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

export interface ArbitrationRecord {
  work_item_id: string;
  mode: CoordinationMode;
  winner_agent_id: string | null;
  participant_agent_ids: string[];
  success: boolean;
  failure_class: TaskResult['failure_class'];
  evidence_count: number;
  recorded_at: string;
}

export interface MultiAgentOwnership {
  work_item_id: string;
  owner_agent_id: string;
}

export interface MultiAgentStatusSnapshot {
  run_id: string;
  mode: CoordinationMode;
  workspace_isolation_required: 'isolated';
  workspace_isolation_enforced: boolean;
  agent_count: number;
  ownership: MultiAgentOwnership[];
  completed: string[];
  failed: string[];
  blocked: string[];
  agent_results: Array<{
    agent_id: string;
    isolation_level: 'shared' | 'isolated';
    assigned_task_ids: string[];
    completed: string[];
    failed: string[];
  }>;
  orphan_reassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }>;
  updated_at: string;
}

export interface CoordinationResult {
  mode: CoordinationMode;
  run_id: string;
  completed: string[];
  failed: string[];
  blocked: string[];
  agent_results: Array<{ agent_id: string; completed: string[]; failed: string[] }>;
  handoffs?: CooperativeHandoff[];
  arbitration_results?: ArbitrationRecord[];
  state?: MultiAgentStatusSnapshot;
}

function ensureRunDir(projectRoot: string, runId: string): string {
  const dir = path.join(projectRoot, '.oxe', 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function persistMultiAgentArtifacts(
  projectRoot: string,
  runId: string,
  state: MultiAgentStatusSnapshot,
  handoffs: CooperativeHandoff[] = [],
  arbitrationResults: ArbitrationRecord[] = []
): void {
  const runDir = ensureRunDir(projectRoot, runId);
  fs.writeFileSync(path.join(runDir, 'multi-agent-state.json'), JSON.stringify(state, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'handoffs.json'), JSON.stringify(handoffs, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'arbitration-results.json'), JSON.stringify(arbitrationResults, null, 2), 'utf8');
}

function ensureIsolatedAgents(agents: AgentSpec[]): void {
  const shared = agents.filter((agent) => agent.workspaceManager.isolation_level !== 'isolated');
  if (shared.length === 0) return;
  const ids = shared.map((agent) => `${agent.id}:${agent.workspaceManager.isolation_level}`).join(', ');
  throw new Error(`Multi-agent requires isolated workspaces. Invalid agents: ${ids}`);
}

function buildOwnership(agents: AgentSpec[], partitions: string[][]): MultiAgentOwnership[] {
  const ownership: MultiAgentOwnership[] = [];
  for (let idx = 0; idx < agents.length; idx += 1) {
    for (const workItemId of partitions[idx] ?? []) {
      ownership.push({
        work_item_id: workItemId,
        owner_agent_id: agents[idx].id,
      });
    }
  }
  return ownership;
}

function makeState(
  mode: CoordinationMode,
  runId: string,
  agents: AgentSpec[],
  partitions: string[][],
  agentResults: Array<{ agent_id: string; completed: string[]; failed: string[] }>,
  completed: string[],
  failed: string[],
  blocked: string[],
  orphanReassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }>
): MultiAgentStatusSnapshot {
  return {
    run_id: runId,
    mode,
    workspace_isolation_required: 'isolated',
    workspace_isolation_enforced: true,
    agent_count: agents.length,
    ownership: buildOwnership(agents, partitions),
    completed,
    failed,
    blocked,
    agent_results: agents.map((agent, idx) => {
      const result = agentResults.find((entry) => entry.agent_id === agent.id);
      return {
        agent_id: agent.id,
        isolation_level: agent.workspaceManager.isolation_level,
        assigned_task_ids: partitions[idx] ?? agent.assignedTaskIds ?? [],
        completed: result?.completed ?? [],
        failed: result?.failed ?? [],
      };
    }),
    orphan_reassignments: orphanReassignments,
    updated_at: new Date().toISOString(),
  };
}

// ─── Parallel mode ───────────────────────────────────────────────────────────

async function runParallel(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  const { agents, projectRoot, sessionId, runId } = opts;
  ensureIsolatedAgents(agents);

  const partitions = agents.map((agent) => [...(agent.assignedTaskIds ?? [])]);
  if (partitions.every((partition) => partition.length === 0)) {
    const allIds = [...graph.nodes.keys()];
    allIds.forEach((id, index) => {
      partitions[index % agents.length].push(id);
    });
  }

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'parallel', agent_count: agents.length, isolation_level: 'isolated' },
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

  const completed = agentResults.flatMap((result) => result.completed);
  const failed = agentResults.flatMap((result) => result.failed);
  const blocked: string[] = [];
  const orphanReassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }> = [];
  const state = makeState('parallel', runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments);
  persistMultiAgentArtifacts(projectRoot, runId, state);

  appendEvent(projectRoot, sessionId, {
    type: 'RunCompleted',
    run_id: runId,
    payload: { mode: 'parallel', completed: completed.length, failed: failed.length },
  });

  return {
    mode: 'parallel',
    run_id: runId,
    completed,
    failed,
    blocked,
    agent_results: agentResults,
    arbitration_results: [],
    state,
  };
}

// ─── Competitive mode ────────────────────────────────────────────────────────

async function runCompetitive(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  if (opts.agents.length < 2) {
    throw new Error('Competitive mode requires at least 2 agents');
  }
  ensureIsolatedAgents(opts.agents);
  const [agentA, agentB] = opts.agents;
  const { projectRoot, sessionId, runId } = opts;

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'competitive', isolation_level: 'isolated' },
  });

  const completed: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];
  const arbitrationResults: ArbitrationRecord[] = [];

  for (const wave of graph.waves) {
    for (const nodeId of wave.node_ids) {
      const node = graph.nodes.get(nodeId)!;
      const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults);
      if (result.success) completed.push(nodeId);
      else failed.push(nodeId);
      if (failed.length > 0) break;
    }
    if (failed.length > 0) break;
  }

  const partitions = [Array.from(graph.nodes.keys()), Array.from(graph.nodes.keys())];
  const state = makeState(
    'competitive',
    runId,
    opts.agents,
    partitions,
    [
      { agent_id: agentA.id, completed, failed },
      { agent_id: agentB.id, completed: [], failed: [] },
    ],
    completed,
    failed,
    blocked,
    []
  );
  persistMultiAgentArtifacts(projectRoot, runId, state, [], arbitrationResults);

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
    blocked,
    agent_results: [
      { agent_id: agentA.id, completed, failed },
      { agent_id: agentB.id, completed: [], failed: [] },
    ],
    arbitration_results: arbitrationResults,
    state,
  };
}

async function competeTwoAgents(
  nodeId: string,
  node: GraphNode,
  agentA: AgentSpec,
  agentB: AgentSpec,
  opts: CoordinationOptions,
  arbitrationResults: ArbitrationRecord[]
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

  const [resultA, resultB] = await Promise.all([
    agentA.executor.execute(node, allocA, runId, 1).catch((error) => ({
      success: false, failure_class: 'env' as const, evidence: [], output: String(error),
    })),
    agentB.executor.execute(node, allocB, runId, 1).catch((error) => ({
      success: false, failure_class: 'env' as const, evidence: [], output: String(error),
    })),
  ]);

  await Promise.all([
    agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => {}),
    agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => {}),
  ]);

  const winner = resultA.success ? resultA : resultB.success ? resultB : resultA;
  const winnerAgentId = resultA.success ? agentA.id : resultB.success ? agentB.id : agentA.id;
  arbitrationResults.push({
    work_item_id: nodeId,
    mode: 'competitive',
    winner_agent_id: winnerAgentId,
    participant_agent_ids: [agentA.id, agentB.id],
    success: winner.success,
    failure_class: winner.failure_class,
    evidence_count: winner.evidence.length,
    recorded_at: new Date().toISOString(),
  });

  if (winner.success) {
    appendEvent(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', winner_agent_id: winnerAgentId } });
  } else {
    appendEvent(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', failure_class: winner.failure_class, winner_agent_id: winnerAgentId } });
  }

  return winner;
}

// ─── Cooperative mode ────────────────────────────────────────────────────────

async function runCooperative(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  if (opts.agents.length < 2) {
    throw new Error('Cooperative mode requires at least 2 agents');
  }
  ensureIsolatedAgents(opts.agents);
  const [planner, executor] = opts.agents;
  const { projectRoot, sessionId, runId } = opts;
  const handoffs: CooperativeHandoff[] = [];

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'cooperative', planner: planner.id, executor: executor.id, isolation_level: 'isolated' },
  });

  const completed: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];

  for (const wave of graph.waves) {
    for (const nodeId of wave.node_ids) {
      const node = graph.nodes.get(nodeId)!;

      const planAlloc = await planner.workspaceManager.allocate({
        work_item_id: nodeId,
        attempt_number: 1,
        strategy: node.workspace_strategy,
        mutation_scope: node.mutation_scope,
      });
      await planner.workspaceManager.dispose(planAlloc.workspace_id).catch(() => {});

      const handoff = buildHandoff({
        from_agent_id: planner.id,
        to_agent_id: executor.id,
        from_role: 'planner',
        to_role: 'executor',
        work_item_id: nodeId,
        context_pack_ref: null,
      });
      handoffs.push(handoff);

      appendEvent(projectRoot, sessionId, {
        type: 'AttemptStarted',
        run_id: runId,
        work_item_id: nodeId,
        payload: { mode: 'cooperative', handoff_id: handoff.handoff_id },
      });

      const execAlloc = await executor.workspaceManager.allocate({
        work_item_id: nodeId,
        attempt_number: 1,
        strategy: node.workspace_strategy,
        mutation_scope: node.mutation_scope,
      });

      let result: TaskResult;
      try {
        result = await executor.executor.execute(node, execAlloc, runId, 1);
      } catch (error) {
        result = { success: false, failure_class: 'env', evidence: [], output: String(error) };
      }
      await executor.workspaceManager.dispose(execAlloc.workspace_id).catch(() => {});

      if (result.success) {
        completed.push(nodeId);
        appendEvent(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'cooperative' } });
      } else {
        failed.push(nodeId);
        appendEvent(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'cooperative', failure_class: result.failure_class } });
        break;
      }
    }
    if (failed.length > 0) break;
  }

  const partitions = [Array.from(graph.nodes.keys()), Array.from(graph.nodes.keys())];
  const state = makeState(
    'cooperative',
    runId,
    opts.agents,
    partitions,
    [
      { agent_id: planner.id, completed: [], failed: [] },
      { agent_id: executor.id, completed, failed },
    ],
    completed,
    failed,
    blocked,
    []
  );
  persistMultiAgentArtifacts(projectRoot, runId, state, handoffs, []);

  appendEvent(projectRoot, sessionId, {
    type: 'RunCompleted',
    run_id: runId,
    payload: { mode: 'cooperative', completed: completed.length, failed: failed.length },
  });

  return {
    mode: 'cooperative',
    run_id: runId,
    completed,
    failed,
    blocked,
    agent_results: [
      { agent_id: planner.id, completed: [], failed: [] },
      { agent_id: executor.id, completed, failed },
    ],
    handoffs,
    arbitration_results: [],
    state,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class MultiAgentCoordinator {
  async run(graph: ExecutionGraph, opts: CoordinationOptions): Promise<CoordinationResult> {
    switch (opts.mode) {
      case 'parallel': return runParallel(graph, opts);
      case 'competitive': return runCompetitive(graph, opts);
      case 'cooperative': return runCooperative(graph, opts);
      default:
        throw new Error(`Unknown coordination mode: ${opts.mode}`);
    }
  }
}

export function multiAgentStatePath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'multi-agent-state.json');
}

export function loadMultiAgentState(projectRoot: string, runId: string): MultiAgentStatusSnapshot | null {
  const statePath = multiAgentStatePath(projectRoot, runId);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as MultiAgentStatusSnapshot;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function subGraphFor(graph: ExecutionGraph, nodeIds: string[]): ExecutionGraph {
  const ids = new Set(nodeIds);
  const nodes = new Map([...graph.nodes].filter(([id]) => ids.has(id)));
  const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const waves = graph.waves
    .map((wave) => ({
      wave_number: wave.wave_number,
      node_ids: wave.node_ids.filter((id) => ids.has(id)),
    }))
    .filter((wave) => wave.node_ids.length > 0);

  return {
    nodes,
    edges,
    waves,
    metadata: { ...graph.metadata, node_count: nodes.size, wave_count: waves.length },
  };
}
