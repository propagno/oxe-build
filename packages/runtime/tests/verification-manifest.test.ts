import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  buildManifest,
  buildRiskLedger,
  classifyFailure,
  summarizeEvidenceCoverage,
  saveManifest,
  loadManifest,
  saveRiskLedger,
  loadRiskLedger,
} from '../src/verification/verification-manifest';
import type { CheckResult } from '../src/verification/verification-compiler';

function makeCheck(overrides: Partial<CheckResult> & { check_id: string }): CheckResult {
  return {
    acceptance_ref: null,
    status: 'pass',
    stdout: '',
    stderr: '',
    exit_code: 0,
    duration_ms: 10,
    error: null,
    ...overrides,
  };
}

describe('VerificationManifest', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-vm-test-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('buildManifest computes correct summary', () => {
    const results: CheckResult[] = [
      makeCheck({ check_id: 'c1', status: 'pass' }),
      makeCheck({ check_id: 'c2', status: 'fail', exit_code: 1, stderr: 'assertion failed' }),
      makeCheck({ check_id: 'c3', status: 'skip' }),
    ];
    const manifest = buildManifest('run-1', results);
    assert.equal(manifest.summary.total, 3);
    assert.equal(manifest.summary.pass, 1);
    assert.equal(manifest.summary.fail, 1);
    assert.equal(manifest.summary.skip, 1);
    assert.equal(manifest.summary.all_passed, false);
  });

  test('buildManifest all_passed when only pass and skip', () => {
    const results: CheckResult[] = [
      makeCheck({ check_id: 'c1', status: 'pass' }),
      makeCheck({ check_id: 'c2', status: 'skip' }),
    ];
    const manifest = buildManifest('run-2', results);
    assert.equal(manifest.summary.all_passed, true);
  });

  test('buildManifest uses correct profile and granularity', () => {
    const manifest = buildManifest('run-3', [], {
      workItemId: 'T1',
      wave: 2,
      profile: 'critical',
      granularity: 'work_item',
    });
    assert.equal(manifest.profile, 'critical');
    assert.equal(manifest.granularity, 'work_item');
    assert.equal(manifest.work_item_id, 'T1');
    assert.equal(manifest.wave, 2);
  });

  test('classifyFailure returns null for pass', () => {
    const r = makeCheck({ check_id: 'c1', status: 'pass' });
    assert.equal(classifyFailure(r), null);
  });

  test('classifyFailure returns timeout for timeout error', () => {
    const r = makeCheck({ check_id: 'c1', status: 'error', error: 'command timed out', exit_code: null });
    assert.equal(classifyFailure(r), 'timeout');
  });

  test('classifyFailure returns env_setup for null exit code with error', () => {
    const r = makeCheck({ check_id: 'c1', status: 'error', error: 'ENOENT', exit_code: null });
    assert.equal(classifyFailure(r), 'env_setup');
  });

  test('classifyFailure returns policy_failure for policy in stderr', () => {
    const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'policy denied' });
    assert.equal(classifyFailure(r), 'policy_failure');
  });

  test('classifyFailure returns evidence_missing when no output', () => {
    const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stdout: '', stderr: '' });
    assert.equal(classifyFailure(r), 'evidence_missing');
  });

  test('classifyFailure defaults to deterministic for generic failure', () => {
    const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'assertion error at line 5' });
    assert.equal(classifyFailure(r), 'deterministic');
  });

  test('buildRiskLedger creates risks for failing checks under profile', () => {
    const results: CheckResult[] = [
      makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'assertion error' }),
    ];
    const manifest = buildManifest('run-4', results, { profile: 'standard' });
    const ledger = buildRiskLedger('run-4', manifest);
    assert.equal(ledger.risks.length, 1);
    assert.equal(ledger.risks[0].check_id, 'c1');
    assert.equal(ledger.risks[0].failure_class, 'deterministic');
    assert.equal(ledger.risks[0].severity, 'high');
  });

  test('buildRiskLedger does not add risk for passing checks', () => {
    const results: CheckResult[] = [
      makeCheck({ check_id: 'c1', status: 'pass' }),
    ];
    const manifest = buildManifest('run-5', results, { profile: 'standard' });
    const ledger = buildRiskLedger('run-5', manifest);
    assert.equal(ledger.risks.length, 0);
  });

  test('buildRiskLedger only includes failure classes in profile scope', () => {
    const results: CheckResult[] = [
      // flaky not in 'standard' profile required checks
      makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stdout: 'sporadic', stderr: 'sporadic' }),
    ];
    const manifest = buildManifest('run-6', results, { profile: 'quick' });
    // 'quick' only includes deterministic
    const ledger = buildRiskLedger('run-6', manifest);
    // deterministic should appear (fallback for generic failures)
    assert.equal(ledger.risks.length, 1);
  });

  test('summarizeEvidenceCoverage computes percentage from manifest refs', () => {
    const manifest = buildManifest('run-coverage', [
      makeCheck({ check_id: 'c1', status: 'pass', evidence_refs: ['ev-1'] }),
      makeCheck({ check_id: 'c2', status: 'fail' }),
    ], {
      evidenceRefs: new Map([
        ['c1', ['ev-1']],
      ]),
    });
    const coverage = summarizeEvidenceCoverage(manifest);
    assert.equal(coverage.total_checks, 2);
    assert.equal(coverage.checks_with_evidence, 1);
    assert.equal(coverage.coverage_percent, 50);
  });

  test('saveManifest and loadManifest round-trip', () => {
    const results: CheckResult[] = [makeCheck({ check_id: 'c1', status: 'pass' })];
    const manifest = buildManifest('run-persist', results);
    saveManifest(tmpDir, 'run-persist', manifest);
    const loaded = loadManifest(tmpDir, 'run-persist');
    assert.ok(loaded !== null);
    assert.equal(loaded!.manifest_id, manifest.manifest_id);
    assert.equal(loaded!.summary.pass, 1);
  });

  test('loadManifest returns null when file not found', () => {
    const result = loadManifest(tmpDir, 'no-such-run');
    assert.equal(result, null);
  });

  test('saveRiskLedger and loadRiskLedger round-trip', () => {
    const results: CheckResult[] = [
      makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'error' }),
    ];
    const manifest = buildManifest('run-risks', results);
    const ledger = buildRiskLedger('run-risks', manifest);
    saveRiskLedger(tmpDir, 'run-risks', ledger);
    const loaded = loadRiskLedger(tmpDir, 'run-risks');
    assert.ok(loaded !== null);
    assert.equal(loaded!.run_id, 'run-risks');
  });

  test('loadRiskLedger returns null when file not found', () => {
    assert.equal(loadRiskLedger(tmpDir, 'no-such-run'), null);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
