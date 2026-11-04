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
// Regressão do e2e "linkly": mutation_scope vazio (rótulo não parseado) fazia tarefas mutáveis da
// mesma onda rodarem em paralelo, in-place, sem nenhum aviso.
const SPEC = { objective: 'scope', criteria: [] };
function plan(tasks) {
    const waves = {};
    for (const t of tasks)
        (waves[t.wave ?? 1] = waves[t.wave ?? 1] ?? []).push(t.id);
    return { tasks, waves, totalTasks: tasks.length };
}
function task(id, files = []) {
    return { id, title: id, wave: 1, dependsOn: [], files, verifyCommand: null, aceite: [], done: false };
}
(0, node_test_1.describe)('Scheduler — segurança de escopo', () => {
    let tmp;
    (0, node_test_1.test)('setup', () => {
        tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-scope-safety-'));
    });
    (0, node_test_1.test)('nós mutáveis sem mutation_scope rodam em série e emitem PolicyWarning', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const executor = {
            async execute() {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 30));
                inFlight -= 1;
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const events = [];
        const ctx = {
            projectRoot: tmp,
            sessionId: null,
            runId: `r-scope-${Date.now()}`,
            executor,
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp),
            onEvent: (event) => events.push(event),
        };
        const graph = (0, graph_compiler_1.compile)(plan([task('T1'), task('T2'), task('T3')]), SPEC, { default_workspace_strategy: 'inplace' });
        const result = await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.equal(maxInFlight, 1, 'tarefas sem escopo declarado não podem rodar em paralelo');
        const warnings = events.filter((e) => e.type === 'PolicyWarning');
        strict_1.default.deepEqual(warnings.map((e) => e.work_item_id).sort(), ['T1', 'T2', 'T3']);
        strict_1.default.equal(warnings[0].payload.reason, 'empty_mutation_scope');
    });
    (0, node_test_1.test)('nós com escopo declarado continuam sem aviso', async () => {
        const events = [];
        const ctx = {
            projectRoot: tmp,
            sessionId: null,
            runId: `r-scoped-${Date.now()}`,
            executor: { async execute() { return { success: true, failure_class: null, evidence: [], output: 'ok' }; } },
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp),
            onEvent: (event) => events.push(event),
        };
        const graph = (0, graph_compiler_1.compile)(plan([task('T1', ['src/a.js'])]), SPEC, { default_workspace_strategy: 'inplace' });
        await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(events.filter((e) => e.type === 'PolicyWarning').length, 0);
    });
    (0, node_test_1.test)('teardown', () => {
        fs_1.default.rmSync(tmp, { recursive: true, force: true });
    });
});
