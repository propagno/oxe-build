'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const op = require('../bin/lib/oxe-operational.cjs');

// Regressão: o scheduler persistia cada evento via bus e o onEvent de runRuntimeExecute
// gravava de novo com outro id → 2× eventos (RunStarted: 2 numa única run).

const SPEC = `# OXE — SPEC

## Objetivo

Fixture de eventos.

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

const okExecutor = {
  async execute() {
    return { success: true, failure_class: null, evidence: [], output: 'ok' };
  },
};

describe('eventos do runtime — um único sink, ids estáveis', () => {
  let tmp;

  before(() => {
    tmp = makeProject('oxe-events-');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('cada evento da run é gravado uma única vez com event_id único', async () => {
    const res = await op.runRuntimeExecute(tmp, null, { executor: okExecutor, skipPreflight: true });
    assert.equal(res.result.status, 'completed', JSON.stringify(res.result));
    const events = op.readEvents(tmp, null);
    const ids = events.map((e) => e.event_id);
    assert.equal(new Set(ids).size, ids.length, 'event_id duplicado no log');
    const count = (type) => events.filter((e) => e.type === type).length;
    assert.equal(count('RunStarted'), 1);
    assert.equal(count('RunCompleted'), 1);
    assert.equal(count('WorkItemCompleted'), 1);
    assert.equal(count('AttemptStarted'), 1);
  });

  it('appendEvent é idempotente para o mesmo id (vindo como id ou event_id)', () => {
    const before = op.readEvents(tmp, null).length;
    op.appendEvent(tmp, null, { id: 'evt-dup-1', type: 'custom' });
    op.appendEvent(tmp, null, { event_id: 'evt-dup-1', type: 'custom' });
    const events = op.readEvents(tmp, null);
    assert.equal(events.length, before + 1);
    assert.equal(events[events.length - 1].event_id, 'evt-dup-1');
  });
});
