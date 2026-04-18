import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile, runCheck, summarizeSuite } from '../src/verification/verification-compiler';
import type { AcceptanceCheck } from '../src/verification/verification-compiler';

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

describe('VerificationCompiler', () => {
  test('compile produces checks for each criterion', () => {
    const suite = compile(SPEC, PLAN);
    assert.ok(suite.checks.length >= SPEC.criteria.length);
    assert.ok(suite.checks.some((c) => c.acceptance_ref === 'A1'));
    assert.ok(suite.checks.some((c) => c.acceptance_ref === 'A2'));
  });

  test('compile includes hashes and timestamp', () => {
    const suite = compile(SPEC, PLAN);
    assert.ok(suite.spec_hash.length === 12);
    assert.ok(suite.plan_hash.length === 12);
    assert.ok(suite.compiled_at);
  });

  test('infers unit check type for npm test commands', () => {
    const suite = compile(SPEC, PLAN);
    const a1 = suite.checks.find((c) => c.acceptance_ref === 'A1');
    assert.ok(a1);
    assert.equal(a1!.type, 'unit');
  });

  test('check with null command gets skip status when run', async () => {
    const check: AcceptanceCheck = {
      id: 'check-null',
      type: 'custom',
      command: null,
      evidence_type_expected: 'stdout',
      acceptance_ref: 'A3',
      description: 'manual check',
    };
    const result = await runCheck(check, process.cwd());
    assert.equal(result.status, 'skip');
  });

  test('runCheck passes for successful command', async () => {
    const check: AcceptanceCheck = {
      id: 'check-echo',
      type: 'smoke',
      command: 'node -e process.exit(0)',
      evidence_type_expected: 'stdout',
      acceptance_ref: null,
      description: 'exits zero',
    };
    const result = await runCheck(check, process.cwd());
    assert.equal(result.status, 'pass');
    assert.equal(result.exit_code, 0);
  });

  test('runCheck fails for non-zero exit', async () => {
    const check: AcceptanceCheck = {
      id: 'check-fail',
      type: 'smoke',
      command: 'node -e process.exit(1)',
      evidence_type_expected: 'stdout',
      acceptance_ref: null,
      description: 'exits one',
    };
    const result = await runCheck(check, process.cwd());
    assert.equal(result.status, 'fail');
    assert.equal(result.exit_code, 1);
  });

  test('runCheck records duration_ms', async () => {
    const check: AcceptanceCheck = {
      id: 'check-dur',
      type: 'smoke',
      command: 'node -e process.exit(0)',
      evidence_type_expected: 'stdout',
      acceptance_ref: null,
      description: 'duration test',
    };
    const result = await runCheck(check, process.cwd());
    assert.ok(result.duration_ms >= 0);
  });

  test('summarizeSuite counts correctly', () => {
    const results = [
      { check_id: 'c1', acceptance_ref: null, status: 'pass' as const, stdout: '', stderr: '', exit_code: 0, duration_ms: 1, error: null },
      { check_id: 'c2', acceptance_ref: null, status: 'fail' as const, stdout: '', stderr: '', exit_code: 1, duration_ms: 1, error: null },
      { check_id: 'c3', acceptance_ref: null, status: 'skip' as const, stdout: '', stderr: '', exit_code: null, duration_ms: 0, error: null },
    ];
    const summary = summarizeSuite(results);
    assert.equal(summary.total, 3);
    assert.equal(summary.pass, 1);
    assert.equal(summary.fail, 1);
    assert.equal(summary.skip, 1);
    assert.equal(summary.allPassed, false);
  });

  test('summarizeSuite reports allPassed when no failures', () => {
    const results = [
      { check_id: 'c1', acceptance_ref: null, status: 'pass' as const, stdout: '', stderr: '', exit_code: 0, duration_ms: 1, error: null },
    ];
    const summary = summarizeSuite(results);
    assert.equal(summary.allPassed, true);
  });
});
