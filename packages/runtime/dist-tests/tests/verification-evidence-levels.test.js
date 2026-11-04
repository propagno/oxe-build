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
const verification_compiler_1 = require("../src/verification/verification-compiler");
const test_report_parsers_1 = require("../src/verification/test-report-parsers");
const verification_manifest_1 = require("../src/verification/verification-manifest");
const evidence_store_1 = require("../src/evidence/evidence-store");
// Regressão do e2e "linkly": `node --test test/api.test.js test/store.test.js` saiu com 0 com
// api.test.js inexistente, e a cobertura de evidência era sempre 100% (sumário JSON incondicional).
function check(id, type, command) {
    return { id, type, command, evidence_type_expected: 'stdout', acceptance_ref: null, description: id };
}
(0, node_test_1.describe)('verification — evidência: exit code 0 não é prova', () => {
    let tmp;
    (0, node_test_1.test)('setup', () => {
        tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-evidence-'));
        fs_1.default.writeFileSync(path_1.default.join(tmp, 'existing.test.js'), "const test = require('node:test'); const assert = require('node:assert');\ntest('ok', () => assert.ok(true));\n", 'utf8');
    });
    (0, node_test_1.test)('parseTestReport reconhece os formatos comuns', () => {
        const tap = (0, test_report_parsers_1.parseTestReport)('TAP version 13\nok 1 - a\n# tests 3\n# pass 2\n# fail 1\n');
        strict_1.default.deepEqual([tap.format, tap.tests_executed, tap.passed, tap.failed], ['tap', 3, 2, 1]);
        const spec = (0, test_report_parsers_1.parseTestReport)('✔ ok (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\n');
        strict_1.default.deepEqual([spec.format, spec.tests_executed], ['tap', 1]);
        const jest = (0, test_report_parsers_1.parseTestReport)('Tests:       1 failed, 2 passed, 3 total\nTime: 1s');
        strict_1.default.deepEqual([jest.format, jest.tests_executed, jest.passed, jest.failed], ['jest', 3, 2, 1]);
        const vitest = (0, test_report_parsers_1.parseTestReport)(' Test Files  1 passed (1)\n      Tests  1 failed | 4 passed (5)\n');
        strict_1.default.deepEqual([vitest.format, vitest.tests_executed, vitest.passed, vitest.failed], ['vitest', 5, 4, 1]);
        const mocha = (0, test_report_parsers_1.parseTestReport)('\n  3 passing (20ms)\n  1 failing\n');
        strict_1.default.deepEqual([mocha.format, mocha.tests_executed, mocha.failed], ['mocha', 4, 1]);
        const pytest = (0, test_report_parsers_1.parseTestReport)('======= 2 passed, 1 failed in 0.12s =======');
        strict_1.default.deepEqual([pytest.format, pytest.tests_executed, pytest.failed], ['pytest', 3, 1]);
        const junit = (0, test_report_parsers_1.parseTestReport)('<testsuite name="x" tests="4" failures="1" errors="0"></testsuite>');
        strict_1.default.deepEqual([junit.format, junit.tests_executed, junit.passed], ['junit', 4, 3]);
        const missing = (0, test_report_parsers_1.parseTestReport)("Could not find 'test/api.test.js'\n# tests 7\n# pass 7");
        strict_1.default.deepEqual(missing.missing_files, ['test/api.test.js']);
        strict_1.default.equal((0, test_report_parsers_1.parseTestReport)('nothing here').tests_executed, null);
    });
    (0, node_test_1.test)('extractTestFileArgs ignora globs, flags e scripts inline', () => {
        strict_1.default.deepEqual((0, test_report_parsers_1.extractTestFileArgs)('node --test test/a.test.js test/b.test.js && npm test'), ['test/a.test.js', 'test/b.test.js']);
        strict_1.default.deepEqual((0, test_report_parsers_1.extractTestFileArgs)('node --test "test/*.test.js"'), []);
        strict_1.default.deepEqual((0, test_report_parsers_1.extractTestFileArgs)("node -e \"require('./test/x.test.js')\""), []);
        strict_1.default.deepEqual((0, test_report_parsers_1.extractTestFileArgs)('npx jest src/__tests__/a.spec.ts'), ['src/__tests__/a.spec.ts']);
        strict_1.default.deepEqual((0, test_report_parsers_1.extractTestFileArgs)('npm test'), []);
    });
    (0, node_test_1.test)('arquivo de teste ausente falha mesmo que o runner saísse com 0', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'unit', 'node --test missing.test.js existing.test.js'), tmp);
        strict_1.default.equal(result.status, 'fail');
        strict_1.default.match(result.error ?? '', /test_file_missing: missing\.test\.js/);
    });
    (0, node_test_1.test)('runner real com teste executado passa e registra tests_executed', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'unit', 'node --test existing.test.js'), tmp, 60000);
        strict_1.default.equal(result.status, 'pass', `${result.error}\n${result.stderr}`);
        strict_1.default.equal(result.tests_executed, 1);
    });
    (0, node_test_1.test)('check unit cujo runner reporta 0 testes falha com no_tests_executed', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'unit', 'node -e "console.log(\'# tests 0\')"'), tmp);
        strict_1.default.equal(result.status, 'fail');
        strict_1.default.equal(result.error, 'no_tests_executed');
    });
    (0, node_test_1.test)('check unit silencioso (sem relatório algum) falha com no_test_report', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'unit', 'node -e "process.exit(0)"'), tmp);
        strict_1.default.equal(result.status, 'fail');
        strict_1.default.equal(result.error, 'no_test_report');
    });
    (0, node_test_1.test)('check unit com saída não reconhecida continua passando em L0', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'unit', 'node -e "console.log(1)"'), tmp);
        strict_1.default.equal(result.status, 'pass');
        strict_1.default.equal(result.tests_executed, null);
    });
    (0, node_test_1.test)('check custom silencioso continua passando (nível L0)', async () => {
        const result = await (0, verification_compiler_1.runCheck)(check('c', 'custom', 'node -e "process.exit(0)"'), tmp);
        strict_1.default.equal(result.status, 'pass');
        strict_1.default.equal(result.tests_executed, null);
    });
    (0, node_test_1.test)('cobertura: sumário JSON não conta como evidência e skips ficam fora do denominador', async () => {
        const store = new evidence_store_1.EvidenceStore(tmp);
        const suite = {
            checks: [
                check('silent', 'custom', 'node -e "process.exit(0)"'),
                check('loud', 'custom', 'node -e "console.log(\'ok\')"'),
                check('manual', 'manual', null),
            ],
            compiled_at: new Date().toISOString(),
            spec_hash: '',
            plan_hash: '',
        };
        const executed = await (0, verification_compiler_1.executeSuite)(suite, tmp, { runId: 'run-cov', workItemId: 'T1', evidenceStore: store });
        const silent = executed.results.find((r) => r.check_id === 'silent');
        strict_1.default.deepEqual(silent.evidence_refs, []);
        strict_1.default.ok(silent.summary_evidence_ref, 'sumário continua armazenado, só não conta');
        const loud = executed.results.find((r) => r.check_id === 'loud');
        strict_1.default.equal(loud.evidence_refs?.length, 1);
        strict_1.default.equal(executed.evidence_coverage.executed_checks, 2);
        strict_1.default.equal(executed.evidence_coverage.checks_with_evidence, 1);
        strict_1.default.equal(executed.evidence_coverage.coverage_percent, 50);
    });
    (0, node_test_1.test)('summarizeEvidenceCoverage: só skips → 0%, nenhum check → 100%', () => {
        const onlySkips = (0, verification_manifest_1.buildManifest)('r', [
            { check_id: 'c1', acceptance_ref: null, status: 'skip', stdout: '', stderr: '', exit_code: null, duration_ms: 0, error: null },
        ]);
        strict_1.default.equal((0, verification_manifest_1.summarizeEvidenceCoverage)(onlySkips).coverage_percent, 0);
        strict_1.default.equal((0, verification_manifest_1.summarizeEvidenceCoverage)((0, verification_manifest_1.buildManifest)('r', [])).coverage_percent, 100);
    });
    (0, node_test_1.test)('teardown', () => {
        fs_1.default.rmSync(tmp, { recursive: true, force: true });
    });
});
