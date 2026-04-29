'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Gap 2 — inline verification after task execution', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-gap2-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: build a minimal Scheduler-like verifyNode caller
  // We test verifyNode indirectly through the verification-compiler integration
  it('verifyRun passes when command exits 0', async () => {
    const { verifyRun } = require('../lib/runtime/verification/verification-compiler');
    const suite = {
      checks: [{
        id: 'chk-1',
        type: 'custom',
        command: process.platform === 'win32' ? 'cmd /c exit 0' : 'true',
        evidence_type_expected: 'stdout',
        acceptance_ref: null,
        description: 'always passes',
      }],
    };
    const result = await verifyRun({
      suite,
      cwd: tmpDir,
      timeoutMs: 10000,
      runId: 'run-test',
      workItemId: 'T1',
      attemptNumber: 1,
      projectRoot: tmpDir,
      evidenceStore: null,
      pluginRegistry: null,
    });
    assert.equal(result.status, 'passed', `Expected passed, got ${result.status}`);
  });

  it('verifyRun fails when command exits non-zero', async () => {
    const { verifyRun } = require('../lib/runtime/verification/verification-compiler');
    const suite = {
      checks: [{
        id: 'chk-fail',
        type: 'custom',
        command: process.platform === 'win32' ? 'cmd /c exit 1' : 'false',
        evidence_type_expected: 'stdout',
        acceptance_ref: null,
        description: 'always fails',
      }],
    };
    const result = await verifyRun({
      suite,
      cwd: tmpDir,
      timeoutMs: 10000,
      runId: 'run-test',
      workItemId: 'T2',
      attemptNumber: 1,
      projectRoot: tmpDir,
      evidenceStore: null,
      pluginRegistry: null,
    });
    assert.equal(result.status, 'failed', `Expected failed, got ${result.status}`);
  });

  it('Scheduler.verifyNode returns null when node has no verify.command', async () => {
    const { Scheduler } = require('../lib/runtime/scheduler/scheduler');
    const scheduler = new Scheduler();

    const node = {
      id: 'T1', title: 'Test', mutation_scope: [],
      actions: [], verify: { must_pass: [], command: null },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: tmpDir, workspace_id: 'w1', strategy: 'inplace' };
    const ctx = { runId: 'r1', projectRoot: tmpDir, options: {}, onEvent: null };

    const result = await scheduler.verifyNode(node, lease, ctx, 'a1', 1);
    assert.equal(result, null, 'verifyNode must return null when no verify command');
  });

  it('Scheduler.verifyNode emits VerificationStarted and VerificationCompleted events', async () => {
    const { Scheduler } = require('../lib/runtime/scheduler/scheduler');
    const scheduler = new Scheduler();
    const events = [];

    const node = {
      id: 'T2', title: 'Test', mutation_scope: [],
      actions: [], verify: { must_pass: [], command: process.platform === 'win32' ? 'cmd /c exit 0' : 'true' },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: tmpDir, workspace_id: 'w2', strategy: 'inplace' };
    const ctx = {
      runId: 'r2', projectRoot: tmpDir, options: {},
      onEvent: (e) => events.push(e),
    };

    await scheduler.verifyNode(node, lease, ctx, 'a1', 1);

    const types = events.map((e) => e.type);
    assert.ok(types.includes('VerificationStarted'), 'VerificationStarted must be emitted');
    assert.ok(types.includes('VerificationCompleted'), 'VerificationCompleted must be emitted');
  });

  it('Scheduler.verifyNode returns passed status for exit-0 command', async () => {
    const { Scheduler } = require('../lib/runtime/scheduler/scheduler');
    const scheduler = new Scheduler();
    const events = [];

    const node = {
      id: 'T3', title: 'Test', mutation_scope: [],
      actions: [], verify: { must_pass: [], command: process.platform === 'win32' ? 'cmd /c exit 0' : 'true' },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: tmpDir, workspace_id: 'w3', strategy: 'inplace' };
    const ctx = { runId: 'r3', projectRoot: tmpDir, options: {}, onEvent: (e) => events.push(e) };

    const result = await scheduler.verifyNode(node, lease, ctx, 'a1', 1);
    assert.ok(result !== null, 'Result must not be null when verify.command is set');
    assert.equal(result.status, 'passed');
  });

  it('Scheduler.verifyNode returns failed status for exit-1 command', async () => {
    const { Scheduler } = require('../lib/runtime/scheduler/scheduler');
    const scheduler = new Scheduler();
    const events = [];

    const node = {
      id: 'T4', title: 'Test', mutation_scope: [],
      actions: [], verify: { must_pass: [], command: process.platform === 'win32' ? 'cmd /c exit 1' : 'false' },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: tmpDir, workspace_id: 'w4', strategy: 'inplace' };
    const ctx = { runId: 'r4', projectRoot: tmpDir, options: {}, onEvent: (e) => events.push(e) };

    const result = await scheduler.verifyNode(node, lease, ctx, 'a1', 1);
    assert.ok(result !== null, 'Result must not be null');
    assert.equal(result.status, 'failed');
  });

  it('Scheduler.verifyNode returns null (non-blocking) on infrastructure error', async () => {
    const { Scheduler } = require('../lib/runtime/scheduler/scheduler');
    const scheduler = new Scheduler();
    const events = [];

    const node = {
      id: 'T5', title: 'Test', mutation_scope: [],
      actions: [], verify: { must_pass: [], command: 'this_command_definitely_does_not_exist_xyz_12345' },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: tmpDir, workspace_id: 'w5', strategy: 'inplace' };
    const ctx = { runId: 'r5', projectRoot: tmpDir, options: {}, onEvent: (e) => events.push(e) };

    // Should not throw even if verifyRun internally raises
    let result;
    try {
      result = await scheduler.verifyNode(node, lease, ctx, 'a1', 1);
    } catch (err) {
      assert.fail(`verifyNode must not throw on infra error: ${err.message}`);
    }
    // Either null (caught) or a result with status 'error'/'failed' — both acceptable
    // The key is it did not throw
    const completedEvt = events.find((e) => e.type === 'VerificationCompleted');
    if (result === null) {
      assert.ok(completedEvt, 'VerificationCompleted with error status must be emitted when null returned');
    }
  });
});
