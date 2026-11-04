'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const coverage = require('../bin/lib/oxe-criterion-coverage.cjs');

// 1.21 · OXB-030 (ledger-api run 1): o critério A10 citava 413, o teste congelado não exercitava, a fase fechou e o
// oráculo independente pegou o defeito. Os termos verificáveis do critério precisam estar no teste que o prova.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('cobertura do critério pelo teste congelado', () => {
  it('extrai códigos de status, `code spans` e "literais"', () => {
    assert.deepEqual(coverage.verifiableTerms('erros 400/401/404/405/413 e `readJson` com "not_found"; 2026 e 12.34 não contam'), ['400', '401', '404', '405', '413', 'readJson', 'not_found']);
  });

  it('aponta o termo do critério ausente do teste e ignora critérios sem termos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cov-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'a10.test.js'), 'assert.equal(res.status, 401); assert.equal(r.status, 404);');
    fs.writeFileSync(path.join(dir, 'a1.test.js'), 'ok');
    const spec = { criteria: [{ id: 'A10', criterion: 'erros 401/404/413' }, { id: 'A1', criterion: 'o lançamento é criado' }] };
    const plan = { acceptanceTests: [{ criterion: 'A10', files: ['a10.test.js'] }, { criterion: 'A1', files: ['a1.test.js'] }] };
    const out = coverage.uncoveredCriterionTerms({ spec, plan, projectRoot: dir });
    assert.equal(out.length, 1);
    assert.match(out[0], /^A10: o teste de aceite não exercita "413"/);
  });
});
