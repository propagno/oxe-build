"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiAgentCoordinator = void 0;
const bus_1 = require("../events/bus");
const scheduler_1 = require("./scheduler");
const agent_roles_1 = require("./agent-roles");
// ─── Parallel mode ───────────────────────────────────────────────────────────
// Tasks are partitioned across agents. Each agent runs its own Scheduler
// on a sub-graph. Results are merged.
async function runParallel(graph, opts) {
    const { agents, projectRoot, sessionId, runId } = opts;
    // Partition tasks across agents (round-robin if assignedTaskIds not set)
    const partitions = agents.map((a) => a.assignedTaskIds ?? []);
    if (partitions.every((p) => p.length === 0)) {
        const allIds = [...graph.nodes.keys()];
        allIds.forEach((id, i) => {
            partitions[i % agents.length].push(id);
        });
    }
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'parallel', agent_count: agents.length },
    });
    const agentResults = await Promise.all(agents.map(async (agent, idx) => {
        const subGraph = subGraphFor(graph, partitions[idx]);
        if (subGraph.nodes.size === 0) {
            return { agent_id: agent.id, completed: [], failed: [] };
        }
        const ctx = {
            projectRoot,
            sessionId,
            runId: `${runId}-agent${idx}`,
            executor: agent.executor,
            workspaceManager: agent.workspaceManager,
            onEvent: opts.onEvent,
        };
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(subGraph, ctx);
        return { agent_id: agent.id, completed: result.completed, failed: result.failed };
    }));
    const completed = agentResults.flatMap((r) => r.completed);
    const failed = agentResults.flatMap((r) => r.failed);
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunCompleted',
        run_id: runId,
        payload: { mode: 'parallel', completed: completed.length, failed: failed.length },
    });
    return { mode: 'parallel', run_id: runId, completed, failed, blocked: [], agent_results: agentResults };
}
// ─── Competitive mode ────────────────────────────────────────────────────────
// Two agents attempt the same task. First success wins; the loser's workspace
// is disposed. Requires exactly 2 agents.
async function runCompetitive(graph, opts) {
    if (opts.agents.length < 2) {
        throw new Error('Competitive mode requires at least 2 agents');
    }
    const [agentA, agentB] = opts.agents;
    const { projectRoot, sessionId, runId } = opts;
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'competitive' },
    });
    const completed = [];
    const failed = [];
    for (const wave of graph.waves) {
        for (const nodeId of wave.node_ids) {
            const node = graph.nodes.get(nodeId);
            const result = await competeTwoAgents(nodeId, node, agentA, agentB, opts);
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
        blocked: [],
        agent_results: [
            { agent_id: agentA.id, completed, failed },
            { agent_id: agentB.id, completed: [], failed: [] },
        ],
    };
}
async function competeTwoAgents(nodeId, node, agentA, agentB, opts) {
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
    // Race both agents — first success wins
    const [resultA, resultB] = await Promise.all([
        agentA.executor.execute(node, allocA, runId, 1).catch((e) => ({
            success: false, failure_class: 'env', evidence: [], output: String(e),
        })),
        agentB.executor.execute(node, allocB, runId, 1).catch((e) => ({
            success: false, failure_class: 'env', evidence: [], output: String(e),
        })),
    ]);
    // Clean up both workspaces
    await Promise.all([
        agentA.workspaceManager.dispose(allocA.workspace_id).catch(() => { }),
        agentB.workspaceManager.dispose(allocB.workspace_id).catch(() => { }),
    ]);
    // Pick winner: prefer success; if both succeed, prefer A (primary agent)
    const winner = resultA.success ? resultA : resultB.success ? resultB : resultA;
    if (winner.success) {
        (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemCompleted', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive' } });
    }
    else {
        (0, bus_1.appendEvent)(projectRoot, sessionId, { type: 'WorkItemBlocked', run_id: runId, work_item_id: nodeId, payload: { mode: 'competitive', failure_class: winner.failure_class } });
    }
    return winner;
}
// ─── Cooperative mode ────────────────────────────────────────────────────────
// planner (agent[0]) does a dry-run to collect context, then hands off to
// executor (agent[1]) which performs the real run. Handoffs are recorded.
async function runCooperative(graph, opts) {
    if (opts.agents.length < 2) {
        throw new Error('Cooperative mode requires at least 2 agents');
    }
    const [planner, executor] = opts.agents;
    const { projectRoot, sessionId, runId } = opts;
    const handoffs = [];
    (0, bus_1.appendEvent)(projectRoot, sessionId, {
        type: 'RunStarted',
        run_id: runId,
        payload: { mode: 'cooperative', planner: planner.id, executor: executor.id },
    });
    const completed = [];
    const failed = [];
    for (const wave of graph.waves) {
        for (const nodeId of wave.node_ids) {
            const node = graph.nodes.get(nodeId);
            // Phase 1: planner allocates workspace + signals readiness (no output used)
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
            // Phase 2: executor performs the real task
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
            catch (e) {
                result = { success: false, failure_class: 'env', evidence: [], output: String(e) };
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
        blocked: [],
        agent_results: [
            { agent_id: planner.id, completed: [], failed: [] },
            { agent_id: executor.id, completed, failed },
        ],
        handoffs,
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
// ─── Helpers ─────────────────────────────────────────────────────────────────
function subGraphFor(graph, nodeIds) {
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
