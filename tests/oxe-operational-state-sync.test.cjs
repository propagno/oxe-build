'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const op = require('../bin/lib/oxe-operational.cjs');

// Regressão: após Scheduler.run ninguém gravava ACTIVE-RUN → status ficava `planned` e a
// projeção escrevia "Concluídos (0)" sobre uma run com tarefas concluídas.

const SPEC = `# OXE — SPEC

## Objetivo

Fixture de sincronização de estado.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | Processo termina com 0 | \`node -e "process.exit(0)"\` |
`;

const PLAN = `# OXE — PLAN

## Resumo

Uma tarefa.

### T1 — Tarefa única

- **Arquivos alvo:** \`src/a.js\`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: \`node -e "process.exit(0)"\`
- **Aceite vinculado:** A1

## Autoavaliação do Plano

**Melhor plano atual:** sim
**Confiança:** 95%
`;

const STATE = '# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n';

function makeProject(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), SPEC, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), PLAN, 'utf8');
  fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), STATE, 'utf8');
  return tmp;
}

describe('estado pós-execute — ACTIVE-RUN e projeção refletem o resultado', () => {
  const dirs = [];

  after(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('run concluída: status completed, canonical_state e STATE.md com progresso real', async () => {
    const tmp = makeProject('oxe-sync-ok-');
    dirs.push(tmp);
    const executor = {
      async execute() {
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const res = await op.runRuntimeExecute(tmp, null, { executor, skipPreflight: true });
    assert.equal(res.result.status, 'completed', JSON.stringify(res.result));
    assert.equal(res.run.status, 'completed');

    const stored = op.readRunState(tmp, null);
    assert.equal(stored.status, 'completed');
    assert.ok(stored.canonical_state.completedWorkItems.includes('T1'), 'canonical_state deve listar T1 concluída');
    assert.equal(stored.metrics.last_execute.completed, 1);
    assert.equal(stored.metrics.last_execute.mode, 'single');

    const active = JSON.parse(fs.readFileSync(path.join(tmp, '.oxe', 'ACTIVE-RUN.json'), 'utf8'));
    assert.equal(active.status, 'completed');

    op.projectRuntimeArtifacts(tmp, null, { write: true });
    const stateMd = fs.readFileSync(path.join(tmp, '.oxe', 'STATE.md'), 'utf8');
    assert.match(stateMd, /\*\*Status da run:\*\* completed/);
    assert.match(stateMd, /\*\*Concluídos \(1\):\*\* T1/);
  });

  // Benchmark 1.17 (linkly): um verify falho deixava a run em `failed`; o verify seguinte, verde,
  // a movia para `running` em vez de `completed`.
  it('re-verify verde de run executada restaura completed', async () => {
    const tmp = makeProject('oxe-sync-reverify-');
    dirs.push(tmp);
    const executor = {
      async execute() {
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    await op.runRuntimeExecute(tmp, null, { executor, skipPreflight: true });
    op.writeRunState(tmp, null, { ...op.readRunState(tmp, null), status: 'failed' });
    await op.runRuntimeVerify(tmp, null);
    assert.equal(op.readRunState(tmp, null).status, 'completed');
  });

  it('run com executor falhando: status failed e failures registradas', async () => {
    const tmp = makeProject('oxe-sync-fail-');
    dirs.push(tmp);
    const executor = {
      async execute() {
        return { success: false, failure_class: 'test', evidence: [], output: 'boom' };
      },
    };
    const res = await op.runRuntimeExecute(tmp, null, { executor, skipPreflight: true });
    assert.equal(res.result.status, 'failed', JSON.stringify(res.result));

    const stored = op.readRunState(tmp, null);
    assert.equal(stored.status, 'failed');
    assert.ok(stored.failures.some((f) => f.work_item_id === 'T1'), 'failures deve registrar T1');
    assert.ok(stored.canonical_state.failedWorkItems.includes('T1'));
    assert.equal(stored.metrics.last_execute.failed, 1);
  });
});
