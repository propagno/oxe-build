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
const run_journal_1 = require("../src/scheduler/run-journal");
const graph_compiler_1 = require("../src/compiler/graph-compiler");
const inplace_1 = require("../src/workspace/strategies/inplace");
const gate_manager_1 = require("../src/gate/gate-manager");
const SPEC = { objective: 'abort/recover', criteria: [] };
function plan(tasks) {
    const waves = {};
    for (const t of tasks)
        (waves[t.wave ?? 1] = waves[t.wave ?? 1] ?? []).push(t.id);
    return { tasks, waves, totalTasks: tasks.length };
}
function task(id, wave, files = [`src/${id}.js`]) {
    return { id, title: id, wave, dependsOn: [], files, verifyCommand: null, aceite: [], done: false };
}
const ok = {
    async execute() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
    },
};
(0, node_test_1.describe)('Scheduler — abort preserva progresso, recover amplo, gate aprovado reutilizado, dispose correto', () => {
    let tmp;
    (0, node_test_1.test)('setup', () => {
        tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-abort-recover-'));
    });
    (0, node_test_1.test)('abort por timeout devolve o que já foi concluído e deixa journal recuperável', async () => {
        const runId = `r-abort-${Date.now()}`;
        // Wave 1 starts inside the budget; its 1.5 s task pushes wave 2 past the 1 s limit. The margins
        // are wide so the wave-1 start still fits the budget under a loaded parallel test run.
        const slow = {
            async execute() {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                return { success: true, failure_class: null, evidence: [], output: 'ok' };
            },
        };
        const ctx = {
            projectRoot: tmp,
            sessionId: null,
            runId,
            executor: slow,
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp),
            options: { maxRunDurationMs: 1000 },
        };
        const graph = (0, graph_compiler_1.compile)(plan([task('T1', 1), task('T2', 2)]), SPEC, { default_workspace_strategy: 'inplace' });
        const result = await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(result.status, 'aborted');
        strict_1.default.deepEqual(result.completed, ['T1'], 'abort não pode descartar o progresso real');
        strict_1.default.equal((0, run_journal_1.loadJournal)(tmp, runId)?.scheduler_state, 'aborted');
        const recovered = await new scheduler_1.Scheduler().recover(runId, { ...ctx, options: {} }, graph);
        strict_1.default.ok(recovered, 'run abortada deve ser recuperável');
        strict_1.default.equal(recovered.status, 'completed');
        strict_1.default.deepEqual(recovered.completed.sort(), ['T1', 'T2']);
    });
    (0, node_test_1.test)('gate aprovado não é pedido de novo na re-execução', async () => {
        const runId = `r-gate-${Date.now()}`;
        const gateManager = new gate_manager_1.GateManager(tmp, null, runId);
        const ctx = {
            projectRoot: tmp,
            sessionId: null,
            runId,
            executor: ok,
            workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp),
            gateManager,
        };
        const graph = (0, graph_compiler_1.compile)(plan([task('T1', 1)]), SPEC, { default_workspace_strategy: 'inplace', require_approval_for_all: true });
        const first = await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(first.status, 'blocked');
        strict_1.default.equal(gateManager.listPending().length, 1);
        await gateManager.resolve(gateManager.listPending()[0], { decision: 'approved', actor: 'reviewer' });
        const second = await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(second.status, 'completed', JSON.stringify(second));
        strict_1.default.equal(gateManager.listPending().length, 0, 'não pode abrir um gate novo após aprovação');
        strict_1.default.equal(gateManager.listAll().length, 1);
    });
    (0, node_test_1.test)('workspace alocado por provider de plugin é liberado pelo mesmo provider', async () => {
        const disposedBy = [];
        function fakeManager(name) {
            return {
                isolation_level: 'shared',
                async allocate(req) {
                    return {
                        workspace_id: `${name}-${req.work_item_id}`,
                        strategy: req.strategy,
                        isolation_level: 'shared',
                        branch: null,
                        base_commit: null,
                        root_path: tmp,
                        ttl_minutes: 30,
                    };
                },
                async snapshot(id) {
                    return { snapshot_id: `snap-${id}`, workspace_id: id, commit: '', created_at: new Date().toISOString() };
                },
                async reset() { },
                async dispose() {
                    disposedBy.push(name);
                },
            };
        }
        const pluginManager = fakeManager('plugin');
        const defaultManager = fakeManager('default');
        const ctx = {
            projectRoot: tmp,
            sessionId: null,
            runId: `r-dispose-${Date.now()}`,
            executor: ok,
            workspaceManager: defaultManager,
            pluginRegistry: {
                workspaceProviderFor: () => pluginManager,
                toolProviderFor: () => undefined,
                verifierProviderFor: () => undefined,
            },
        };
        const graph = (0, graph_compiler_1.compile)(plan([task('T1', 1)]), SPEC, { default_workspace_strategy: 'inplace' });
        const result = await new scheduler_1.Scheduler().run(graph, ctx);
        strict_1.default.equal(result.status, 'completed');
        strict_1.default.deepEqual(disposedBy, ['plugin']);
    });
    (0, node_test_1.test)('teardown', () => {
        fs_1.default.rmSync(tmp, { recursive: true, force: true });
    });
});
