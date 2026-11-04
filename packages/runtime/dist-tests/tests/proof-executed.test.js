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
const test_report_parsers_1 = require("../src/verification/test-report-parsers");
const verification_compiler_1 = require("../src/verification/verification-compiler");
// 1.20 — Prova executada: "Prova: arquivo › teste" (workflow do usuário) passa a ser verificada. Exit 0 sem o teste
// nomeado entre os aprovados não prova o critério.
(0, node_test_1.describe)('nomes de testes por runner', () => {
    (0, node_test_1.test)('TAP, vitest/jest/mocha verbose, pytest -v e JUnit', () => {
        const out = [
            'ok 1 - publica a linha na hora', 'not ok 2 - não publica', 'ok 3 - pendente # SKIP',
            ' ✓ tests/a.test.ts > registry > starts one session 12ms', ' × tests/a.test.ts > registry > busy',
            '  √ legacy mocha name', 'tests/test_x.py::test_ok PASSED', 'tests/test_x.py::test_bad FAILED',
            '<testcase name="junit ok" classname="x"/>', '<testcase name="junit bad"><failure>x</failure></testcase>',
        ].join('\n');
        const r = (0, test_report_parsers_1.extractTestResults)(out);
        strict_1.default.deepEqual(r.passed, ['publica a linha na hora', 'tests/a.test.ts > registry > starts one session', 'legacy mocha name', 'test_ok', 'junit ok']);
        strict_1.default.deepEqual(r.failed, ['não publica', 'tests/a.test.ts > registry > busy', 'test_bad', 'junit bad']);
    });
    (0, node_test_1.test)('missingProofs aceita "arquivo › nome" e nome parcial', () => {
        const out = ' ✓ tests/r.test.ts > voice registry (A1) > starts one session, stamps events 9ms';
        strict_1.default.deepEqual((0, test_report_parsers_1.missingProofs)(['tests/r.test.ts › starts one session'], out), []);
        strict_1.default.deepEqual((0, test_report_parsers_1.missingProofs)(['stops on release'], out), ['stops on release']);
    });
});
(0, node_test_1.describe)('check-accept com proves', () => {
    (0, node_test_1.test)('teste nomeado ausente da saída → proof_not_executed, mesmo com exit 0', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-proof-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(dir, 'p.test.js'), "const t=require('node:test');t('publica a linha na hora',()=>{});\n");
            const sha = (0, verification_compiler_1.sha256File)(path_1.default.join(dir, 'p.test.js'));
            const suite = (0, verification_compiler_1.compile)({ objective: null, criteria: [] }, { tasks: [], acceptanceTests: [{ criterion: 'A1', command: 'node --test p.test.js', files: [{ path: 'p.test.js', sha256: sha }], proves: ['publica a linha na hora', 'não publica quando matched'] }] });
            const check = suite.checks.find((c) => c.id === 'check-accept-a1');
            const result = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(result.status, 'fail');
            strict_1.default.equal(result.error, 'proof_not_executed: não publica quando matched');
            const ok = await (0, verification_compiler_1.runCheck)({ ...check, proves: ['publica a linha na hora'] }, dir);
            strict_1.default.equal(ok.status, 'pass', String(ok.error));
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
});
