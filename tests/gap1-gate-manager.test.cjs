'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createExecutionContext } = require('../bin/lib/oxe-operational.cjs');

describe('Gap 1 — GateManager wiring via createExecutionContext', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-gap1-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createExecutionContext is exported from oxe-operational', () => {
    assert.equal(typeof createExecutionContext, 'function', 'createExecutionContext must be a function');
  });

  it('returns a ctx object with required fields', () => {
    const ctx = createExecutionContext(tmpDir, null, {});
    assert.equal(ctx.projectRoot, tmpDir);
    assert.equal(ctx.sessionId, null);
    assert.ok(typeof ctx.runId === 'string' && ctx.runId.length > 0, 'runId must be a non-empty string');
  });

  it('uses provided runId when given', () => {
    const ctx = createExecutionContext(tmpDir, null, { runId: 'run-test-123' });
    assert.equal(ctx.runId, 'run-test-123');
  });

  it('includes gateManager when runtime.GateManager is available', () => {
    const ctx = createExecutionContext(tmpDir, null, {});
    // GateManager is available if runtime is built; if not, gateManager will be null (acceptable)
    // The key assertion is that ctx.gateManager is not the string 'gate-missing-manager'
    assert.notEqual(ctx.gateManager, 'gate-missing-manager', 'gateManager must never be a string sentinel');
    // If runtime is available, gateManager must be an object
    if (ctx.gateManager !== null) {
      assert.equal(typeof ctx.gateManager, 'object', 'gateManager must be an object when present');
      assert.equal(typeof ctx.gateManager.request, 'function', 'gateManager.request must be a function');
    }
  });

  it('includes all required ctx fields', () => {
    const ctx = createExecutionContext(tmpDir, 'session-A', { policyActor: 'test-user' });
    assert.equal(ctx.sessionId, 'session-A');
    assert.equal(ctx.policyActor, 'test-user');
    assert.ok('executor' in ctx, 'executor field required');
    assert.ok('workspaceManager' in ctx, 'workspaceManager field required');
    assert.ok('pluginRegistry' in ctx, 'pluginRegistry field required');
    assert.ok('options' in ctx, 'options field required');
  });

  it('passes schedulerOptions into ctx.options', () => {
    const ctx = createExecutionContext(tmpDir, null, {
      schedulerOptions: { verifyTimeoutMs: 99000 },
    });
    assert.equal(ctx.options.verifyTimeoutMs, 99000);
  });

  it('onEvent callback is wired when provided', () => {
    const events = [];
    const ctx = createExecutionContext(tmpDir, null, {
      onEvent: (e) => events.push(e),
    });
    ctx.onEvent({ type: 'test' });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'test');
  });
});
