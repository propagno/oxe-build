import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { MergeGateEvaluator, PromotionPipeline } from '../src/delivery/promotion-pipeline';
import type { RunPRLink } from '../src/delivery/promotion-pipeline';
import type { RunResult } from '../src/scheduler/scheduler';
import type { VerificationManifest } from '../src/verification/verification-manifest';
import type { ResidualRiskLedger } from '../src/verification/verification-manifest';
import type { BranchManager } from '../src/delivery/branch-manager';
import type { PRManager } from '../src/delivery/pr-manager';

function okRun(runId = 'run-1'): RunResult {
  return { run_id: runId, status: 'completed', completed: ['T1', 'T2'], failed: [], blocked: [] };
}

function failedRun(): RunResult {
  return { run_id: 'run-fail', status: 'failed', completed: ['T1'], failed: ['T2'], blocked: [] };
}

function okManifest(): VerificationManifest {
  return {
    manifest_id: 'vm-abc',
    run_id: 'run-1',
    work_item_id: null,
    wave: null,
    granularity: 'run',
    profile: 'standard',
    compiled_at: new Date().toISOString(),
    checks: [],
    summary: { total: 2, pass: 2, fail: 0, skip: 0, error: 0, all_passed: true },
  };
}

function failManifest(): VerificationManifest {
  return { ...okManifest(), summary: { total: 2, pass: 1, fail: 1, skip: 0, error: 0, all_passed: false } };
}

function emptyLedger(): ResidualRiskLedger {
  return { run_id: 'run-1', generated_at: new Date().toISOString(), risks: [] };
}

function criticalLedger(): ResidualRiskLedger {
  return {
    run_id: 'run-1',
    generated_at: new Date().toISOString(),
    risks: [{
      risk_id: 'risk-1',
      work_item_id: null,
      check_id: 'c1',
      failure_class: 'deterministic',
      description: 'Critical test failure',
      severity: 'critical',
      mitigation: null,
    }],
  };
}

// Minimal mocks
function makeBranchManager(branch = 'oxe/test-branch'): BranchManager {
  return {
    currentBranch: () => branch,
  } as unknown as BranchManager;
}

function makePRManager(success: boolean, url = 'https://github.com/owner/repo/pull/42'): PRManager {
  return {
    createDraft: () => ({ success, url: success ? url : undefined, error: success ? undefined : 'gh error' }),
    isAvailable: () => true,
  } as unknown as PRManager;
}

describe('MergeGateEvaluator', () => {
  const evaluator = new MergeGateEvaluator();

  test('approves clean run with passing manifest', () => {
    const report = evaluator.evaluate(okRun(), okManifest(), emptyLedger());
    assert.equal(report.verdict, 'approved');
    assert.equal(report.reasons.length, 0);
    assert.equal(report.blocking_risks.length, 0);
  });

  test('blocks run with failed tasks', () => {
    const report = evaluator.evaluate(failedRun(), okManifest(), emptyLedger());
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.reasons.some((r) => r.includes('failed')));
  });

  test('blocks run with failed verification', () => {
    const report = evaluator.evaluate(okRun(), failManifest(), emptyLedger());
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.reasons.some((r) => r.includes('Verification')));
  });

  test('blocks run with critical risks', () => {
    const report = evaluator.evaluate(okRun(), okManifest(), criticalLedger());
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.blocking_risks.length > 0);
    assert.ok(report.blocking_risks[0].includes('CRITICAL'));
  });

  test('approves with null manifest and empty ledger', () => {
    const report = evaluator.evaluate(okRun(), null, null);
    assert.equal(report.verdict, 'approved');
  });

  test('blocks when run has blocked tasks', () => {
    const run: RunResult = { run_id: 'r', status: 'failed', completed: [], failed: [], blocked: ['T3'] };
    const report = evaluator.evaluate(run, okManifest(), emptyLedger());
    assert.equal(report.verdict, 'blocked');
    assert.ok(report.reasons.some((r) => r.includes('blocked')));
  });
});

describe('PromotionPipeline', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-promo-test-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('buildPRBody includes run summary', () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    const body = pipeline.buildPRBody(okRun(), okManifest(), emptyLedger());
    assert.ok(body.includes('run-1'));
    assert.ok(body.includes('completed'));
    assert.ok(body.includes('Verification'));
  });

  test('buildPRBody includes residual risks when present', () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    const body = pipeline.buildPRBody(okRun(), okManifest(), criticalLedger());
    assert.ok(body.includes('Residual Risks'));
    assert.ok(body.includes('Critical test failure'));
  });

  test('promote returns blocked when gate verdict is blocked', async () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    const link = await pipeline.promote(failedRun(), okManifest(), emptyLedger());
    assert.equal(link.status, 'blocked');
    assert.equal(link.pr_url, null);
  });

  test('promote creates PR for approved run', async () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    const link = await pipeline.promote(okRun('run-approved'), okManifest(), emptyLedger());
    assert.equal(link.status, 'open');
    assert.ok(link.pr_url !== null);
    assert.ok(link.pr_url!.includes('github.com'));
  });

  test('promote returns blocked when gh fails', async () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(false));
    const link = await pipeline.promote(okRun('run-gh-fail'), okManifest(), emptyLedger());
    assert.equal(link.status, 'blocked');
  });

  test('savePRLink and loadPRLink round-trip', () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    const link: RunPRLink = {
      run_id: 'run-persist',
      branch: 'oxe/test',
      pr_url: 'https://github.com/owner/repo/pull/10',
      pr_number: 10,
      status: 'open',
      created_at: new Date().toISOString(),
      merged_at: null,
    };
    pipeline.savePRLink('run-persist', link);
    const loaded = pipeline.loadPRLink('run-persist');
    assert.ok(loaded !== null);
    assert.equal(loaded!.run_id, 'run-persist');
    assert.equal(loaded!.pr_url, link.pr_url);
  });

  test('loadPRLink returns null for unknown run', () => {
    const pipeline = new PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
    assert.equal(pipeline.loadPRLink('no-such-run'), null);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
