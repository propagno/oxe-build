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
    (0, node_test_1.test)('retryPolicyOnce: one more attempt after a policy refusal, even past max_retries; never a second', async () => {
        for (const [maxRetries, passesOnRetry, expectedCalls, expectedStatus] of [[0, true, 2, 'completed'], [2, false, 2, 'failed']]) {
            let callCount = 0;
            const executor = {
                async execute() {
                    callCount++;
                    return callCount === 2 && passesOnRetry
                        ? { success: true, failure_class: null, evidence: [], output: 'ok' }
                        : { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged' };
                },
            };
            const plan = makePlan([
                { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            ]);
            const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: maxRetries });
            const result = await new scheduler_1.Scheduler().run(graph, { ...makeCtx(tmpDir, executor), options: { retryPolicyOnce: true } });
            strict_1.default.equal(callCount, expectedCalls, `max_retries ${maxRetries}`);
            strict_1.default.equal(result.status, expectedStatus);
        }
    });
    (0, node_test_1.test)('retryPolicyOnce in a later execute: a task refused before gets attempt 1 only; the refused attempt keeps its output', async () => {
        let callCount = 0;
        const executor = {
            async execute() {
                callCount++;
                return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged\nConteúdo novo: read_file a.kt (10 chars)' };
            },
        };
        const plan = makePlan([
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        const events = [];
        const ctx = { ...makeCtx(tmpDir, executor), options: { retryPolicyOnce: true, policyRefusedBefore: ['T1'] }, onEvent: (e) => events.push(e) };
        await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(callCount, 3, 'T1 once (already refused before), T2 twice (its one extra attempt)');
        // cross-review 15/11: the extra attempt is a CLEAN retry (no refusal text in previousError)
        const prev = [];
        const exec2 = {
            async execute(_n, _w, _r, _a, input) {
                prev.push(input?.previousError);
                return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged [reasoning_extraction] oxe-cc runtime execute --retry-policy-once' };
            },
        };
        const g2 = (0, graph_compiler_1.compile)(makePlan([{ id: 'T3', title: 'T3', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        await new scheduler_1.Scheduler().run(g2, { ...makeCtx(tmpDir, exec2), options: { retryPolicyOnce: true } });
        strict_1.default.equal(prev.length, 2);
        strict_1.default.ok(!String(prev[1] ?? '').includes('reasoning_extraction'), String(prev[1]));
        // exhausted in this run: blocked before any attempt (no model call)
        let calls3 = 0;
        const exec3 = { async execute() { calls3++; return { success: true, failure_class: null, evidence: [], output: 'ok' }; } };
        const g3 = (0, graph_compiler_1.compile)(makePlan([{ id: 'T4', title: 'T4', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        await new scheduler_1.Scheduler().run(g3, { ...makeCtx(tmpDir, exec3), options: { retryPolicyOnce: true, policyRetryExhausted: ['T4'] } });
        strict_1.default.equal(calls3, 0);
        const retry = events.find((e) => e.type === 'RetryScheduled' && e.payload?.reason === 'policy_retry_once');
        strict_1.default.equal(retry?.work_item_id, 'T2');
        strict_1.default.match(String(retry?.payload?.output_tail), /read_file a\.kt/);
    });
    (0, node_test_1.test)('OXB-C28-1: a tool-output policy refusal gets one automatic clean retry; a prompt one does not; off by config', async () => {
        for (const [trigger, opts, expectedCalls] of [
            ['tool_output', {}, 2], ['prompt', {}, 1], ['tool_output', { policyAutoRetry: false }, 1],
        ]) {
            let calls = 0;
            const events = [];
            const executor = {
                async execute() {
                    calls++;
                    return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged [reasoning_extraction]', policy_trigger: trigger };
                },
            };
            const g = (0, graph_compiler_1.compile)(makePlan([{ id: 'T7', title: 'T7', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
            await new scheduler_1.Scheduler().run(g, { ...makeCtx(tmpDir, executor), options: { ...opts }, onEvent: (e) => events.push(e) });
            strict_1.default.equal(calls, expectedCalls, `${trigger} ${JSON.stringify(opts)}`);
            if (expectedCalls === 2)
                strict_1.default.ok(events.some((e) => e.type === 'RetryScheduled' && e.payload?.reason === 'policy_auto_retry'));
        }
    });
    (0, node_test_1.test)('OXB-C28-2: groupRemoteSegments joins consecutive remote segments of the same runner; others stay apart', () => {
        const rv = 'node scripts/remote-verify.mjs --timeout-min 20';
        const segs = [`${rv} -- npx vitest a.test.ts`, `${rv} -- "npx tsc --noEmit"`, 'npm run lint', `${rv} -- npx playwright test`, `${rv} -- node x.mjs "$HOME"`];
        const units = (0, scheduler_1.groupRemoteSegments)(segs);
        strict_1.default.equal(units.length, 4);
        strict_1.default.deepEqual(units[0].members, [0, 1]);
        strict_1.default.equal(units[0].command, `${rv} -- "echo ===OXE-SEG-1=== && npx vitest a.test.ts && echo ===OXE-SEG-2=== && npx tsc --noEmit"`);
        strict_1.default.deepEqual(units.slice(1).map((u) => u.members), [[2], [3], [4]], 'a quote/$ in the inner command is never merged');
        strict_1.default.equal((0, scheduler_1.remoteFailedMember)('===OXE-SEG-1===\nok\n===OXE-SEG-2===\nerror TS2345', [0, 1]), 1);
        strict_1.default.equal((0, scheduler_1.remoteFailedMember)('push failed', [0, 1]), 0);
        strict_1.default.equal((0, scheduler_1.groupRemoteSegments)(['node a.js', 'node b.js']).length, 2);
    });
    (0, node_test_1.test)('OXB-C28-2: one remote round trip for the merged segments, and the failing segment is the reported one', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-c28-2-'));
        fs_1.default.mkdirSync(path_1.default.join(dir, '.oxe'), { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(dir, 'remote-verify.mjs'), [
            "import { execSync } from 'child_process'; import fs from 'fs';",
            "const i = process.argv.indexOf('--'); const c = process.argv.slice(i + 1);",
            "fs.appendFileSync('calls.txt', JSON.stringify(c) + '\\n');",
            "try { process.stdout.write(execSync(c.length === 1 ? c[0] : c.join(' '), { encoding: 'utf8' })); } catch (e) { process.stdout.write(String(e.stdout || '')); process.exit(1); }",
        ].join('\n'));
        fs_1.default.writeFileSync(path_1.default.join(dir, 'ok.js'), "console.log('ok')");
        fs_1.default.writeFileSync(path_1.default.join(dir, 'bad.js'), "console.log('boom'); process.exit(3)");
        const verify = 'node remote-verify.mjs -- node ok.js && node remote-verify.mjs -- node bad.js && node remote-verify.mjs -- node ok.js';
        const events = [];
        const graph = (0, graph_compiler_1.compile)(makePlan([{ id: 'T3', title: 'T3', wave: 1, dependsOn: [], files: [], verifyCommand: verify, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        await new scheduler_1.Scheduler().run(graph, { ...makeCtx(dir, alwaysSucceed()), options: { deferFailed: true }, onEvent: (e) => events.push(e) });
        const calls = fs_1.default.readFileSync(path_1.default.join(dir, 'calls.txt'), 'utf8').trim().split('\n');
        strict_1.default.equal(calls.length, 1, calls.join('\n'));
        const done = events.find((e) => e.type === 'VerificationCompleted');
        const seg = done?.payload?.failed_segment;
        strict_1.default.equal(done?.payload?.status, 'failed');
        strict_1.default.equal(seg?.index, 2);
        strict_1.default.equal(seg?.total, 3);
        strict_1.default.equal(seg?.command, 'node remote-verify.mjs -- node bad.js');
    });
    (0, node_test_1.test)('OXB-C28-1: a deferred task is progress — an independent later wave still runs (no no_progress_timeout)', async () => {
        const ran = [];
        const executor = {
            async execute(node) {
                ran.push(node.id);
                await new Promise((r) => setTimeout(r, 400));
                return node.id === 'T7'
                    ? { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged', policy_trigger: 'prompt' }
                    : { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const plan = makePlan([
            { id: 'T7', title: 'T7', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
            { id: 'T8', title: 'T8', wave: 2, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
        ]);
        const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
        const result = await new scheduler_1.Scheduler().run(graph, { ...makeCtx(tmpDir, executor), options: { deferFailed: true, staleProgressMs: 200 } });
        strict_1.default.notEqual(result.status, 'aborted', String(result.reason));
        strict_1.default.deepEqual(ran, ['T7', 'T8']);
        strict_1.default.ok(result.completed.includes('T8'));
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
