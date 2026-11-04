import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { runCheck, executeSuite } from '../src/verification/verification-compiler';
import type { AcceptanceCheck, AcceptanceCheckSuite } from '../src/verification/verification-compiler';
import { parseTestReport, extractTestFileArgs } from '../src/verification/test-report-parsers';
import { buildManifest, summarizeEvidenceCoverage } from '../src/verification/verification-manifest';
import { EvidenceStore } from '../src/evidence/evidence-store';

// Regressão do e2e "linkly": `node --test test/api.test.js test/store.test.js` saiu com 0 com
// api.test.js inexistente, e a cobertura de evidência era sempre 100% (sumário JSON incondicional).

function check(id: string, type: AcceptanceCheck['type'], command: string | null): AcceptanceCheck {
  return { id, type, command, evidence_type_expected: 'stdout', acceptance_ref: null, description: id };
}

describe('verification — evidência: exit code 0 não é prova', () => {
  let tmp: string;

  test('setup', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-evidence-'));
    fs.writeFileSync(
      path.join(tmp, 'existing.test.js'),
      "const test = require('node:test'); const assert = require('node:assert');\ntest('ok', () => assert.ok(true));\n",
      'utf8'
    );
  });

  test('parseTestReport reconhece os formatos comuns', () => {
    const tap = parseTestReport('TAP version 13\nok 1 - a\n# tests 3\n# pass 2\n# fail 1\n');
    assert.deepEqual([tap.format, tap.tests_executed, tap.passed, tap.failed], ['tap', 3, 2, 1]);

    const spec = parseTestReport('✔ ok (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n');
    assert.deepEqual([spec.format, spec.tests_executed], ['tap', 1]);

    const jest = parseTestReport('Tests:       1 failed, 2 passed, 3 total\nTime: 1s');
    assert.deepEqual([jest.format, jest.tests_executed, jest.passed, jest.failed], ['jest', 3, 2, 1]);

    const vitest = parseTestReport(' Test Files  1 passed (1)\n      Tests  1 failed | 4 passed (5)\n');
    assert.deepEqual([vitest.format, vitest.tests_executed, vitest.passed, vitest.failed], ['vitest', 5, 4, 1]);

    const mocha = parseTestReport('\n  3 passing (20ms)\n  1 failing\n');
    assert.deepEqual([mocha.format, mocha.tests_executed, mocha.failed], ['mocha', 4, 1]);

    const pytest = parseTestReport('======= 2 passed, 1 failed in 0.12s =======');
    assert.deepEqual([pytest.format, pytest.tests_executed, pytest.failed], ['pytest', 3, 1]);

    const junit = parseTestReport('<testsuite name="x" tests="4" failures="1" errors="0"></testsuite>');
    assert.deepEqual([junit.format, junit.tests_executed, junit.passed], ['junit', 4, 3]);

    const missing = parseTestReport("Could not find 'test/api.test.js'\n# tests 7\n# pass 7");
    assert.deepEqual(missing.missing_files, ['test/api.test.js']);

    assert.equal(parseTestReport('nothing here').tests_executed, null);
  });

  test('extractTestFileArgs ignora globs, flags e scripts inline', () => {
    assert.deepEqual(
      extractTestFileArgs('node --test test/a.test.js test/b.test.js && npm test'),
      ['test/a.test.js', 'test/b.test.js']
    );
    assert.deepEqual(extractTestFileArgs('node --test "test/*.test.js"'), []);
    assert.deepEqual(extractTestFileArgs("node -e \"require('./test/x.test.js')\""), []);
    assert.deepEqual(extractTestFileArgs('npx jest src/__tests__/a.spec.ts'), ['src/__tests__/a.spec.ts']);
    assert.deepEqual(extractTestFileArgs('npm test'), []);
  });

  test('arquivo de teste ausente falha mesmo que o runner saísse com 0', async () => {
    const result = await runCheck(check('c', 'unit', 'node --test missing.test.js existing.test.js'), tmp);
    assert.equal(result.status, 'fail');
    assert.match(result.error ?? '', /test_file_missing: missing\.test\.js/);
  });

  test('runner real com teste executado passa e registra tests_executed', async () => {
    const result = await runCheck(check('c', 'unit', 'node --test existing.test.js'), tmp, 60_000);
    assert.equal(result.status, 'pass', `${result.error}\n${result.stderr}`);
    assert.equal(result.tests_executed, 1);
  });

  test('check unit cujo runner reporta 0 testes falha com no_tests_executed', async () => {
    const result = await runCheck(check('c', 'unit', 'node -e "console.log(\'# tests 0\')"'), tmp);
    assert.equal(result.status, 'fail');
    assert.equal(result.error, 'no_tests_executed');
  });

  test('check unit silencioso (sem relatório algum) falha com no_test_report', async () => {
    const result = await runCheck(check('c', 'unit', 'node -e "process.exit(0)"'), tmp);
    assert.equal(result.status, 'fail');
    assert.equal(result.error, 'no_test_report');
  });

  test('check unit com saída não reconhecida continua passando em L0', async () => {
    const result = await runCheck(check('c', 'unit', 'node -e "console.log(1)"'), tmp);
    assert.equal(result.status, 'pass');
    assert.equal(result.tests_executed, null);
  });

  test('check custom silencioso continua passando (nível L0)', async () => {
    const result = await runCheck(check('c', 'custom', 'node -e "process.exit(0)"'), tmp);
    assert.equal(result.status, 'pass');
    assert.equal(result.tests_executed, null);
  });

  test('cobertura: sumário JSON não conta como evidência e skips ficam fora do denominador', async () => {
    const store = new EvidenceStore(tmp);
    const suite: AcceptanceCheckSuite = {
      checks: [
        check('silent', 'custom', 'node -e "process.exit(0)"'),
        check('loud', 'custom', 'node -e "console.log(\'ok\')"'),
        check('manual', 'manual', null),
      ],
      compiled_at: new Date().toISOString(),
      spec_hash: '',
      plan_hash: '',
    };
    const executed = await executeSuite(suite, tmp, { runId: 'run-cov', workItemId: 'T1', evidenceStore: store });
    const silent = executed.results.find((r) => r.check_id === 'silent')!;
    assert.deepEqual(silent.evidence_refs, []);
    assert.ok(silent.summary_evidence_ref, 'sumário continua armazenado, só não conta');
    const loud = executed.results.find((r) => r.check_id === 'loud')!;
    assert.equal(loud.evidence_refs?.length, 1);
    assert.equal(executed.evidence_coverage.executed_checks, 2);
    assert.equal(executed.evidence_coverage.checks_with_evidence, 1);
    assert.equal(executed.evidence_coverage.coverage_percent, 50);
  });

  test('summarizeEvidenceCoverage: só skips → 0%, nenhum check → 100%', () => {
    const onlySkips = buildManifest('r', [
      { check_id: 'c1', acceptance_ref: null, status: 'skip', stdout: '', stderr: '', exit_code: null, duration_ms: 0, error: null },
    ]);
    assert.equal(summarizeEvidenceCoverage(onlySkips).coverage_percent, 0);
    assert.equal(summarizeEvidenceCoverage(buildManifest('r', [])).coverage_percent, 100);
  });

  test('teardown', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
