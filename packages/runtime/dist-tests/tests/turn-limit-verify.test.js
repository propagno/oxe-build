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
// OxeVoice F1 · T15: a tentativa 1 terminou o trabalho ("All 35 tests pass…") mas estourou os turnos; o scheduler
// agendou a 2ª sem rodar o verify e pagou de novo (OXB-026). O verify é o juiz, não o fim da conversa do LLM.
const SPEC = { objective: 'turn limit', criteria: [] };
function graphFor(verifyCommand) {
    const plan = {
        tasks: [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
        waves: { 1: ['T1'] },
        totalTasks: 1,
    };
    const graph = (0, graph_compiler_1.compile)(plan, SPEC, { default_workspace_strategy: 'inplace' });
    for (const node of graph.nodes.values())
        node.policy.max_retries = 2;
    return graph;
}
function setup(results) {
    const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-turnlimit-'));
    let calls = 0;
    const executor = {
        async execute() {
            const r = results[Math.min(calls, results.length - 1)];
            calls += 1;
            return r;
        },
    };
    const events = [];
    const ctx = {
        projectRoot: tmp, sessionId: null, runId: `r-tl-${Date.now()}-${Math.random()}`, executor,
        workspaceManager: new inplace_1.InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
    };
    return { tmp, events, ctx, calls: () => calls };
}
const exhausted = (evidence) => ({
    success: false, failure_class: 'llm', evidence, output: 'All tests pass. Running the final verification…', completed_by: 'turn_limit_exhausted',
});
(0, node_test_1.describe)('verify após turn limit (OXB-026)', () => {
    (0, node_test_1.test)('trabalho escrito + verify verde conclui na 1ª tentativa, sem retry', async () => {
        const { tmp, events, ctx, calls } = setup([exhausted(['a.js'])]);
        try {
            const result = await new scheduler_1.Scheduler().run(graphFor('node -e "process.exit(0)"'), ctx);
            strict_1.default.equal(result.status, 'completed');
            strict_1.default.equal(calls(), 1, 'nenhuma tentativa extra paga');
            strict_1.default.ok(!events.some((e) => e.type === 'RetryScheduled'));
            const done = events.find((e) => e.type === 'WorkItemCompleted');
            strict_1.default.equal((done?.payload).completed_by, 'verify_after_turn_limit');
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('trabalho escrito + verify vermelho vira retry informado com a saída do verify', async () => {
        const { tmp, events, ctx } = setup([exhausted(['a.js']), { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' }]);
        try {
            const cmd = 'node -e "const f=require(\'fs\');if(f.existsSync(\'seen\'))process.exit(0);f.writeFileSync(\'seen\',\'1\');console.error(\'AssertionError: expected 1\');process.exit(1)"';
            const result = await new scheduler_1.Scheduler().run(graphFor(cmd), ctx);
            strict_1.default.equal(result.status, 'completed');
            const retry = events.find((e) => e.type === 'RetryScheduled');
            strict_1.default.equal((retry?.payload).reason, 'verify');
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('sem escrita no escopo o turn limit continua sendo falha (verde pré-existente não conta)', async () => {
        const { tmp, events, ctx, calls } = setup([exhausted([]), exhausted([]), exhausted([])]);
        try {
            const result = await new scheduler_1.Scheduler().run(graphFor('node -e "process.exit(0)"'), ctx);
            strict_1.default.equal(result.status, 'failed');
            strict_1.default.equal(calls(), 3);
            strict_1.default.ok(!events.some((e) => e.type === 'WorkItemCompleted'));
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
