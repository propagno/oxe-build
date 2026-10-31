import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodePrompt } from '../src/executor/node-prompt-builder';
import { renderNodeContext, truncate } from '../src/executor/node-context';
import type { GraphNode } from '../src/compiler/graph-compiler';
import type { WorkspaceLease } from '../src/models/workspace';

// Benchmark 1.17: cada tentativa gastava turnos redescobrindo o workspace e a T3 desviou do
// IMPLEMENTATION-PACK, que nunca chegava ao prompt.

const node: GraphNode = {
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

const lease: WorkspaceLease = {
  workspace_id: 'ws',
  strategy: 'inplace',
  isolation_level: 'shared',
  branch: null,
  base_commit: null,
  root_path: '/repo',
  ttl_minutes: 30,
};

describe('NodeExecutionContext no prompt do nó', () => {
  test('sem contexto o prompt continua o mesmo', () => {
    assert.equal(
      buildNodePrompt(node, lease, 'r', 1),
      buildNodePrompt(node, lease, 'r', 1, { context: null }),
    );
    assert.deepEqual(renderNodeContext(null), []);
  });

  test('corpo da tarefa, contrato, arquivos, git status e lições entram no prompt', () => {
    const prompt = buildNodePrompt(node, lease, 'r', 1, {
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
    assert.match(prompt, /## Tarefa no PLAN\n### T3 — gerar código/);
    assert.match(prompt, /## Contrato \(IMPLEMENTATION-PACK\)/);
    assert.match(prompt, /"generateCode"/);
    assert.match(prompt, /## Fixture \(FIXTURE-PACK\)/);
    assert.match(prompt, /nunca leem `\.oxe\/`/);
    assert.match(prompt, /`src\/code\.js` — não existe ainda/);
    assert.match(prompt, /`src\/validate\.js` — 42 bytes\n```\nmodule\.exports = \{ isValidUrl \};\n```/);
    assert.match(prompt, /## git status\n```\nM src\/validate\.js/);
    assert.match(prompt, /- Use node --test com caminhos explícitos/);
    // O contexto vem antes das instruções de conclusão.
    assert.ok(prompt.indexOf('## Tarefa no PLAN') < prompt.indexOf('## Conclusão da tarefa'));
  });

  test('orçamento: seções longas são truncadas explicitamente', () => {
    assert.equal(truncate('abc', 10), 'abc');
    assert.match(truncate('x'.repeat(50), 10), /^x{10}\n… \[truncado: 40 caracteres omitidos\]$/);
    const lines = renderNodeContext(
      { taskBody: 'y'.repeat(100), workspaceFiles: [{ path: 'a.js', exists: true, bytes: 900, head: 'z'.repeat(900) }] },
      { taskBody: 20, contract: 10, fixture: 10, filesTotal: 30, gitStatus: 10, lessons: 10 },
    );
    const text = lines.join('\n');
    assert.match(text, /y{20}\n… \[truncado: 80/);
    assert.match(text, /z{30}\n… \[truncado: 870/);
  });
});
