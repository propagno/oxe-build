import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { GateManager } from '../src/gate/gate-manager';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-gate-test-'));
}

describe('GateManager', () => {
  let dir: string;

  test('setup', () => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  });

  test('request creates a pending gate', async () => {
    const mgr = new GateManager(dir, null, 'r001');
    const token = await mgr.request('plan_approval', {
      description: 'Approve plan before execution',
      evidence_refs: [],
      risks: ['high complexity'],
    });
    assert.ok(token.gate_id.startsWith('gate-'));
    assert.equal(token.scope, 'plan_approval');
    assert.equal(token.status, 'pending');
  });

  test('isPending returns true for pending gate of same scope', async () => {
    const mgr = new GateManager(dir, null, 'r002');
    await mgr.request('critical_mutation', {
      description: 'Critical mutation gate',
      evidence_refs: [],
      risks: [],
    });
    assert.equal(mgr.isPending('critical_mutation'), true);
    assert.equal(mgr.isPending('merge'), false);
  });

  test('listPending returns only unresolved gates', async () => {
    const dir2 = tmpDir();
    fs.mkdirSync(path.join(dir2, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir2, null, 'r003');
    const t1 = await mgr.request('plan_approval', { description: 'Gate 1', evidence_refs: [], risks: [] });
    const t2 = await mgr.request('security', { description: 'Gate 2', evidence_refs: [], risks: [] });
    await mgr.resolve(t1, { decision: 'approved', actor: 'user' });
    const pending = mgr.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].gate_id, t2.gate_id);
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  test('resolve sets decision and resolved_at on gate', async () => {
    const dir3 = tmpDir();
    fs.mkdirSync(path.join(dir3, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir3, null, 'r004');
    const token = await mgr.request('merge', { description: 'Merge gate', evidence_refs: [], risks: [] });
    const resolved = await mgr.resolve(token, { decision: 'approved', actor: 'lead-eng', reason: 'LGTM' });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.decision, 'approved');
    assert.equal(resolved.actor, 'lead-eng');
    assert.equal(resolved.reason, 'LGTM');
    assert.ok(resolved.resolved_at);
    fs.rmSync(dir3, { recursive: true, force: true });
  });

  test('get retrieves gate by ID', async () => {
    const mgr = new GateManager(dir, null, 'r005');
    const token = await mgr.request('pr_promotion', { description: 'PR gate', evidence_refs: ['ev-001'], risks: [] });
    const found = mgr.get(token.gate_id);
    assert.ok(found !== null);
    assert.equal(found!.gate_id, token.gate_id);
    assert.deepEqual(found!.context.evidence_refs, ['ev-001']);
  });

  test('get returns null for unknown gate ID', () => {
    const mgr = new GateManager(dir, null, 'r006');
    assert.equal(mgr.get('gate-nonexistent'), null);
  });

  test('gates are persisted to GATES.json', async () => {
    const dir4 = tmpDir();
    fs.mkdirSync(path.join(dir4, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir4, null, 'r007');
    await mgr.request('plan_approval', { description: 'Persist test', evidence_refs: [], risks: [] });
    const gatesPath = path.join(dir4, '.oxe', 'execution', 'GATES.json');
    assert.ok(fs.existsSync(gatesPath));
    const raw = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    assert.equal(Array.isArray(raw), true);
    assert.equal(raw.length, 1);
    fs.rmSync(dir4, { recursive: true, force: true });
  });

  test('cleanup', () => { fs.rmSync(dir, { recursive: true, force: true }); });
});
