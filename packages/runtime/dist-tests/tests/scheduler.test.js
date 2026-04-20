"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const run_journal_1 = require("../src/scheduler/run-journal");
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const inplace_1 = require("../src/workspace/strategies/inplace");
const gate_manager_1 = require("../src/gate/gate-manager");
const policy_engine_1 = require("../src/policy/policy-engine");
const plugin_registry_1 = require("../src/plugins/plugin-registry");
const audit_trail_1 = require("../src/audit/audit-trail");
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
    (0, node_test_1.test)('journal is created and updated during run', async () => {
        const runId = `r-journal-${Date.now()}`;
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const ctx = { ...makeCtx(tmpDir, alwaysSucceed()), runId };
        const result = await scheduler.run(graph, ctx);
        strict_1.default.equal(result.status, 'completed');
        // Journal should exist and reflect completed state
        const journal = (0, run_journal_1.loadJournal)(tmpDir, runId);
        strict_1.default.ok(journal !== null);
        strict_1.default.equal(journal.scheduler_state, 'completed');
        strict_1.default.ok(journal.completed_work_items.includes('T1'));
    });
    (0, node_test_1.test)('cancel writes cancelled state to journal', async () => {
        const runId = `r-cancel-${Date.now()}`;
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
        const ctx = { ...makeCtx(tmpDir, executor), runId };
        const result = await scheduler.run(graph, ctx);
        strict_1.default.equal(result.status, 'cancelled');
        const journal = (0, run_journal_1.loadJournal)(tmpDir, runId);
        strict_1.default.ok(journal !== null);
        strict_1.default.equal(journal.cancelled, true);
        strict_1.default.equal(journal.scheduler_state, 'cancelled');
    });
    (0, node_test_1.test)('recover skips already-completed nodes', async () => {
        const runId = `r-recover-${Date.now()}`;
        const executedNodes = [];
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        // Simulate a paused journal with T1 already done
        const { saveJournal } = await Promise.resolve().then(() => __importStar(require('../src/scheduler/run-journal')));
        saveJournal(tmpDir, runId, {
            run_id: runId,
            paused_at: new Date().toISOString(),
            cancelled: false,
            eligible_work_items: [],
            completed_work_items: ['T1'],
            failed_work_items: [],
            blocked_work_items: [],
            pending_gates: [],
            replay_cursor: null,
            scheduler_state: 'paused',
            partial_result: null,
        });
        const executor = {
            async execute(node) {
                executedNodes.push(node.id);
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const scheduler = new scheduler_1.Scheduler();
        const ctx = { ...makeCtx(tmpDir, executor), runId };
        const result = await scheduler.recover(runId, ctx, graph);
        strict_1.default.ok(result !== null);
        strict_1.default.equal(result.status, 'completed');
        // T1 was already done — only T2 should run
        strict_1.default.ok(!executedNodes.includes('T1'));
        strict_1.default.ok(executedNodes.includes('T2'));
    });
    (0, node_test_1.test)('recover returns null when no journal exists', async () => {
        const scheduler = new scheduler_1.Scheduler();
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const ctx = makeCtx(tmpDir, alwaysSucceed());
        const result = await scheduler.recover('no-such-run', ctx, graph);
        strict_1.default.equal(result, null);
    });
    (0, node_test_1.test)('RetryScheduled events are emitted on retry', async () => {
        let callCount = 0;
        const events = [];
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
        const ctx = {
            ...makeCtx(tmpDir, executor),
            onEvent: (e) => events.push(e),
        };
        await scheduler.run(graph, ctx);
        const retryEvents = events.filter((e) => e.type === 'RetryScheduled');
        strict_1.default.equal(retryEvents.length, 2);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, node_test_1.test)('policy gate blocks node and persists pending gate', async () => {
        const runId = `r-gate-${Date.now()}`;
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const gateManager = new gate_manager_1.GateManager(tmpDir, null, runId);
        const ctx = {
            ...makeCtx(tmpDir, alwaysSucceed()),
            runId,
            gateManager,
            policyEngine: new policy_engine_1.PolicyEngine([
                {
                    id: 'rule-1',
                    when: { tool: 'generate_patch' },
                    action: 'require_human_gate',
                },
            ]),
        };
        const result = await scheduler.run(graph, ctx);
        strict_1.default.equal(result.status, 'blocked');
        strict_1.default.ok(result.blocked.includes('T1'));
        strict_1.default.equal(gateManager.listPending().length, 1);
    });
    (0, node_test_1.test)('quota exhaustion blocks mutations before executor runs', async () => {
        let executed = 0;
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const ctx = {
            ...makeCtx(tmpDir, {
                async execute() {
                    executed++;
                    return { success: true, failure_class: null, evidence: [], output: 'ok' };
                },
            }),
            quota: (0, audit_trail_1.createQuota)(`r-quota-${Date.now()}`, { max_work_items: 0, max_mutations: 0 }),
        };
        const result = await scheduler.run(graph, ctx);
        strict_1.default.equal(result.status, 'blocked');
        strict_1.default.equal(executed, 0);
    });
    (0, node_test_1.test)('plugin tool provider can execute node instead of executor', async () => {
        const registry = new plugin_registry_1.PluginRegistry();
        let providerCalls = 0;
        registry.register({
            name: 'tool-plugin',
            toolProviders: [{
                    name: 'generate_patch-provider',
                    kind: 'mutation',
                    idempotent: false,
                    supports: (actionType) => actionType === 'generate_patch',
                    invoke: async () => {
                        providerCalls++;
                        return { success: true, output: 'plugin ok', evidence_paths: ['artifact.txt'], side_effects_applied: ['write_fs'] };
                    },
                }],
        });
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
        const scheduler = new scheduler_1.Scheduler();
        const result = await scheduler.run(graph, {
            ...makeCtx(tmpDir, alwaysFail()),
            pluginRegistry: registry,
        });
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.equal(providerCalls, 1);
    });
});
