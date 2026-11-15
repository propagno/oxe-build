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
// OxeSpace 14/11 (OxeChat F2): `runtime pause` from another process said "paused", T3 finished and T4 started anyway.
// A requested pause lets the task in progress finish and never starts the next one.
const SPEC = { objective: 'pause', criteria: [] };
function graph() {
    const plan = {
        tasks: [
            { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand: 'node -e "process.exit(0)"', aceite: [], done: false },
            { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: ['b.js'], verifyCommand: 'node -e "process.exit(0)"', aceite: [], done: false },
        ],
        waves: { 1: ['T1'], 2: ['T2'] },
        totalTasks: 2,
    };
    return (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
}
(0, node_test_1.describe)('pausa pedida de fora (runtime pause)', () => {
    (0, node_test_1.test)('a tarefa em curso termina; a próxima não começa; o run fica paused com RunPaused requested', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-pause-'));
        let paused = false;
        const ran = [];
        const executor = {
            async execute(node) {
                ran.push(node.id);
                paused = true; // the person runs `runtime pause` while T1 is running
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const events = [];
        const ctx = {
            projectRoot: tmp, sessionId: null, runId: `r-pause-${Date.now()}`, executor,
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
            pauseRequested: () => (paused ? 'runtime pause: revisar o T1' : null),
        };
        try {
            const result = await new scheduler_1.Scheduler().run(graph(), ctx);
            strict_1.default.deepEqual(ran, ['T1'], 'T2 nunca começa');
            strict_1.default.equal(result.status, 'paused');
            strict_1.default.ok(result.completed.includes('T1'));
            // T2 stays pending for the resume: never "blocked" by the pause (OxeSpace 15/11, OxeCode F4 T18)
            strict_1.default.ok(!result.blocked.includes('T2'), JSON.stringify(result.blocked));
            strict_1.default.equal(events.filter((e) => e.type === 'WorkItemBlocked').length, 0);
            const ev = events.find((e) => e.type === 'RunPaused');
            strict_1.default.equal((ev?.payload).reason, 'requested');
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('pausa pedida durante a tentativa 1: a tentativa 2 não começa e a tarefa fica pendente (OxeSpace 15/11, OxeChat F4 T9)', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-pause-'));
        let paused = false;
        let calls = 0;
        const executor = {
            async execute() {
                calls += 1;
                paused = true; // pause requested while attempt 1 runs; attempt 1 fails
                return { success: false, failure_class: 'test', evidence: [], output: 'falhou' };
            },
        };
        const events = [];
        const ctx = {
            projectRoot: tmp, sessionId: null, runId: `r-pause-att-${Date.now()}`, executor,
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
            pauseRequested: () => (paused ? 'runtime pause: janela' : null),
        };
        try {
            const result = await new scheduler_1.Scheduler().run(graph(), ctx);
            strict_1.default.equal(calls, 1, 'no attempt 2 under the pause');
            strict_1.default.equal(result.status, 'paused');
            strict_1.default.ok(!result.failed.includes('T1') && !result.blocked.includes('T1'), JSON.stringify(result));
            strict_1.default.ok(events.some((e) => e.type === 'PolicyWarning' && e.payload.reason === 'paused_before_attempt'));
            // R34: no retry quota spent and no "retry 2" banner under the pause
            strict_1.default.equal(events.filter((e) => e.type === 'RetryScheduled').length, 0);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('R44: uma tentativa fechada por contexto cheio com trabalho escrito é verificada antes de pagar outra', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-ctxcap-'));
        let calls = 0;
        const executor = {
            async execute(node) {
                calls += 1;
                if (node.id !== 'T1')
                    return { success: true, failure_class: null, evidence: [], output: 'ok' };
                return { success: false, failure_class: 'context_full', evidence: ['a.js'], output: 'contexto cheio', completed_by: 'context_cap', turns_used: 5, turns_cap: 10 };
            },
        };
        const ctx = { projectRoot: tmp, sessionId: null, runId: `r-cap-${Date.now()}`, executor, workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp) };
        try {
            const result = await new scheduler_1.Scheduler().run(graph(), ctx);
            strict_1.default.ok(result.completed.includes('T1'), JSON.stringify(result));
            strict_1.default.equal(calls, 2, 'T1 once (its verify is green), then T2');
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('sem pausa pedida, as duas rodam', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-pause-'));
        const ran = [];
        const executor = { async execute(node) { ran.push(node.id); return { success: true, failure_class: null, evidence: [], output: 'ok' }; } };
        const ctx = { projectRoot: tmp, sessionId: null, runId: `r-nopause-${Date.now()}`, executor, workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), pauseRequested: () => null };
        try {
            await new scheduler_1.Scheduler().run(graph(), ctx);
            strict_1.default.deepEqual(ran, ['T1', 'T2']);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
