import fs from 'fs';
import path from 'path';
import { appendEvent } from '../events/bus';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace/workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../models/workspace';
import type { TaskExecutor, TaskResult, SchedulerContext, RunResult } from './scheduler';
import { Scheduler } from './scheduler';
import { buildHandoff } from './agent-roles';
import type { CooperativeHandoff } from './agent-roles';
import { AgentRegistry } from './agent-registry';

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
  heartbeatTimeoutMs?: number;
  applyWorkspaceMerges?: boolean;
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

export interface WorkspaceMergeRecord {
  work_item_id: string;
  agent_id: string;
  workspace_id: string;
  strategy: string;
  isolation_level: 'shared' | 'isolated';
  branch: string | null;
  base_commit: string | null;
  root_path: string | null;
  mutation_scope: string[];
  diff_paths: string[];
  evidence_count: number;
  verify_status: 'pass' | 'fail' | 'partial';
  status: 'ready' | 'merged' | 'blocked' | 'skipped';
  blocker: string | null;
  recorded_at: string;
}

export interface WorkspaceMergeReport {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  workspace_isolation: 'git_worktree';
  merge_readiness: 'ready' | 'blocked' | 'partial';
  arbitration_required: boolean;
  blockers: string[];
  records: WorkspaceMergeRecord[];
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
    timed_out: boolean;
    reassigned_task_ids: string[];
  }>;
  worktrees: WorkspaceMergeRecord[];
  workspace_merge: WorkspaceMergeReport;
  merge_blockers: string[];
  arbitration_required: boolean;
  orphan_reassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }>;
  timed_out_agents: Array<{ agent_id: string; work_item_ids: string[]; detected_at: string }>;
  updated_at: string;
}

export interface MultiAgentOperationalSummary {
  run_id: string;
  mode: CoordinationMode;
  workspace_isolation_enforced: boolean;
  agent_count: number;
  completed_count: number;
  failed_count: number;
  blocked_count: number;
  ownership_count: number;
  handoff_count: number;
  arbitration_count: number;
  orphan_reassignment_count: number;
  timeout_count: number;
  participating_agents: string[];
  workspace_isolation: 'git_worktree';
  merge_readiness: WorkspaceMergeReport['merge_readiness'];
  arbitration_required: boolean;
  merge_blocker_count: number;
  health: 'healthy' | 'degraded';
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
  workspace_merge_report?: WorkspaceMergeReport;
  state?: MultiAgentStatusSnapshot;
  summary?: MultiAgentOperationalSummary;
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
  arbitrationResults: ArbitrationRecord[] = [],
  workspaceMergeReport: WorkspaceMergeReport = emptyWorkspaceMergeReport(runId)
): void {
  const runDir = ensureRunDir(projectRoot, runId);
  fs.writeFileSync(path.join(runDir, 'multi-agent-state.json'), JSON.stringify(state, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'handoffs.json'), JSON.stringify(handoffs, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'arbitration-results.json'), JSON.stringify(arbitrationResults, null, 2), 'utf8');
  fs.writeFileSync(path.join(runDir, 'workspace-merge-report.json'), JSON.stringify(workspaceMergeReport, null, 2), 'utf8');
  const summary: MultiAgentOperationalSummary = {
    run_id: state.run_id,
    mode: state.mode,
    workspace_isolation_enforced: state.workspace_isolation_enforced,
    agent_count: state.agent_count,
    completed_count: state.completed.length,
    failed_count: state.failed.length,
    blocked_count: state.blocked.length,
    ownership_count: state.ownership.length,
    handoff_count: handoffs.length,
    arbitration_count: arbitrationResults.length,
    orphan_reassignment_count: state.orphan_reassignments.length,
    timeout_count: state.timed_out_agents.length,
    participating_agents: state.agent_results.map((entry) => entry.agent_id),
    workspace_isolation: 'git_worktree',
    merge_readiness: workspaceMergeReport.merge_readiness,
    arbitration_required: workspaceMergeReport.arbitration_required,
    merge_blocker_count: workspaceMergeReport.blockers.length,
    health: state.timed_out_agents.length > 0 || state.failed.length > 0 ? 'degraded' : 'healthy',
    updated_at: state.updated_at,
  };
  fs.writeFileSync(path.join(runDir, 'multi-agent-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
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
  agentResults: Array<{ agent_id: string; completed: string[]; failed: string[]; timed_out: boolean; reassigned_task_ids: string[] }>,
  completed: string[],
  failed: string[],
  blocked: string[],
  orphanReassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }>,
  timedOutAgents: Array<{ agent_id: string; work_item_ids: string[]; detected_at: string }>,
  workspaceMergeReport: WorkspaceMergeReport = emptyWorkspaceMergeReport(runId)
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
        timed_out: Boolean(result?.timed_out),
        reassigned_task_ids: result?.reassigned_task_ids ?? [],
      };
    }),
    worktrees: workspaceMergeReport.records,
    workspace_merge: workspaceMergeReport,
    merge_blockers: workspaceMergeReport.blockers,
    arbitration_required: workspaceMergeReport.arbitration_required,
    orphan_reassignments: orphanReassignments,
    timed_out_agents: timedOutAgents,
    updated_at: new Date().toISOString(),
  };
}

function emptyWorkspaceMergeReport(runId: string): WorkspaceMergeReport {
  return {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    workspace_isolation: 'git_worktree',
    merge_readiness: 'ready',
    arbitration_required: false,
    blockers: [],
    records: [],
  };
}

function ensureGitWorktreeLease(agent: AgentSpec, lease: WorkspaceLease): void {
  if (lease.isolation_level !== 'isolated' || lease.strategy !== 'git_worktree') {
    throw new Error(`Multi-agent real requires git_worktree isolated workspace. Agent ${agent.id} received ${lease.strategy}/${lease.isolation_level}.`);
  }
}

function mutationScopeOf(node?: GraphNode): string[] {
  return Array.isArray(node?.mutation_scope) ? node!.mutation_scope.map(String).filter(Boolean) : [];
}

function createMergeRecord(
  agent: AgentSpec,
  node: GraphNode,
  lease: WorkspaceLease,
  result?: TaskResult
): WorkspaceMergeRecord {
  const evidenceCount = Array.isArray(result?.evidence) ? result!.evidence.length : 0;
  return {
    work_item_id: node.id,
    agent_id: agent.id,
    workspace_id: lease.workspace_id,
    strategy: lease.strategy,
    isolation_level: lease.isolation_level,
    branch: lease.branch ?? null,
    base_commit: lease.base_commit ?? null,
    root_path: lease.root_path ?? null,
    mutation_scope: mutationScopeOf(node),
    diff_paths: mutationScopeOf(node),
    evidence_count: evidenceCount,
    verify_status: result ? (result.success ? 'pass' : 'fail') : 'partial',
    status: result ? (result.success ? 'ready' : 'blocked') : 'ready',
    blocker: result && !result.success ? `verify_failed:${result.failure_class}` : null,
    recorded_at: new Date().toISOString(),
  };
}

function buildWorkspaceMergeReport(
  runId: string,
  records: WorkspaceMergeRecord[],
  extraBlockers: string[] = [],
  arbitrationRequired = false
): WorkspaceMergeReport {
  const blockers = [
    ...extraBlockers,
    ...records.filter((record) => record.status === 'blocked' && record.blocker).map((record) => `${record.work_item_id}:${record.blocker}`),
  ];
  return {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    workspace_isolation: 'git_worktree',
    merge_readiness: blockers.length > 0 ? 'blocked' : records.some((record) => record.status === 'ready') ? 'partial' : 'ready',
    arbitration_required: arbitrationRequired,
    blockers,
    records,
  };
}

function detectMutationConflicts(graph: ExecutionGraph, agents: AgentSpec[], partitions: string[][]): string[] {
  const owners = new Map<string, string>();
  const conflicts: string[] = [];
  for (let idx = 0; idx < agents.length; idx += 1) {
    for (const nodeId of partitions[idx] ?? []) {
      const node = graph.nodes.get(nodeId);
      for (const scope of mutationScopeOf(node)) {
        const previous = owners.get(scope);
        if (previous && previous !== agents[idx].id) {
          conflicts.push(`mutation_scope_overlap:${scope}:${previous}:${agents[idx].id}`);
        } else {
          owners.set(scope, agents[idx].id);
        }
      }
    }
  }
  return conflicts;
}

function applyWorkspaceRecord(projectRoot: string, record: WorkspaceMergeRecord): WorkspaceMergeRecord {
  if (!record.root_path || record.status !== 'ready') return record;
  for (const relativePath of record.mutation_scope) {
    const source = path.join(record.root_path, relativePath);
    const target = path.join(projectRoot, relativePath);
    if (!fs.existsSync(source) || fs.statSync(source).isDirectory()) {
      return { ...record, status: 'blocked', blocker: `missing_output:${relativePath}` };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return { ...record, status: 'merged', blocker: null };
}

function createTrackingWorkspaceManager(
  base: WorkspaceManager,
  agent: AgentSpec,
  graph: ExecutionGraph,
  records: WorkspaceMergeRecord[]
): WorkspaceManager & { disposeDeferred(): Promise<void> } {
  const leases = new Map<string, WorkspaceLease>();
  return {
    isolation_level: base.isolation_level,
    allocate: async (req: WorkspaceRequest) => {
      const lease = await base.allocate(req);
      ensureGitWorktreeLease(agent, lease);
      leases.set(lease.workspace_id, lease);
      const node = graph.nodes.get(req.work_item_id);
      if (node) records.push(createMergeRecord(agent, node, lease));
      return lease;
    },
    snapshot: (id: string): Promise<SnapshotRef> => base.snapshot(id),
    reset: (id: string, snapRef: SnapshotRef): Promise<void> => base.reset(id, snapRef),
    dispose: async () => {
      // Scheduler calls dispose before the coordinator can reconcile diffs.
      // Defer real cleanup until the merge report has been produced.
    },
    disposeDeferred: async () => {
      await Promise.all([...leases.keys()].map((id) => base.dispose(id).catch(() => {})));
      leases.clear();
    },
  };
}

async function runGraphForAgent(
  graph: ExecutionGraph,
  nodeIds: string[],
  agent: AgentSpec,
  idx: number,
  opts: CoordinationOptions,
  heartbeatTimeoutMs: number | null
): Promise<{
  agent_id: string;
  completed: string[];
  failed: string[];
  timed_out: boolean;
  assigned_task_ids: string[];
  reassigned_task_ids: string[];
  workspace_records: WorkspaceMergeRecord[];
  cleanup: () => Promise<void>;
}> {
  const subGraph = subGraphFor(graph, nodeIds);
  const workspaceRecords: WorkspaceMergeRecord[] = [];
  if (subGraph.nodes.size === 0) {
    return {
      agent_id: agent.id,
      completed: [],
      failed: [],
      timed_out: false,
      assigned_task_ids: nodeIds,
      reassigned_task_ids: [],
      workspace_records: workspaceRecords,
      cleanup: async () => {},
    };
  }
  const trackingWorkspaceManager = createTrackingWorkspaceManager(agent.workspaceManager, agent, graph, workspaceRecords);
  const ctx: SchedulerContext = {
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    runId: `${opts.runId}-agent${idx}`,
    executor: agent.executor,
    workspaceManager: trackingWorkspaceManager,
    onEvent: opts.onEvent,
  };
  const scheduler = new Scheduler();
  const work = scheduler.run(subGraph, ctx);
  if (!heartbeatTimeoutMs || heartbeatTimeoutMs <= 0) {
    const result = await work;
    return {
      agent_id: agent.id,
      completed: result.completed,
      failed: result.failed,
      timed_out: false,
      assigned_task_ids: nodeIds,
      reassigned_task_ids: [],
      workspace_records: workspaceRecords,
      cleanup: () => trackingWorkspaceManager.disposeDeferred(),
    };
  }
  let timer: NodeJS.Timeout | null = null;
  const raced: { type: 'result'; result: RunResult } | { type: 'timeout' } = await Promise.race([
    work.then((result) => ({ type: 'result' as const, result })),
    new Promise<{ type: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ type: 'timeout' }), heartbeatTimeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (raced && raced.type === 'timeout') {
    return {
      agent_id: agent.id,
      completed: [],
      failed: [],
      timed_out: true,
      assigned_task_ids: nodeIds,
      reassigned_task_ids: [],
      workspace_records: workspaceRecords,
      cleanup: () => trackingWorkspaceManager.disposeDeferred(),
    };
  }
  const result = raced.result;
  return {
    agent_id: agent.id,
    completed: result.completed,
    failed: result.failed,
    timed_out: false,
    assigned_task_ids: nodeIds,
    reassigned_task_ids: [],
    workspace_records: workspaceRecords,
    cleanup: () => trackingWorkspaceManager.disposeDeferred(),
  };
}

// ─── Parallel mode ───────────────────────────────────────────────────────────

async function runParallel(
  graph: ExecutionGraph,
  opts: CoordinationOptions
): Promise<CoordinationResult> {
  const { agents, projectRoot, sessionId, runId } = opts;
  ensureIsolatedAgents(agents);
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? null;

  const partitions = agents.map((agent) => [...(agent.assignedTaskIds ?? [])]);
  if (partitions.every((partition) => partition.length === 0)) {
    const allIds = [...graph.nodes.keys()];
    allIds.forEach((id, index) => {
      partitions[index % agents.length].push(id);
    });
  }
  const mutationConflicts = detectMutationConflicts(graph, agents, partitions);
  if (mutationConflicts.length > 0) {
    const blocked = mutationConflicts;
    const workspaceMergeReport = buildWorkspaceMergeReport(runId, [], blocked);
    const state = makeState('parallel', runId, agents, partitions, [], [], [], blocked, [], [], workspaceMergeReport);
    persistMultiAgentArtifacts(projectRoot, runId, state, [], [], workspaceMergeReport);
    appendEvent(projectRoot, sessionId, {
      type: 'WorkItemBlocked',
      run_id: runId,
      payload: { mode: 'parallel', blockers: blocked },
    });
    return {
      mode: 'parallel',
      run_id: runId,
      completed: [],
      failed: [],
      blocked,
      agent_results: [],
      arbitration_results: [],
      workspace_merge_report: workspaceMergeReport,
      state,
      summary: loadMultiAgentSummary(projectRoot, runId) || undefined,
    };
  }
  const registry = new AgentRegistry(heartbeatTimeoutMs == null ? 30_000 : heartbeatTimeoutMs);
  agents.forEach((agent, idx) => {
    registry.register(agent.id, agent.executor, agent.workspaceManager, partitions[idx] ?? []);
  });

  appendEvent(projectRoot, sessionId, {
    type: 'RunStarted',
    run_id: runId,
    payload: { mode: 'parallel', agent_count: agents.length, isolation_level: 'isolated' },
  });

  const initialResults = await Promise.all(
    agents.map(async (agent, idx) => {
      registry.beat(agent.id, partitions[idx][0] || null);
      const result = await runGraphForAgent(graph, partitions[idx], agent, idx, opts, heartbeatTimeoutMs);
      registry.setStatus(agent.id, result.timed_out ? 'timeout' : 'idle');
      return result;
    })
  );

  const timedOutAgents = [];
  const blocked: string[] = [];
  const orphanReassignments: Array<{ from_agent_id: string; to_agent_id: string; work_item_ids: string[] }> = [];
  const agentResults = initialResults.map((entry) => ({
    ...entry,
    reassigned_task_ids: entry.reassigned_task_ids || [],
  }));
  const liveAgents = agentResults.filter((entry) => !entry.timed_out);
  for (const timedOut of agentResults.filter((entry) => entry.timed_out)) {
    timedOutAgents.push({
      agent_id: timedOut.agent_id,
      work_item_ids: timedOut.assigned_task_ids,
      detected_at: new Date().toISOString(),
    });
    const fallback = liveAgents.find((entry) => entry.agent_id !== timedOut.agent_id);
    if (!fallback || timedOut.assigned_task_ids.length === 0) continue;
    const fallbackIdx = agents.findIndex((agent) => agent.id === fallback.agent_id);
    const timeoutIdx = agents.findIndex((agent) => agent.id === timedOut.agent_id);
    const rerun = await runGraphForAgent(graph, timedOut.assigned_task_ids, agents[fallbackIdx], fallbackIdx, opts, null);
    fallback.completed.push(...rerun.completed);
    fallback.failed.push(...rerun.failed);
    fallback.workspace_records.push(...rerun.workspace_records);
    fallback.reassigned_task_ids.push(...timedOut.assigned_task_ids);
    const previousCleanup = fallback.cleanup;
    fallback.cleanup = async () => {
      await previousCleanup?.();
      await rerun.cleanup?.();
    };
    partitions[fallbackIdx] = [...partitions[fallbackIdx], ...timedOut.assigned_task_ids];
    partitions[timeoutIdx] = [];
    orphanReassignments.push({
      from_agent_id: timedOut.agent_id,
      to_agent_id: fallback.agent_id,
      work_item_ids: timedOut.assigned_task_ids,
    });
  }

  const completed = Array.from(new Set(agentResults.flatMap((result) => result.completed)));
  const failed = Array.from(new Set(agentResults.flatMap((result) => result.failed)));
  const rawRecords = agentResults.flatMap((result) => result.workspace_records || []);
  const mergedRecords = opts.applyWorkspaceMerges
    ? rawRecords.map((record) => applyWorkspaceRecord(projectRoot, record))
    : rawRecords;
  await Promise.all(agentResults.map((result) => result.cleanup?.().catch(() => {})));
  const workspaceMergeReport = buildWorkspaceMergeReport(runId, mergedRecords, blocked);
  const state = makeState('parallel', runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments, timedOutAgents, workspaceMergeReport);
  persistMultiAgentArtifacts(projectRoot, runId, state, [], [], workspaceMergeReport);

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
    workspace_merge_report: workspaceMergeReport,
    state,
    summary: loadMultiAgentSummary(projectRoot, runId) || undefined,
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
  const workspaceRecords: WorkspaceMergeRecord[] = [];

  for (const wave of graph.waves) {
    for (const nodeId of wave.node_ids) {
      const node = graph.nodes.get(nodeId)!;
      const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults, workspaceRecords);
      if (result.success) completed.push(nodeId);
      else failed.push(nodeId);
      if (failed.length > 0) break;
    }
    if (failed.length > 0) break;
  }

  const partitions = [Array.from(graph.nodes.keys()), Array.from(graph.nodes.keys())];
  const workspaceMergeReport = buildWorkspaceMergeReport(runId, workspaceRecords, blocked, true);
  const state = makeState(
    'competitive',
    runId,
    opts.agents,
    partitions,
    [
      { agent_id: agentA.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
      { agent_id: agentB.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
    ],
    completed,
    failed,
    blocked,
    [],
    [],
    workspaceMergeReport
  );
  persistMultiAgentArtifacts(projectRoot, runId, state, [], arbitrationResults, workspaceMergeReport);

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
    workspace_merge_report: workspaceMergeReport,
    state,
    summary: loadMultiAgentSummary(projectRoot, runId) || undefined,
  };
}

async function competeTwoAgents(
  nodeId: string,
  node: GraphNode,
  agentA: AgentSpec,
  agentB: AgentSpec,
  opts: CoordinationOptions,
  arbitrationResults: ArbitrationRecord[],
  workspaceRecords: WorkspaceMergeRecord[]
): Promise<TaskResult> {
  const { projectRoot, sessionId, runId } = opts;

  const allocA = await agentA.workspaceManager.allocate({
    work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
  });
  ensureGitWorktreeLease(agentA, allocA);
  const allocB = await agentB.workspaceManager.allocate({
    work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
  });
  ensureGitWorktreeLease(agentB, allocB);

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

  const candidates = [
    { agent: agentA, alloc: allocA, result: resultA },
    { agent: agentB, alloc: allocB, result: resultB },
  ].sort((left, right) => {
    const leftScore = (left.result.success ? 10_000 : 0) + left.result.evidence.length * 100 - String(left.result.output || '').length;
    const rightScore = (right.result.success ? 10_000 : 0) + right.result.evidence.length * 100 - String(right.result.output || '').length;
    return rightScore - leftScore;
  });
  const winnerCandidate = candidates[0];
  const winner = winnerCandidate.result;
  const winnerAgentId = winnerCandidate.agent.id;
  const winnerRecord = createMergeRecord(winnerCandidate.agent, node, winnerCandidate.alloc, winner);
  workspaceRecords.push(opts.applyWorkspaceMerges ? applyWorkspaceRecord(projectRoot, winnerRecord) : winnerRecord);

  await Promise.all([
    agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => {}),
    agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => {}),
  ]);
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
  const workspaceRecords: WorkspaceMergeRecord[] = [];

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
      ensureGitWorktreeLease(planner, planAlloc);
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
      ensureGitWorktreeLease(executor, execAlloc);

      let result: TaskResult;
      try {
        result = await executor.executor.execute(node, execAlloc, runId, 1);
      } catch (error) {
        result = { success: false, failure_class: 'env', evidence: [], output: String(error) };
      }
      const mergeRecord = createMergeRecord(executor, node, execAlloc, result);
      workspaceRecords.push(opts.applyWorkspaceMerges ? applyWorkspaceRecord(projectRoot, mergeRecord) : mergeRecord);
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
  const workspaceMergeReport = buildWorkspaceMergeReport(runId, workspaceRecords, blocked);
  const state = makeState(
    'cooperative',
    runId,
    opts.agents,
    partitions,
    [
      { agent_id: planner.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
      { agent_id: executor.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
    ],
    completed,
    failed,
    blocked,
    [],
    [],
    workspaceMergeReport
  );
  persistMultiAgentArtifacts(projectRoot, runId, state, handoffs, [], workspaceMergeReport);

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
    workspace_merge_report: workspaceMergeReport,
    state,
    summary: loadMultiAgentSummary(projectRoot, runId) || undefined,
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

export function multiAgentSummaryPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'multi-agent-summary.json');
}

export function workspaceMergeReportPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'workspace-merge-report.json');
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

export function loadMultiAgentSummary(projectRoot: string, runId: string): MultiAgentOperationalSummary | null {
  const summaryPath = multiAgentSummaryPath(projectRoot, runId);
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as MultiAgentOperationalSummary;
  } catch {
    return null;
  }
}

export function loadWorkspaceMergeReport(projectRoot: string, runId: string): WorkspaceMergeReport | null {
  const reportPath = workspaceMergeReportPath(projectRoot, runId);
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as WorkspaceMergeReport;
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
