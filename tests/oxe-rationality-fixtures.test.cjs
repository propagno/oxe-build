'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { summarizeFixturePack } = require('../bin/lib/oxe-rationality.cjs');

// Regressão do e2e "linkly": o plan-checker disse "Gate do plano: OK" e o preflight do runtime
// bloqueou porque `task_id: "T2,T6"` era ignorado e `not_applicable` não era aceito.

describe('summarizeFixturePack — paridade com o gate do plano', () => {
  let tmp;
  let fixturePath;

  const planTasks = [
    { id: 'T2', title: 'Validação de URL (parser)', files: ['src/validate.js'], complexity: 'S', body: '' },
    { id: 'T3', title: 'Gerador de códigos (builder)', files: ['src/code.js'], complexity: 'S', body: '' },
    { id: 'T6', title: 'Suíte de API', files: ['test/api.test.js'], complexity: 'M', body: 'integration' },
    { id: 'T7', title: 'Teste meta e README', files: ['test/meta.test.js'], complexity: 'S', body: 'contrato do módulo' },
  ];

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-fixtures-'));
    fixturePath = path.join(tmp, 'FIXTURE-PACK.json');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function write(fixtures) {
    fs.writeFileSync(fixturePath, JSON.stringify({ schema_version: '1', ready: true, critical_gaps: [], fixtures }), 'utf8');
  }

  it('aceita task_id com vários ids ("T2,T6"), task_ids[] e tasks[]', () => {
    write([
      { id: 'FX-02', task_id: 'T2,T6', status: 'ready', expected_checks: ['node --test test/validate.test.js'] },
      { id: 'FX-03', task_ids: ['T3'], status: 'ready', expected_checks: ['node --test test/code.test.js'] },
      { id: 'FX-07', tasks: ['T7'], status: 'ready', expected_checks: ['node --test test/meta.test.js'] },
    ]);
    const pack = { tasks: [{ id: 'T2' }, { id: 'T3' }, { id: 'T6' }, { id: 'T7' }] };
    const summary = summarizeFixturePack(fixturePath, planTasks, pack);
    assert.deepEqual(summary.criticalGaps, []);
    assert.equal(summary.ready, true);
  });

  it('status not_applicable satisfaz a exigência sem expected_checks', () => {
    write([{ id: 'FX-07', task_id: 'T7', status: 'not_applicable' }]);
    const summary = summarizeFixturePack(fixturePath, planTasks, { tasks: [{ id: 'T7' }] });
    assert.deepEqual(summary.criticalGaps, []);
  });

  it('requires_fixture:false explícito vence a heurística de palavras-chave', () => {
    write([]);
    const summary = summarizeFixturePack(fixturePath, planTasks, { tasks: [{ id: 'T3', requires_fixture: false }] });
    assert.deepEqual(summary.criticalGaps, []);
  });

  it('continua apontando fixture ausente quando é exigida', () => {
    write([]);
    const summary = summarizeFixturePack(fixturePath, planTasks, { tasks: [{ id: 'T2' }] });
    assert.deepEqual(summary.criticalGaps, ['FIXTURE-PACK.json sem fixture para T2']);
    assert.equal(summary.ready, false);
  });
});
