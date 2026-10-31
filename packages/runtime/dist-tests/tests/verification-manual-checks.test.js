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
const verification_manifest_1 = require("../src/verification/verification-manifest");
const promotion_pipeline_1 = require("../src/delivery/promotion-pipeline");
// Regressão do e2e "linkly": prosa de "Como verificar" era executada como comando shell e
// `package.json` (um path entre crases) virava `&& package.json`.
const spec = {
    objective: 'linkly',
    criteria: [
        { id: 'A1', criterion: 'botão visível', howToVerify: 'Abrir o app e conferir visualmente que o botão aparece' },
        { id: 'A2', criterion: 'POST cria link', howToVerify: '`npm test` — `test/api.test.js` caso "POST /links cria link"' },
        { id: 'A3', criterion: 'scripts.test', howToVerify: 'Inspeção de `package.json` (`scripts.test`)' },
        { id: 'A4', criterion: 'oculto', howToVerify: '# pendente' },
    ],
};
const emptyPlan = { tasks: [] };
function manualResult(id, ref) {
    return {
        check_id: id,
        acceptance_ref: ref,
        status: 'skip',
        stdout: '',
        stderr: '',
        exit_code: null,
        duration_ms: 0,
        error: null,
        skip_reason: 'needs_structured_check',
    };
}
function passResult(id) {
    return { check_id: id, acceptance_ref: null, status: 'pass', stdout: 'ok', stderr: '', exit_code: 0, duration_ms: 1, error: null };
}
(0, node_test_1.describe)('verification — critérios manuais nunca viram comando', () => {
    (0, node_test_1.test)('extractCommandFromHowToVerify: só spans que parecem comando', () => {
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('Abrir o app e conferir visualmente'), null);
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('`npm test` — `test/api.test.js` caso X'), 'npm test');
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('Inspeção de `package.json` (`scripts.test`)'), null);
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('npm test'), 'npm test');
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('`node --test test/a.test.js` e `npm run lint`'), 'node --test test/a.test.js && npm run lint');
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)('# manual'), null);
        strict_1.default.equal((0, verification_compiler_1.extractCommandFromHowToVerify)(''), null);
    });
    (0, node_test_1.test)('compile: prosa e paths viram checks manual com command null', () => {
        const suite = (0, verification_compiler_1.compile)(spec, emptyPlan);
        const byId = Object.fromEntries(suite.checks.map((c) => [c.id, c]));
        strict_1.default.equal(byId['check-a1'].type, 'manual');
        strict_1.default.equal(byId['check-a1'].command, null);
        strict_1.default.equal(byId['check-a2'].command, 'npm test');
        strict_1.default.equal(byId['check-a2'].type, 'unit');
        strict_1.default.equal(byId['check-a3'].type, 'manual');
        strict_1.default.equal(byId['check-a3'].command, null);
        strict_1.default.equal(byId['check-a4'].command, null);
    });
    (0, node_test_1.test)('compile: a tarefa vinculada continua a mandar no comando', () => {
        const suite = (0, verification_compiler_1.compile)(spec, { tasks: [{ id: 'T1', verifyCommand: 'node --test test/ui.test.js', aceite: ['A1'] }] });
        const a1 = suite.checks.find((c) => c.id === 'check-a1');
        strict_1.default.equal(a1.command, 'node --test test/ui.test.js');
        strict_1.default.equal(a1.type, 'unit');
    });
    (0, node_test_1.test)('runCheck: check manual → skip com needs_structured_check', async () => {
        const check = {
            id: 'check-a1',
            type: 'manual',
            command: null,
            evidence_type_expected: 'stdout',
            acceptance_ref: 'A1',
            description: 'manual',
        };
        const result = await (0, verification_compiler_1.runCheck)(check, os_1.default.tmpdir());
        strict_1.default.equal(result.status, 'skip');
        strict_1.default.equal(result.skip_reason, 'needs_structured_check');
    });
    (0, node_test_1.test)('verifyRun: critérios manuais deixam a run partial com gaps nomeados', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-manual-'));
        try {
            const suite = (0, verification_compiler_1.compile)({ objective: 'x', criteria: [spec.criteria[0]] }, emptyPlan);
            const result = await (0, verification_compiler_1.verifyRun)({ projectRoot: tmp, runId: 'run-manual', workItemId: 'run', cwd: tmp, suite });
            strict_1.default.equal(result.status, 'partial');
            strict_1.default.equal(result.gaps.length, 1);
            strict_1.default.match(result.gaps[0], /A1/);
            strict_1.default.equal(result.manifest?.summary.all_passed, false);
            strict_1.default.equal(result.manifest?.summary.manual, 1);
            strict_1.default.equal((0, verification_compiler_1.summarizeSuite)(result.check_results).manual, 1);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('buildManifest: skip manual não é all_passed; skip deliberado continua passando', () => {
        const withManual = (0, verification_manifest_1.buildManifest)('r', [passResult('c1'), manualResult('c2', 'A2')]);
        strict_1.default.equal(withManual.summary.all_passed, false);
        strict_1.default.equal(withManual.summary.manual, 1);
        const plainSkip = (0, verification_manifest_1.buildManifest)('r', [passResult('c1'), { ...manualResult('c2', 'A2'), skip_reason: 'no_command' }]);
        strict_1.default.equal(plainSkip.summary.all_passed, true);
        strict_1.default.equal(plainSkip.summary.manual, 0);
    });
    (0, node_test_1.test)('MergeGateEvaluator bloqueia promoção quando há critério manual', () => {
        const manifest = (0, verification_manifest_1.buildManifest)('r', [passResult('c1'), manualResult('c2', 'A2')]);
        const runResult = { run_id: 'r', status: 'completed', completed: ['T1'], failed: [], blocked: [] };
        const report = new promotion_pipeline_1.MergeGateEvaluator().evaluate(runResult, manifest, null, [], null, 0);
        strict_1.default.equal(report.verdict, 'blocked');
        strict_1.default.ok(report.reasons.some((r) => /without executable check/.test(r)), report.reasons.join(' | '));
    });
});
