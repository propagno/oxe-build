"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiAgentCoordinator = void 0;
exports.multiAgentStatePath = multiAgentStatePath;
exports.multiAgentSummaryPath = multiAgentSummaryPath;
exports.loadMultiAgentState = loadMultiAgentState;
exports.loadMultiAgentSummary = loadMultiAgentSummary;
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
function persistMultiAgentArtifacts(projectRoot, runId, state, handoffs = [], arbitrationResults = []) {
    const runDir = ensureRunDir(projectRoot, runId);
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'multi-agent-state.json'), JSON.stringify(state, null, 2), 'utf8');
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'handoffs.json'), JSON.stringify(handoffs, null, 2), 'utf8');
    fs_1.default.writeFileSync(path_1.default.join(runDir, 'arbitration-results.json'), JSON.stringify(arbitrationResults, null, 2), 'utf8');
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
function makeState(mode, runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments, timedOutAgents) {
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
        orphan_reassignments: orphanReassignments,
        timed_out_agents: timedOutAgents,
        updated_at: new Date().toISOString(),
    };
}
async function runGraphForAgent(graph, nodeIds, agent, idx, opts, heartbeatTimeoutMs) {
    const subGraph = subGraphFor(graph, nodeIds);
    if (subGraph.nodes.size === 0) {
        return {
            agent_id: agent.id,
            completed: [],
            failed: [],
            timed_out: false,
            assigned_task_ids: nodeIds,
            reassigned_task_ids: [],
        };
    }
    const ctx = {
        projectRoot: opts.projectRoot,
        sessionId: opts.sessionId,
        runId: `${opts.runId}-agent${idx}`,
        executor: agent.executor,
        workspaceManager: agent.workspaceManager,
        onEvent: opts.onEvent,
    };
    const scheduler = new scheduler_1.Scheduler();
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
        fallback.reassigned_task_ids.push(...timedOut.assigned_task_ids);
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
    const state = makeState('parallel', runId, agents, partitions, agentResults, completed, failed, blocked, orphanReassignments, timedOutAgents);
    persistMultiAgentArtifacts(projectRoot, runId, state);
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
    for (const wave of graph.waves) {
        for (const nodeId of wave.node_ids) {
            const node = graph.nodes.get(nodeId);
            const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults);
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
    const state = makeState('competitive', runId, opts.agents, partitions, [
        { agent_id: agentA.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
        { agent_id: agentB.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
    ], completed, failed, blocked, [], []);
    persistMultiAgentArtifacts(projectRoot, runId, state, [], arbitrationResults);
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
        state,
        summary: loadMultiAgentSummary(projectRoot, runId) || undefined,
    };
}
async function competeTwoAgents(nodeId, node, agentA, agentB, opts, arbitrationResults) {
    const { projectRoot, sessionId, runId } = opts;
    const allocA = await agentA.workspaceManager.allocate({
        work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
    });
    const allocB = await agentB.workspaceManager.allocate({
        work_item_id: nodeId, attempt_number: 1, strategy: node.workspace_strategy, mutation_scope: node.mutation_scope,
    });
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
    await Promise.all([
        agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => { }),
        agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => { }),
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
            let result;
            try {
                result = await executor.executor.execute(node, execAlloc, runId, 1);
            }
            catch (error) {
                result = { success: false, failure_class: 'env', evidence: [], output: String(error) };
            }
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
    const state = makeState('cooperative', runId, opts.agents, partitions, [
        { agent_id: planner.id, completed: [], failed: [], timed_out: false, reassigned_task_ids: [] },
        { agent_id: executor.id, completed, failed, timed_out: false, reassigned_task_ids: [] },
    ], completed, failed, blocked, [], []);
    persistMultiAgentArtifacts(projectRoot, runId, state, handoffs, []);
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
