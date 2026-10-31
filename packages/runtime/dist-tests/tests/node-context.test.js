"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_prompt_builder_1 = require("../src/executor/node-prompt-builder");
const node_context_1 = require("../src/executor/node-context");
// Benchmark 1.17: cada tentativa gastava turnos redescobrindo o workspace e a T3 desviou do
// IMPLEMENTATION-PACK, que nunca chegava ao prompt.
const node = {
    id: 'T3',
    title: 'gerar código curto',
    wave: 2,
    depends_on: ['T2'],
    workspace_strategy: 'inplace',
    mutation_scope: ['src/code.js'],
    actions: [{ type: 'generate_patch', targets: ['src/code.js'] }],
    verify: { must_pass: [], acceptance_refs: ['A3'], command: 'node --test test/code.test.js' },
    policy: { requires_human_approval: false, max_retries: 1 },
};
const lease = {
    workspace_id: 'ws',
    strategy: 'inplace',
    isolation_level: 'shared',
    branch: null,
    base_commit: null,
    root_path: '/repo',
    ttl_minutes: 30,
};
(0, node_test_1.describe)('NodeExecutionContext no prompt do nó', () => {
    (0, node_test_1.test)('sem contexto o prompt continua o mesmo', () => {
        strict_1.default.equal((0, node_prompt_builder_1.buildNodePrompt)(node, lease, 'r', 1), (0, node_prompt_builder_1.buildNodePrompt)(node, lease, 'r', 1, { context: null }));
        strict_1.default.deepEqual((0, node_context_1.renderNodeContext)(null), []);
    });
    (0, node_test_1.test)('corpo da tarefa, contrato, arquivos, git status e lições entram no prompt', () => {
        const prompt = (0, node_prompt_builder_1.buildNodePrompt)(node, lease, 'r', 1, {
            context: {
                taskBody: '### T3 — gerar código\n- **Arquivos alvo:** `src/code.js`',
                implementationContract: { id: 'T3', exact_paths: ['src/code.js'], symbols: [{ name: 'generateCode' }] },
                fixture: { task_id: 'T3', cases: 2 },
                workspaceFiles: [
                    { path: 'src/code.js', exists: false },
                    { path: 'src/validate.js', exists: true, bytes: 42, head: 'module.exports = { isValidUrl };' },
                ],
                gitStatus: ' M src/validate.js\n',
                lessons: ['Use node --test com caminhos explícitos'],
            },
        });
        strict_1.default.match(prompt, /## Tarefa no PLAN\n### T3 — gerar código/);
        strict_1.default.match(prompt, /## Contrato \(IMPLEMENTATION-PACK\)/);
        strict_1.default.match(prompt, /"generateCode"/);
        strict_1.default.match(prompt, /## Fixture \(FIXTURE-PACK\)/);
        strict_1.default.match(prompt, /nunca leem `\.oxe\/`/);
        strict_1.default.match(prompt, /`src\/code\.js` — não existe ainda/);
        strict_1.default.match(prompt, /`src\/validate\.js` — 42 bytes\n```\nmodule\.exports = \{ isValidUrl \};\n```/);
        strict_1.default.match(prompt, /## git status\n```\nM src\/validate\.js/);
        strict_1.default.match(prompt, /- Use node --test com caminhos explícitos/);
        // O contexto vem antes das instruções de conclusão.
        strict_1.default.ok(prompt.indexOf('## Tarefa no PLAN') < prompt.indexOf('## Conclusão da tarefa'));
    });
    (0, node_test_1.test)('orçamento: seções longas são truncadas explicitamente', () => {
        strict_1.default.equal((0, node_context_1.truncate)('abc', 10), 'abc');
        strict_1.default.match((0, node_context_1.truncate)('x'.repeat(50), 10), /^x{10}\n… \[truncado: 40 caracteres omitidos\]$/);
        const lines = (0, node_context_1.renderNodeContext)({ taskBody: 'y'.repeat(100), workspaceFiles: [{ path: 'a.js', exists: true, bytes: 900, head: 'z'.repeat(900) }] }, { taskBody: 20, contract: 10, fixture: 10, filesTotal: 30, gitStatus: 10, lessons: 10 });
        const text = lines.join('\n');
        strict_1.default.match(text, /y{20}\n… \[truncado: 80/);
        strict_1.default.match(text, /z{30}\n… \[truncado: 870/);
    });
});
