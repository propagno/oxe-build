"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const scheduler_1 = require("../src/scheduler/scheduler");
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const inplace_1 = require("../src/workspace/strategies/inplace");
const SPEC = { objective: 'Test', criteria: [] };
function makePlan(tasks) {
    const waves = {};
    for (const t of tasks) {
        const w = t.wave ?? 1;
        (waves[w] = waves[w] ?? []).push(t.id);
    }
    return { tasks, waves, totalTasks: tasks.length };
}
function makeCtx(projectRoot, executor) {
    return {
        projectRoot,
        sessionId: null,
        runId: `r-test-${Date.now()}`,
        executor,
        workspaceManager: new inplace_1.InplaceWorkspaceManager(projectRoot),
    };
}
function alwaysSucceed() {
    return {
        async execute() {
            return { success: true, failure_class: null, evidence: [], output: 'ok' };
        },
    };
}
function alwaysFail(failureClass = 'test') {
    return {
        async execute() {
            return { success: false, failure_class: failureClass, evidence: [], output: 'fail' };
        },
    };
}
(0, node_test_1.describe)('Scheduler', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-sched-test-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('runs a simple single-task graph to completion', async () => {
        const plan = makePlan([
            { id: 'T1', title: 'Task 1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysSucceed()));
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.deepEqual(result.completed, ['T1']);
        strict_1.default.deepEqual(result.failed, []);
    });
    (0, node_test_1.test)('runs two parallel tasks in wave 1', async () => {
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysSucceed()));
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.equal(result.completed.length, 2);
    });
    (0, node_test_1.test)('respects wave ordering — T2 runs after T1', async () => {
        const executionOrder = [];
        const executor = {
            async execute(node) {
                executionOrder.push(node.id);
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        await scheduler.run(graph, makeCtx(tmpDir, executor));
        strict_1.default.equal(executionOrder.indexOf('T1') < executionOrder.indexOf('T2'), true);
    });
    (0, node_test_1.test)('failed task causes downstream to be blocked', async () => {
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysFail()));
        strict_1.default.equal(result.status, 'failed');
        strict_1.default.ok(result.failed.includes('T1'));
        strict_1.default.ok(result.blocked.includes('T2'));
    });
    (0, node_test_1.test)('retries up to max_retries on env failure', async () => {
        let callCount = 0;
        const executor = {
            async execute() {
                callCount++;
                return callCount < 3
                    ? { success: false, failure_class: 'env', evidence: [], output: 'env error' }
                    : { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 2 });
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(graph, makeCtx(tmpDir, executor));
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.equal(callCount, 3);
    });
    (0, node_test_1.test)('policy failure does not retry', async () => {
        let callCount = 0;
        const executor = {
            async execute() {
                callCount++;
                return { success: false, failure_class: 'policy', evidence: [], output: 'policy denied' };
            },
        };
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 2 });
        const scheduler = new scheduler_1.Scheduler();
        await scheduler.run(graph, makeCtx(tmpDir, executor));
        strict_1.default.equal(callCount, 1);
    });
    (0, node_test_1.test)('cancel stops execution mid-run', async () => {
        const scheduler = new scheduler_1.Scheduler();
        const executor = {
            async execute() {
                scheduler.cancel();
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 2, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const result = await scheduler.run(graph, makeCtx(tmpDir, executor));
        strict_1.default.equal(result.status, 'cancelled');
    });
    (0, node_test_1.test)('emits events for each transition', async () => {
        const events = [];
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const ctx = {
            ...makeCtx(tmpDir, alwaysSucceed()),
            onEvent: (e) => events.push(e),
        };
        await scheduler.run(graph, ctx);
        const types = events.map((e) => e.type);
        strict_1.default.ok(types.includes('RunStarted'));
        strict_1.default.ok(types.includes('WorkItemReady'));
        strict_1.default.ok(types.includes('AttemptStarted'));
        strict_1.default.ok(types.includes('WorkspaceAllocated'));
        strict_1.default.ok(types.includes('WorkItemCompleted'));
        strict_1.default.ok(types.includes('RunCompleted'));
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
