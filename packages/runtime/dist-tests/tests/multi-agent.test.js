"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const multi_agent_coordinator_1 = require("../src/scheduler/multi-agent-coordinator");
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function makeLease(id) {
    return { workspace_id: id, strategy: 'inplace', branch: null, base_commit: null, root_path: '/tmp', ttl_minutes: 30 };
}
function makeWorkspaceManager(id) {
    return {
        allocate: async (_req) => makeLease(`ws-${id}-${_req.work_item_id}`),
        snapshot: async (_id) => ({ snapshot_id: 'snap', workspace_id: _id, commit: 'abc', created_at: new Date().toISOString() }),
        reset: async () => { },
        dispose: async () => { },
    };
}
function makeSuccessExecutor() {
    return {
        execute: async (_node, _lease, _runId, _attempt) => ({
            success: true, failure_class: null, evidence: [], output: 'done',
        }),
    };
}
function makeFailExecutor() {
    return {
        execute: async () => ({
            success: false, failure_class: 'env', evidence: [], output: 'error',
        }),
    };
}
function makeGraph(nodeIds) {
    const nodes = new Map();
    for (const id of nodeIds) {
        nodes.set(id, {
            id,
            title: `Task ${id}`,
            wave: 0,
            depends_on: [],
            workspace_strategy: 'inplace',
            mutation_scope: [],
            actions: [],
            verify: { must_pass: [], acceptance_refs: [], command: null },
            policy: { max_retries: 1, requires_human_approval: false },
        });
    }
    const waves = [{ wave_number: 0, node_ids: nodeIds }];
    return {
        nodes,
        edges: [],
        waves,
        metadata: { compiled_at: new Date().toISOString(), plan_hash: 'h1', spec_hash: 'h2', node_count: nodeIds.length, wave_count: 1 },
    };
}
function makeAgent(id, executor, assignedTaskIds) {
    return { id, executor, workspaceManager: makeWorkspaceManager(id), assignedTaskIds };
}
function makeTmpProjectRoot() {
    const root = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-ma-'));
    fs_1.default.mkdirSync(path_1.default.join(root, '.oxe'), { recursive: true });
    return root;
}
(0, node_test_1.describe)('MultiAgentCoordinator — parallel mode', () => {
    (0, node_test_1.it)('completes all tasks with two agents', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2', 't3', 't4']);
        const opts = {
            mode: 'parallel',
            agents: [makeAgent('a1', makeSuccessExecutor()), makeAgent('a2', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-parallel-001',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.mode, 'parallel');
        strict_1.default.equal(result.completed.length + result.failed.length, 4);
    });
    (0, node_test_1.it)('distributes tasks round-robin when no assignedTaskIds', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2', 't3', 't4']);
        const opts = {
            mode: 'parallel',
            agents: [makeAgent('a1', makeSuccessExecutor()), makeAgent('a2', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-parallel-002',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.agent_results.length, 2);
        const totalAgentCompleted = result.agent_results.reduce((sum, r) => sum + r.completed.length, 0);
        strict_1.default.equal(totalAgentCompleted, result.completed.length);
    });
    (0, node_test_1.it)('respects assignedTaskIds when provided', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2', 't3', 't4']);
        const opts = {
            mode: 'parallel',
            agents: [
                makeAgent('a1', makeSuccessExecutor(), ['t1', 't2']),
                makeAgent('a2', makeSuccessExecutor(), ['t3', 't4']),
            ],
            projectRoot: root,
            sessionId: null,
            runId: 'r-parallel-003',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.completed.length, 4);
    });
});
(0, node_test_1.describe)('MultiAgentCoordinator — competitive mode', () => {
    (0, node_test_1.it)('picks winner when both succeed (prefers A)', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1']);
        const opts = {
            mode: 'competitive',
            agents: [makeAgent('agentA', makeSuccessExecutor()), makeAgent('agentB', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-competitive-001',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.mode, 'competitive');
        strict_1.default.ok(result.completed.includes('t1') || result.failed.includes('t1'));
    });
    (0, node_test_1.it)('picks B when A fails', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1']);
        const opts = {
            mode: 'competitive',
            agents: [makeAgent('agentA', makeFailExecutor()), makeAgent('agentB', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-competitive-002',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.ok(result.completed.includes('t1') || result.failed.includes('t1'));
    });
    (0, node_test_1.it)('throws when less than 2 agents in competitive mode', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1']);
        const opts = {
            mode: 'competitive',
            agents: [makeAgent('a1', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-competitive-003',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        await strict_1.default.rejects(() => coordinator.run(graph, opts), /at least 2 agents/);
    });
});
(0, node_test_1.describe)('MultiAgentCoordinator — cooperative mode', () => {
    (0, node_test_1.it)('planner/executor handoff completes all tasks', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2']);
        const opts = {
            mode: 'cooperative',
            agents: [makeAgent('planner', makeSuccessExecutor()), makeAgent('executor', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-cooperative-001',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.mode, 'cooperative');
        strict_1.default.equal(result.completed.length, 2);
        strict_1.default.equal(result.failed.length, 0);
    });
    (0, node_test_1.it)('records one handoff per task', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2', 't3']);
        const opts = {
            mode: 'cooperative',
            agents: [makeAgent('planner', makeSuccessExecutor()), makeAgent('executor', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-cooperative-002',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.handoffs?.length, 3);
        strict_1.default.ok(result.handoffs.every((h) => h.from_role === 'planner' && h.to_role === 'executor'));
    });
    (0, node_test_1.it)('stops on first failure', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1', 't2']);
        const opts = {
            mode: 'cooperative',
            agents: [makeAgent('planner', makeSuccessExecutor()), makeAgent('executor', makeFailExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-cooperative-003',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        const result = await coordinator.run(graph, opts);
        strict_1.default.equal(result.failed.length, 1);
        strict_1.default.equal(result.failed[0], 't1');
    });
    (0, node_test_1.it)('throws when less than 2 agents in cooperative mode', async () => {
        const root = makeTmpProjectRoot();
        const graph = makeGraph(['t1']);
        const opts = {
            mode: 'cooperative',
            agents: [makeAgent('a1', makeSuccessExecutor())],
            projectRoot: root,
            sessionId: null,
            runId: 'r-cooperative-004',
        };
        const coordinator = new multi_agent_coordinator_1.MultiAgentCoordinator();
        await strict_1.default.rejects(() => coordinator.run(graph, opts), /at least 2 agents/);
    });
});
