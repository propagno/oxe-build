'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sdk = require('../lib/sdk/index.cjs');
const { parsePlanTasks } = require('../bin/lib/oxe-rationality.cjs');

// Regressão do e2e "linkly": o template ensinava `**Arquivos alvo:**` mas o parser só lia
// `**Arquivos prováveis:**` → mutation_scope vazio em todas as tarefas.

const PLAN = `# OXE — PLAN

## Tarefas

### T1 — Label do template

- **Arquivos alvo:** \`src/a.js\`, \`test/a.test.js\`
- **Depende de:** —
- **Onda:** 1

### T2 — Label legado

- **Arquivos prováveis:** \`src/b.js\`
- **Depende de:** T1
- **Onda:** 2

### T3 — Label curto

- **Arquivos:** \`src/c.js\`
- **Onda:** 2
`;

describe('parsePlan — rótulos de arquivos aceitos', () => {
  it('lê "Arquivos alvo", "Arquivos prováveis" e "Arquivos"', () => {
    const parsed = sdk.parsePlan(PLAN);
    const byId = Object.fromEntries(parsed.tasks.map((t) => [t.id, t]));
    assert.deepEqual(byId.T1.files, ['src/a.js', 'test/a.test.js']);
    assert.deepEqual(byId.T2.files, ['src/b.js']);
    assert.deepEqual(byId.T3.files, ['src/c.js']);
  });

  it('o template oficial de PLAN produz mutation_scope não-vazio', () => {
    const template = fs.readFileSync(path.join(__dirname, '..', 'oxe', 'templates', 'PLAN.template.md'), 'utf8');
    const parsed = sdk.parsePlan(template);
    const t1 = parsed.tasks.find((t) => t.id === 'T1');
    assert.ok(t1, 'template deve ter T1');
    assert.ok(t1.files.length > 0, `template deve declarar arquivos parseáveis, got ${JSON.stringify(t1.files)}`);
  });

  it('oxe-rationality.parsePlanTasks usa os mesmos rótulos', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-scope-'));
    try {
      const planPath = path.join(tmp, 'PLAN.md');
      fs.writeFileSync(planPath, PLAN, 'utf8');
      const tasks = parsePlanTasks(planPath);
      const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
      assert.deepEqual(byId.T1.files, ['src/a.js', 'test/a.test.js']);
      assert.deepEqual(byId.T2.files, ['src/b.js']);
      assert.deepEqual(byId.T3.files, ['src/c.js']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Benchmark 1.17 (linkly): `\`# linkly\`` e `\`mutation_scope: []\`` viravam escopo de mutação, e só o
// primeiro "Comando:" da tarefa era lido (os outros dois checks sumiam).
describe('parsePlan — escopo só com paths e todos os comandos de verificação', () => {
  const plan = `### T7 — README

- **Arquivos alvo:** \`test/meta.test.js\` (criar), \`README.md\` (reescrever — conteúdo atual é só \`# linkly\`)
- **Onda:** 1
- **Verificar:**
  - Comando: \`node --test test/meta.test.js\`

### T8 — Validação final

- **Arquivos alvo:** — (sem mutação; \`mutation_scope: []\`)
- **Onda:** 2
- **Verificar:**
  - Comando: \`npm test\` (exit 0)
  - Comando: \`node -e "process.exit(0)"\` → exit 0
`;

  it('descarta spans que não são path', () => {
    const { tasks } = sdk.parsePlan(plan);
    assert.deepEqual(tasks[0].files, ['test/meta.test.js', 'README.md']);
    assert.deepEqual(tasks[1].files, []);
  });

  it('junta vários "Comando:" com &&', () => {
    const { tasks } = sdk.parsePlan(plan);
    assert.equal(tasks[0].verifyCommand, 'node --test test/meta.test.js');
    assert.equal(tasks[1].verifyCommand, 'npm test && node -e "process.exit(0)"');
  });
});
