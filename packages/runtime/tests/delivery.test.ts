import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCIChecks,
  summarizeCIResults,
  planConsistencyCheck,
  verifyAcceptanceCheck,
  policyCheck,
  securityBaselineCheck,
  runtimeEvidenceIntegrityCheck,
  OXE_CI_CHECKS,
} from '../src/delivery/ci-checks';
import { BranchManager } from '../src/delivery/branch-manager';
import { PRManager } from '../src/delivery/pr-manager';
import { PromotionPipeline, MergeGateEvaluator } from '../src/delivery/promotion-pipeline';
import { loadCommitRecord, loadPromotionRecord } from '../src/delivery/delivery-records';
import os from 'os';
import fs from 'fs';
import path from 'path';
import type { RunResult } from '../src/scheduler/scheduler';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-delivery-'));
}

function setupOxeDir(root: string, sessionId: string | null = null): string {
  const base = sessionId ? path.join(root, '.oxe', sessionId) : path.join(root, '.oxe');
  fs.mkdirSync(path.join(base, 'execution'), { recursive: true });
  fs.mkdirSync(path.join(base, 'verification'), { recursive: true });
  return base;
}

describe('CI Checks — planConsistencyCheck', () => {
  it('skips when no ACTIVE-RUN.json', async () => {
    const root = tmpDir();
    const res = await planConsistencyCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'skip');
  });

  it('fails when run_id missing', async () => {
    const root = tmpDir();
    setupOxeDir(root);
    fs.writeFileSync(path.join(root, '.oxe', 'ACTIVE-RUN.json'), JSON.stringify({ compiled_graph: {} }));
    const res = await planConsistencyCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'fail');
  });

  it('passes with valid ACTIVE-RUN.json', async () => {
    const root = tmpDir();
    setupOxeDir(root);
    fs.writeFileSync(path.join(root, '.oxe', 'ACTIVE-RUN.json'), JSON.stringify({ run_id: 'r-001', compiled_graph: { nodes: {}, metadata: {} } }));
    const res = await planConsistencyCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'pass');
  });
});

describe('CI Checks — verifyAcceptanceCheck', () => {
  it('skips when no VERIFY.md', async () => {
    const root = tmpDir();
    const res = await verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'skip');
  });

  it('fails when VERIFY.md has fail lines', async () => {
    const root = tmpDir();
    setupOxeDir(root);
    fs.writeFileSync(path.join(root, '.oxe', 'VERIFY.md'), '✗ FAIL criterion A\n✓ PASS criterion B\n');
    const res = await verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'fail');
  });

  it('passes when VERIFY.md has only pass lines', async () => {
    const root = tmpDir();
    setupOxeDir(root);
    fs.writeFileSync(path.join(root, '.oxe', 'VERIFY.md'), '✓ PASS criterion A\n✓ PASS criterion B\n');
    const res = await verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'pass');
  });
});

describe('CI Checks — policyCheck', () => {
  it('passes when no GATES.json', async () => {
    const root = tmpDir();
    const res = await policyCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'pass');
  });

  it('fails when pending gates exist', async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, '.oxe', 'execution'), { recursive: true });
    const gates = [{ gate_id: 'g1', scope: 'work_item:t1', status: 'pending' }];
    fs.writeFileSync(path.join(root, '.oxe', 'execution', 'GATES.json'), JSON.stringify(gates));
    const res = await policyCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'fail');
  });
});

describe('CI Checks — securityBaselineCheck', () => {
  it('skips when no evidence store provided', async () => {
    const root = tmpDir();
    const res = await securityBaselineCheck.run({ projectRoot: root, sessionId: null });
    assert.equal(res.status, 'skip');
  });

  it('skips when no evidence directory for run', async () => {
    const root = tmpDir();
    const res = await securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-001', evidenceStore: {} as never });
    assert.equal(res.status, 'skip');
  });

  it('detects secret patterns', async () => {
    const root = tmpDir();
    const runDir = path.join(root, '.oxe', 'evidence', 'runs', 'r-001');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'output.txt'), 'api_key: "supersecretvalue123"');
    const res = await securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-001', evidenceStore: {} as never });
    assert.equal(res.status, 'fail');
  });

  it('passes when no secrets found', async () => {
    const root = tmpDir();
    const runDir = path.join(root, '.oxe', 'evidence', 'runs', 'r-002');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'output.txt'), 'All tests passed.');
    const res = await securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-002', evidenceStore: {} as never });
    assert.equal(res.status, 'pass');
  });
});

describe('CI Checks — runCIChecks + summarize', () => {
  it('runs all default checks', async () => {
    const root = tmpDir();
    const results = await runCIChecks({ projectRoot: root, sessionId: null });
    assert.equal(results.length, OXE_CI_CHECKS.length);
  });

  it('summarizeCIResults counts correctly', () => {
    const results = [
      { check: 'a', status: 'pass' as const, message: '' },
      { check: 'b', status: 'fail' as const, message: '' },
      { check: 'c', status: 'skip' as const, message: '' },
    ];
    const summary = summarizeCIResults(results);
    assert.equal(summary.total, 3);
    assert.equal(summary.pass, 1);
    assert.equal(summary.fail, 1);
    assert.equal(summary.skip, 1);
    assert.equal(summary.allPassed, false);
  });
});

describe('BranchManager', () => {
  it('instantiates without throwing', () => {
    const bm = new BranchManager(process.cwd());
    assert.ok(bm);
  });

  it('currentBranch returns a string', () => {
    const bm = new BranchManager(process.cwd());
    const branch = bm.currentBranch();
    assert.equal(typeof branch, 'string');
    assert.ok(branch.length > 0);
  });

  it('currentCommit returns a string', () => {
    const bm = new BranchManager(process.cwd());
    const commit = bm.currentCommit();
    assert.equal(typeof commit, 'string');
  });

  it('listOxeBranches returns array', () => {
    const bm = new BranchManager(process.cwd());
    const branches = bm.listOxeBranches();
    assert.ok(Array.isArray(branches));
  });
});

describe('PRManager', () => {
  it('instantiates without throwing', () => {
    const pm = new PRManager(process.cwd());
    assert.ok(pm);
  });

  it('isAvailable returns boolean', () => {
    const pm = new PRManager(process.cwd());
    assert.equal(typeof pm.isAvailable(), 'boolean');
  });
});

describe('PromotionPipeline', () => {
  function runResult(overrides: Partial<RunResult> = {}): RunResult {
    return {
      run_id: 'run-delivery',
      status: 'completed',
      completed: ['T1'],
      failed: [],
      blocked: [],
      ...overrides,
    };
  }

  it('records local commit separately from promotion', () => {
    const root = tmpDir();
    const pipeline = new PromotionPipeline(root, new BranchManager(process.cwd()), new PRManager(process.cwd()));
    const record = pipeline.recordLocalCommit(runResult(), null, null, {
      commitMessage: 'feat(runtime): close enterprise loop',
      commitSha: 'abc123',
      summaryPath: '.oxe/COMMIT-SUMMARY.md',
    });
    assert.equal(record.status, 'committed');
    assert.equal(record.message, 'feat(runtime): close enterprise loop');
    const stored = loadCommitRecord(root, 'run-delivery');
    assert.ok(stored);
    assert.equal(stored!.commit_sha, 'abc123');
  });

  it('blocks promotion when pending gates exist', async () => {
    const root = tmpDir();
    const pipeline = new PromotionPipeline(root, new BranchManager(process.cwd()), new PRManager(process.cwd()), new MergeGateEvaluator());
    const promotion = await pipeline.promote(
      runResult(),
      null,
      null,
      {},
      [{ gate_id: 'gate-1', scope: 'critical_mutation', run_id: 'run-delivery', work_item_id: 'T1', action: 'generate_patch', requested_at: new Date().toISOString(), context: { description: 'Approve', evidence_refs: [], risks: [] }, status: 'pending' }]
    );
    assert.equal(promotion.status, 'blocked');
    const stored = loadPromotionRecord(root, 'run-delivery');
    assert.ok(stored);
    assert.equal(stored!.status, 'blocked');
  });
});
