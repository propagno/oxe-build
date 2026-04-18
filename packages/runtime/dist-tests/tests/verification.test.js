"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const verification_compiler_1 = require("../src/verification/verification-compiler");
const SPEC = {
    objective: 'OXE quality',
    criteria: [
        { id: 'A1', criterion: 'Tests pass', howToVerify: 'npm test' },
        { id: 'A2', criterion: 'No lint errors', howToVerify: 'npm run lint' },
        { id: 'A3', criterion: 'Coverage ≥ 82%', howToVerify: 'manual — check coverage report' },
    ],
};
const PLAN = {
    tasks: [
        { id: 'T1', verifyCommand: 'npm test', aceite: ['A1'] },
        { id: 'T2', verifyCommand: null, aceite: ['A2'] },
    ],
};
(0, node_test_1.describe)('VerificationCompiler', () => {
    (0, node_test_1.test)('compile produces checks for each criterion', () => {
        const suite = (0, verification_compiler_1.compile)(SPEC, PLAN);
        strict_1.default.ok(suite.checks.length >= SPEC.criteria.length);
        strict_1.default.ok(suite.checks.some((c) => c.acceptance_ref === 'A1'));
        strict_1.default.ok(suite.checks.some((c) => c.acceptance_ref === 'A2'));
    });
    (0, node_test_1.test)('compile includes hashes and timestamp', () => {
        const suite = (0, verification_compiler_1.compile)(SPEC, PLAN);
        strict_1.default.ok(suite.spec_hash.length === 12);
        strict_1.default.ok(suite.plan_hash.length === 12);
        strict_1.default.ok(suite.compiled_at);
    });
    (0, node_test_1.test)('infers unit check type for npm test commands', () => {
        const suite = (0, verification_compiler_1.compile)(SPEC, PLAN);
        const a1 = suite.checks.find((c) => c.acceptance_ref === 'A1');
        strict_1.default.ok(a1);
        strict_1.default.equal(a1.type, 'unit');
    });
    (0, node_test_1.test)('check with null command gets skip status when run', async () => {
        const check = {
            id: 'check-null',
            type: 'custom',
            command: null,
            evidence_type_expected: 'stdout',
            acceptance_ref: 'A3',
            description: 'manual check',
        };
        const result = await (0, verification_compiler_1.runCheck)(check, process.cwd());
        strict_1.default.equal(result.status, 'skip');
    });
    (0, node_test_1.test)('runCheck passes for successful command', async () => {
        const check = {
            id: 'check-echo',
            type: 'smoke',
            command: 'node -e process.exit(0)',
            evidence_type_expected: 'stdout',
            acceptance_ref: null,
            description: 'exits zero',
        };
        const result = await (0, verification_compiler_1.runCheck)(check, process.cwd());
        strict_1.default.equal(result.status, 'pass');
        strict_1.default.equal(result.exit_code, 0);
    });
    (0, node_test_1.test)('runCheck fails for non-zero exit', async () => {
        const check = {
            id: 'check-fail',
            type: 'smoke',
            command: 'node -e process.exit(1)',
            evidence_type_expected: 'stdout',
            acceptance_ref: null,
            description: 'exits one',
        };
        const result = await (0, verification_compiler_1.runCheck)(check, process.cwd());
        strict_1.default.equal(result.status, 'fail');
        strict_1.default.equal(result.exit_code, 1);
    });
    (0, node_test_1.test)('runCheck records duration_ms', async () => {
        const check = {
            id: 'check-dur',
            type: 'smoke',
            command: 'node -e process.exit(0)',
            evidence_type_expected: 'stdout',
            acceptance_ref: null,
            description: 'duration test',
        };
        const result = await (0, verification_compiler_1.runCheck)(check, process.cwd());
        strict_1.default.ok(result.duration_ms >= 0);
    });
    (0, node_test_1.test)('summarizeSuite counts correctly', () => {
        const results = [
            { check_id: 'c1', acceptance_ref: null, status: 'pass', stdout: '', stderr: '', exit_code: 0, duration_ms: 1, error: null },
            { check_id: 'c2', acceptance_ref: null, status: 'fail', stdout: '', stderr: '', exit_code: 1, duration_ms: 1, error: null },
            { check_id: 'c3', acceptance_ref: null, status: 'skip', stdout: '', stderr: '', exit_code: null, duration_ms: 0, error: null },
        ];
        const summary = (0, verification_compiler_1.summarizeSuite)(results);
        strict_1.default.equal(summary.total, 3);
        strict_1.default.equal(summary.pass, 1);
        strict_1.default.equal(summary.fail, 1);
        strict_1.default.equal(summary.skip, 1);
        strict_1.default.equal(summary.allPassed, false);
    });
    (0, node_test_1.test)('summarizeSuite reports allPassed when no failures', () => {
        const results = [
            { check_id: 'c1', acceptance_ref: null, status: 'pass', stdout: '', stderr: '', exit_code: 0, duration_ms: 1, error: null },
        ];
        const summary = (0, verification_compiler_1.summarizeSuite)(results);
        strict_1.default.equal(summary.allPassed, true);
    });
});
