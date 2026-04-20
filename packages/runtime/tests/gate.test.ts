import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { GateManager, listPendingGates, resolveGate } from '../src/gate/gate-manager';

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
      run_id: 'r001',
      work_item_id: 'T1',
      action: 'run_tests',
      description: 'Approve plan before execution',
      evidence_refs: [],
      risks: ['high complexity'],
    });
    assert.ok(token.gate_id.startsWith('gate-'));
    assert.equal(token.scope, 'plan_approval');
    assert.equal(token.status, 'pending');
    assert.equal(token.run_id, 'r001');
    assert.equal(token.work_item_id, 'T1');
    assert.equal(token.action, 'run_tests');
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
    assert.equal(Array.isArray(resolved.resolution_history), true);
    assert.equal(resolved.resolution_history?.length, 1);
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

  test('listPendingByRun and stalePending expose operational queue state', async () => {
    const dir5 = tmpDir();
    fs.mkdirSync(path.join(dir5, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir5, null, 'r008');
    const token = await mgr.request('plan_approval', {
      run_id: 'r008',
      work_item_id: 'T4',
      description: 'Queue test',
      evidence_refs: [],
      risks: [],
    });
    const gatesPath = path.join(dir5, '.oxe', 'execution', 'GATES.json');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    gates[0].requested_at = '2025-01-01T00:00:00.000Z';
    fs.writeFileSync(gatesPath, JSON.stringify(gates, null, 2));
    assert.equal(mgr.listPendingByRun('r008').length, 1);
    assert.equal(mgr.listPendingForWorkItem('T4')[0].gate_id, token.gate_id);
    assert.equal(mgr.stalePending(1).length, 1);
    fs.rmSync(dir5, { recursive: true, force: true });
  });

  test('snapshot summarizes total, pending and stale gates', async () => {
    const dir6 = tmpDir();
    fs.mkdirSync(path.join(dir6, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir6, null, 'r009');
    await mgr.request('plan_approval', { run_id: 'r009', description: 'Snapshot gate', evidence_refs: [], risks: [] });
    const snapshot = mgr.snapshot(999);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.gate_sla_hours, 999);
    assert.equal(snapshot.pending.length, 1);
    assert.equal(snapshot.stale_pending.length, 0);
    assert.equal(snapshot.staleCount, 0);
    assert.equal(snapshot.byRun.r009, 1);
    assert.equal(snapshot.byScope.plan_approval, 1);
    fs.rmSync(dir6, { recursive: true, force: true });
  });

  test('listPendingGates helper filters by run', async () => {
    const dir7 = tmpDir();
    fs.mkdirSync(path.join(dir7, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir7, null, 'r010');
    await mgr.request('plan_approval', { run_id: 'r010', description: 'Gate A', evidence_refs: [], risks: [] });
    await mgr.request('security', { run_id: 'r011', description: 'Gate B', evidence_refs: [], risks: [] });
    const snapshot = listPendingGates(mgr, 'r010');
    assert.equal(snapshot.pending.length, 1);
    assert.equal(snapshot.pending[0].run_id, 'r010');
    fs.rmSync(dir7, { recursive: true, force: true });
  });

  test('resolveGate helper resolves a gate by id', async () => {
    const dir8 = tmpDir();
    fs.mkdirSync(path.join(dir8, '.oxe'), { recursive: true });
    const mgr = new GateManager(dir8, null, 'r012');
    const token = await mgr.request('merge', { run_id: 'r012', description: 'Resolve helper', evidence_refs: [], risks: [] });
    const resolved = await resolveGate(mgr, token.gate_id, {
      decision: 'approved',
      actor: 'qa',
      reason: 'validated',
    });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.actor, 'qa');
    fs.rmSync(dir8, { recursive: true, force: true });
  });
});
