import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { extractTestResults, missingProofs } from '../src/verification/test-report-parsers';
import { compile, runCheck, sha256File } from '../src/verification/verification-compiler';

// 1.20 — Prova executada: "Prova: arquivo › teste" (workflow do usuário) passa a ser verificada. Exit 0 sem o teste
// nomeado entre os aprovados não prova o critério.

describe('nomes de testes por runner', () => {
  test('TAP, vitest/jest/mocha verbose, pytest -v e JUnit', () => {
    const out = [
      'ok 1 - publica a linha na hora', 'not ok 2 - não publica', 'ok 3 - pendente # SKIP',
      ' ✓ tests/a.test.ts > registry > starts one session 12ms', ' × tests/a.test.ts > registry > busy',
      '  √ legacy mocha name', 'tests/test_x.py::test_ok PASSED', 'tests/test_x.py::test_bad FAILED',
      '<testcase name="junit ok" classname="x"/>', '<testcase name="junit bad"><failure>x</failure></testcase>',
    ].join('\n');
    const r = extractTestResults(out);
    assert.deepEqual(r.passed, ['publica a linha na hora', 'tests/a.test.ts > registry > starts one session', 'legacy mocha name', 'test_ok', 'junit ok']);
    assert.deepEqual(r.failed, ['não publica', 'tests/a.test.ts > registry > busy', 'test_bad', 'junit bad']);
  });

  test('missingProofs aceita "arquivo › nome" e nome parcial', () => {
    const out = ' ✓ tests/r.test.ts > voice registry (A1) > starts one session, stamps events 9ms';
    assert.deepEqual(missingProofs(['tests/r.test.ts › starts one session'], out), []);
    assert.deepEqual(missingProofs(['stops on release'], out), ['stops on release']);
  });
});

describe('check-accept com proves', () => {
  test('teste nomeado ausente da saída → proof_not_executed, mesmo com exit 0', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-proof-'));
    try {
      fs.writeFileSync(path.join(dir, 'p.test.js'), "const t=require('node:test');t('publica a linha na hora',()=>{});\n");
      const sha = sha256File(path.join(dir, 'p.test.js'));
      const suite = compile(
        { objective: null, criteria: [] },
        { tasks: [], acceptanceTests: [{ criterion: 'A1', command: 'node --test p.test.js', files: [{ path: 'p.test.js', sha256: sha }], proves: ['publica a linha na hora', 'não publica quando matched'] }] },
      );
      const check = suite.checks.find((c) => c.id === 'check-accept-a1')!;
      const result = await runCheck(check, dir);
      assert.equal(result.status, 'fail');
      assert.equal(result.error, 'proof_not_executed: não publica quando matched');

      const ok = await runCheck({ ...check, proves: ['publica a linha na hora'] }, dir);
      assert.equal(ok.status, 'pass', String(ok.error));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
