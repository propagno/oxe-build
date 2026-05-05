"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiAgentCoordinator = void 0;
exports.multiAgentStatePath = multiAgentStatePath;
exports.multiAgentSummaryPath = multiAgentSummaryPath;
exports.workspaceMergeReportPath = workspaceMergeReportPath;
exports.loadMultiAgentState = loadMultiAgentState;
exports.loadMultiAgentSummary = loadMultiAgentSummary;
exports.loadWorkspaceMergeReport = loadWorkspaceMergeReport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const bus_1 = require("../events/bus");
const scheduler_1 = require("./scheduler");
const agent_roles_1 = require("./agent-roles");
const agent_registry_1 = require("./agent-registry");
function ensureRunDir(projectRoot, runId) {
    const dir = path_1.default.join(projectRoot, '.oxe', 'runs', runId);
    fs_1.default.mkdirSync(dir, { recursive: true });
    return dir;
}
function persistMultiAgentArtifacts(projectRoot, runId, state, handoffs = [], arbitrationResults = [], workspaceMergeReport = emptyWorkspaceMergeReport(runId)) {
    const runDir = ensureRunDir(projectRoot, runId);
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'multi-agent-state.json'), JSON.stringify(state, null, 2), 'utf8');
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'handoffs.json'), JSON.stringify(handoffs, null, 2), 'utf8');
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'arbitration-results.json'), JSON.stringify(arbitrationResults, null, 2), 'utf8');
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'workspace-merge-report.json'), JSON.stringify(workspaceMergeReport, null, 2), 'utf8');
    const summary = {
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
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'multi-agent-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}
function ensureIsolatedAgents(agents) {
    const shared = agents.filter((agent) => agent.workspaceManager.isolation_level !== 'isolated');
    if (shared.length === 0)
        return;
    const ids = shared.map((agent) => `${agent.id}:${agent.workspaceManager.isolation_level}`).join(', ');
    throw new Error(`Multi-agent requires isolated workspaces. Invalid agents: ${ids}`);
}
function buildOwnership(agents, partitions) {
    const ownership = [];
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
function makeState(mode, runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments, timedOutAgents, workspaceMergeReport = emptyWorkspaceMergeReport(runId)) {
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
function emptyWorkspaceMergeReport(runId) {
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
function ensureGitWorktreeLease(agent, lease) {
    if (lease.isolation_level !== 'isolated' || lease.strategy !== 'git_worktree') {
        throw new Error(`Multi-agent real requires git_worktree isolated workspace. Agent ${agent.id} received ${lease.strategy}/${lease.isolation_level}.`);
    }
}
function mutationScopeOf(node) {
    return Array.isArray(node?.mutation_scope) ? node.mutation_scope.map(String).filter(Boolean) : [];
}
function createMergeRecord(agent, node, lease, result) {
    const evidenceRefs = Array.isArray(result?.evidence) ? result.evidence.map(String).filter(Boolean) : [];
    const scope = mutationScopeOf(node);
    return {
        work_item_id: node.id,
        agent_id: agent.id,
        workspace_id: lease.workspace_id,
        strategy: lease.strategy,
        isolation_level: lease.isolation_level,
        branch: lease.branch ?? null,
        base_commit: lease.base_commit ?? null,
        root_path: lease.root_path ?? null,
        mutation_scope: scope,
        diff_paths: scope,
        evidence_refs: evidenceRefs,
        evidence_count: evidenceRefs.length,
        verify_status: result ? (result.success ? 'pass' : 'fail') : 'partial',
        status: result ? (result.success ? 'ready' : 'blocked') : 'ready',
        blocker: result && !result.success ? `verify_failed:${result.failure_class}` : null,
        applied_paths: [],
        diff_summary: { added: 0, modified: 0, missing: 0, paths: scope },
        next_action: result && !result.success ? 'Corrija a falha de verify/evidence antes de aplicar merge do workspace.' : null,
        recorded_at: new Date().toISOString(),
    };
}
function enrichMergeRecordWithResult(record, result) {
    if (!result)
        return record;
    const evidenceRefs = Array.isArray(result.evidence) ? result.evidence.map(String).filter(Boolean) : [];
    return {
        ...record,
        evidence_refs: evidenceRefs,
        evidence_count: evidenceRefs.length,
        verify_status: result.success ? 'pass' : 'fail',
        status: result.success ? 'ready' : 'blocked',
        blocker: result.success ? null : `verify_failed:${result.failure_class}`,
        next_action: result.success ? null : 'Corrija a falha de verify/evidence antes de aplicar merge do workspace.',
        recorded_at: new Date().toISOString(),
    };
}
function buildWorkspaceMergeReport(runId, records, extraBlockers = [], arbitrationRequired = false) {
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
function detectMutationConflicts(graph, agents, partitions) {
    const owners = new Map();
    const conflicts = [];
    for (let idx = 0; idx < agents.length; idx += 1) {
        for (const nodeId of partitions[idx] ?? []) {
            const node = graph.nodes.get(nodeId);
            for (const scope of mutationScopeOf(node)) {
                const previous = owners.get(scope);
                if (previous && previous !== agents[idx].id) {
                    conflicts.push(`mutation_scope_overlap:${scope}:${previous}:${agents[idx].id}`);
                }
                else {
                    owners.set(scope, agents[idx].id);
                }
            }
        }
    }
    return conflicts;
}
function applyWorkspaceRecord(projectRoot, record) {
    if (!record.root_path || record.status !== 'ready')
        return record;
    const appliedPaths = [];
    const summary = { added: 0, modified: 0, missing: 0, paths: [...record.mutation_scope] };
    for (const relativePath of record.mutation_scope) {
        const source = path_1.default.join(record.root_path, relativePath);
        const target = path_1.default.join(projectRoot, relativePath);
        if (!fs_1.default.existsSync(source) || fs_1.default.statSync(source).isDirectory()) {
            summary.missing += 1;
            return {
                ...record,
                status: 'blocked',
                blocker: `missing_output:${relativePath}`,
                diff_summary: summary,
                next_action: `Materialize o arquivo esperado ${relativePath} no worktree do agente antes do merge.`,
            };
        }
        if (fs_1.default.existsSync(target))
            summary.modified += 1;
        else
            summary.added += 1;
        fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
        fs_1.default.copyFileSync(source, target);
        appliedPaths.push(relativePath);
    }
    return {
        ...record,
        status: 'merged',
        blocker: null,
        applied_paths: appliedPaths,
        diff_summary: summary,
        next_action: null,
    };
}
function createTrackingWorkspaceManager(base, agent, graph, records) {
    const leases = new Map();
    return {
        isolation_level: base.isolation_level,
        allocate: async (req) => {
            const lease = await base.allocate(req);
            ensureGitWorktreeLease(agent, lease);
            leases.set(lease.workspace_id, lease);
            const node = graph.nodes.get(req.work_item_id);
            if (node)
                records.push(createMergeRecord(agent, node, lease));
            return lease;
        },
        snapshot: (id) => base.snapshot(id),
        reset: (id, snapRef) => base.reset(id, snapRef),
        dispose: async () => {
            // Scheduler calls dispose before the coordinator can reconcile diffs.
            // Defer real cleanup until the merge report has been produced.
        },
        disposeDeferred: async () => {
            await Promise.all([...leases.keys()].map((id) => base.dispose(id).catch(() => { })));
            leases.clear();
        },
    };
}
async function runGraphForAgent(graph, nodeIds, agent, idx, opts, heartbeatTimeoutMs) {
    const subGraph = subGraphFor(graph, nodeIds);
    const workspaceRecords = [];
    if (subGraph.nodes.size === 0) {
        return {
            agent_id: agent.id,
            completed: [],
            failed: [],
            timed_out: false,
            assigned_task_ids: nodeIds,
            reassigned_task_ids: [],
            workspace_records: workspaceRecords,
            cleanup: async () => { },
        };
    }
    const trackingWorkspaceManager = createTrackingWorkspaceManager(agent.workspaceManager, agent, graph, workspaceRecords);
    const taskResults = new Map();
    const trackingExecutor = {
        execute: async (node, lease, runId, attemptNumber) => {
            const result = await agent.executor.execute(node, lease, runId, attemptNumber);
            taskResults.set(node.id, result);
            return result;
        },
    };
    const ctx = {
        projectRoot: opts.projectRoot,
        sessionId: opts.sessionId,
        runId: `${opts.runId}-agent${idx}`,
        executor: trackingExecutor,
        workspaceManager: trackingWorkspaceManager,
        onEvent: opts.onEvent,
    };
    const scheduler = new scheduler_1.Scheduler();
    const work = scheduler.run(subGraph, ctx);
    if (!heartbeatTimeoutMs || heartbeatTimeoutMs <= 0) {
        const result = await work;
        const reconciledRecords = workspaceRecords.map((record) => enrichMergeRecordWithResult(record, taskResults.get(record.work_item_id)));
        return {
            agent_id: agent.id,
            completed: result.completed,
            failed: result.failed,
            timed_out: false,
            assigned_task_ids: nodeIds,
            reassigned_task_ids: [],
            workspace_records: reconciledRecords,
            cleanup: () => trackingWorkspaceManager.disposeDeferred(),
        };
    }
    let timer = null;
    const raced = await Promise.race([
        work.then((result) => ({ type: 'result', result })),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve({ type: 'timeout' }), heartbeatTimeoutMs);
        }),
    ]);
    if (timer)
        clearTimeout(timer);
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
    const reconciledRecords = workspaceRecords.map((record) => enrichMergeRecordWithResult(record, taskResults.get(record.work_item_id)));
    return {
        agent_id: agent.id,
        completed: result.completed,
        failed: result.failed,
        timed_out: false,
        assigned_task_ids: nodeIds,
        reassigned_task_ids: [],
        workspace_records: reconciledRecords,
        cleanup: () => trackingWorkspaceManager.disposeDeferred(),
    };
}
// ─── Parallel mode ───────────────────────────────────────────────────────────
async function runParallel(graph, opts) {
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
        (0, bus_1.appendEvent)(projectRoot, sessionId, {
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
    const registry = new agent_registry_1.AgentRegistry(heartbeatTimeoutMs == null ? 30000 : heartbeatTimeoutMs);
    agents.forEach((agent, idx) => {
        registry.register(agent.id, agent.executor, agent.workspaceManager, partitions[idx] ?? []);
    });
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'parallel', agent_count: agents.length, isolation_level: 'isolated' },
    });
    const initialResults = await Promise.all(agents.map(async (agent, idx) => {
        registry.beat(agent.id, partitions[idx][0] || null);
        const result = await runGraphForAgent(graph, partitions[idx], agent, idx, opts, heartbeatTimeoutMs);
        registry.setStatus(agent.id, result.timed_out ? 'timeout' : 'idle');
        return result;
    }));
    const timedOutAgents = [];
    const blocked = [];
    const orphanReassignments = [];
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
        if (!fallback || timedOut.assigned_task_ids.length === 0)
            continue;
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
    await Promise.all(agentResults.map((result) => result.cleanup?.().catch(() => { })));
    const workspaceMergeReport = buildWorkspaceMergeReport(runId, mergedRecords, blocked);
    const state = makeState('parallel', runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments, timedOutAgents, workspaceMergeReport);
    persistMultiAgentArtifacts(projectRoot, runId, state, [], [], workspaceMergeReport);
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
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
async function runCompetitive(graph, opts) {
    if (opts.agents.length < 2) {
        throw new Error('Competitive mode requires at least 2 agents');
    }
    ensureIsolatedAgents(opts.agents);
    const [agentA, agentB] = opts.agents;
    const { projectRoot, sessionId, runId } = opts;
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'competitive', isolation_level: 'isolated' },
    });
    const completed = [];
    const failed = [];
    const blocked = [];
    const arbitrationResults = [];
    const workspaceRecords = [];
    for (const wave of graph.waves) {
        for (const nodeId of wave.node_ids) {
            const node = graph.nodes.get(nodeId);
            const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults, workspaceRecords);
            if (result.success)
                completed.push(nodeId);
            else
                failed.push(nodeId);
            if (failed.length > 0)
                break;
        }
        if (failed.length > 0)
            break;
    }
    const partitions = [Array.from(graph.nodes.keys()), Array.from(graph.nodes.keys())];
    const workspaceMergeReport = buildWorkspaceMergeReport(runId, workspaceRecords, blocked, true);
    const state = makeState('competitive', runId, opts.agents, partitions, [
        { agent_id: agentA.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
        { agent_id: agentB.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
    ], completed, failed, blocked, [], [], workspaceMergeReport);
    persistMultiAgentArtifacts(projectRoot, runId, state, [], arbitrationResults, workspaceMergeReport);
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
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
async function competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults, workspaceRecords) {
    const { projectRoot, sessionId, runId } = opts;
    const allocA = await agentA.workspaceManager.allocate({
        work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
    });
    ensureGitWorktreeLease(agentA, allocA);
    const allocB = await agentB.workspaceManager.allocate({
        work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
    });
    ensureGitWorktreeLease(agentB, allocB);
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'AttemptStarted',
        run_id: runId,
        work_item_id: nodeId,
        payload: { mode: 'competitive', agents: [agentA.id, agentB.id] },
    });
    const [resultA, resultB] = await Promise.all([
        agentA.executor.execute(node, allocA, runId, 1).catch((error) => ({
            success: false, failure_class: 'env', evidence: [], output: String(error),
        })),
        agentB.executor.execute(node, allocB, runId, 1).catch((error) => ({
            success: false, failure_class: 'env', evidence: [], output: String(error),
        })),
    ]);
    const candidates = [
        { agent: agentA, alloc: allocA, result: resultA },
        { agent: agentB, alloc: allocB, result: resultB },
    ].sort((left, right) => {
        const leftScore = (left.result.success ? 10000 : 0) + left.result.evidence.length * 100 - String(left.result.output || '').length;
        const rightScore = (right.result.success ? 10000 : 0) + right.result.evidence.length * 100 - String(right.result.output || '').length;
        return rightScore - leftScore;
    });
    const winnerCandidate = candidates[0];
    const winner = winnerCandidate.result;
    const winnerAgentId = winnerCandidate.agent.id;
    const winnerRecord = createMergeRecord(winnerCandidate.agent, node, winnerCandidate.alloc, winner);
    workspaceRecords.push(opts.applyWorkspaceMerges ? applyWorkspaceRecord(projectRoot, winnerRecord) : winnerRecord);
    await Promise.all([
        agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => { }),
        agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => { }),
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
        (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', winner_agent_id: winnerAgentId } });
    }
    else {
        (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', failure_class: winner.failure_class, winner_agent_id: winnerAgentId } });
    }
    return winner;
}
// ─── Cooperative mode ────────────────────────────────────────────────────────
async function runCooperative(graph, opts) {
    if (opts.agents.length < 2) {
        throw new Error('Cooperative mode requires at least 2 agents');
    }
    ensureIsolatedAgents(opts.agents);
    const [planner, executor] = opts.agents;
    const { projectRoot, sessionId, runId } = opts;
    const handoffs = [];
    const workspaceRecords = [];
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'cooperative', planner: planner.id, executor: executor.id, isolation_level: 'isolated' },
    });
    const completed = [];
    const failed = [];
    const blocked = [];
    for (const wave of graph.waves) {
        for (const nodeId of wave.node_ids) {
            const node = graph.nodes.get(nodeId);
            const planAlloc = await planner.workspaceManager.allocate({
                work_item_id: nodeId,
                attempt_number: 1,
                strategy: node.workspace_strategy,
                mutation_scope: node.mutation_scope,
            });
            ensureGitWorktreeLease(planner, planAlloc);
            await planner.workspaceManager.dispose(planAlloc.workspace_id).catch(() => { });
            const handoff = (0, agent_roles_1.buildHandoff)({
                from_agent_id: planner.id,
                to_agent_id: executor.id,
                from_role: 'planner',
                to_role: 'executor',
                work_item_id: nodeId,
                context_pack_ref: null,
            });
            handoffs.push(handoff);
            (0, bus_1.appendEvent)(projectRoot, sessionId, {
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
            let result;
            try {
                result = await executor.executor.execute(node, execAlloc, runId, 1);
            }
            catch (error) {
                result = { success: false, failure_class: 'env', evidence: [], output: String(error) };
            }
            const mergeRecord = createMergeRecord(executor, node, execAlloc, result);
            workspaceRecords.push(opts.applyWorkspaceMerges ? applyWorkspaceRecord(projectRoot, mergeRecord) : mergeRecord);
            await executor.workspaceManager.dispose(execAlloc.workspace_id).catch(() => { });
            if (result.success) {
                completed.push(nodeId);
                (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'cooperative' } });
            }
            else {
                failed.push(nodeId);
                (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'cooperative', failure_class: result.failure_class } });
                break;
            }
        }
        if (failed.length > 0)
            break;
    }
    const partitions = [Array.from(graph.nodes.keys()), Array.from(graph.nodes.keys())];
    const workspaceMergeReport = buildWorkspaceMergeReport(runId, workspaceRecords, blocked);
    const state = makeState('cooperative', runId, opts.agents, partitions, [
        { agent_id: planner.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
        { agent_id: executor.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
    ], completed, failed, blocked, [], [], workspaceMergeReport);
    persistMultiAgentArtifacts(projectRoot, runId, state, handoffs, [], workspaceMergeReport);
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
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
class MultiAgentCoordinator {
    async run(graph, opts) {
        switch (opts.mode) {
            case 'parallel': return runParallel(graph, opts);
            case 'competitive': return runCompetitive(graph, opts);
            case 'cooperative': return runCooperative(graph, opts);
            default:
                throw new Error(`Unknown coordination mode: ${opts.mode}`);
        }
    }
}
exports.MultiAgentCoordinator = MultiAgentCoordinator;
function multiAgentStatePath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'multi-agent-state.json');
}
function multiAgentSummaryPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'multi-agent-summary.json');
}
function workspaceMergeReportPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'workspace-merge-report.json');
}
function loadMultiAgentState(projectRoot, runId) {
    const statePath = multiAgentStatePath(projectRoot, runId);
    if (!fs_1.default.existsSync(statePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(statePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function loadMultiAgentSummary(projectRoot, runId) {
    const summaryPath = multiAgentSummaryPath(projectRoot, runId);
    if (!fs_1.default.existsSync(summaryPath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(summaryPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function loadWorkspaceMergeReport(projectRoot, runId) {
    const reportPath = workspaceMergeReportPath(projectRoot, runId);
    if (!fs_1.default.existsSync(reportPath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(reportPath, 'utf8'));
    }
    catch {
        return null;
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function subGraphFor(graph, nodeIds) {
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
