import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { WorkspaceRequest } from '../src/workspace/workspace-manager';

const baseReq: WorkspaceRequest = {
  work_item_id: 'T1',
  attempt_number: 1,
  strategy: 'inplace',
  mutation_scope: [],
};

describe('InplaceWorkspaceManager', () => {
  test('allocate returns a valid lease', async () => {
    const mgr = new InplaceWorkspaceManager('/tmp/fake-root');
    const lease = await mgr.allocate(baseReq);
    assert.equal(lease.strategy, 'inplace');
    assert.equal(lease.root_path, '/tmp/fake-root');
    assert.ok(lease.workspace_id.includes('T1'));
    assert.ok(lease.workspace_id.includes('a1'));
  });

  test('dispose is a no-op and does not throw', async () => {
    const mgr = new InplaceWorkspaceManager('/tmp/fake-root');
    const lease = await mgr.allocate(baseReq);
    await assert.doesNotReject(() => mgr.dispose(lease.workspace_id));
  });

  test('reset is a no-op and does not throw', async () => {
    const mgr = new InplaceWorkspaceManager('/tmp/fake-root');
    const lease = await mgr.allocate(baseReq);
    const snap = await mgr.snapshot(lease.workspace_id);
    await assert.doesNotReject(() => mgr.reset(lease.workspace_id, snap));
  });

  test('snapshot returns a ref with HEAD as commit', async () => {
    const mgr = new InplaceWorkspaceManager('/tmp/fake-root');
    const lease = await mgr.allocate(baseReq);
    const snap = await mgr.snapshot(lease.workspace_id);
    assert.equal(snap.commit, 'HEAD');
    assert.equal(snap.workspace_id, lease.workspace_id);
    assert.ok(snap.snapshot_id.startsWith('snap-'));
  });

  test('multiple allocations get unique workspace IDs', async () => {
    const mgr = new InplaceWorkspaceManager('/tmp/fake-root');
    const l1 = await mgr.allocate({ ...baseReq, attempt_number: 1 });
    const l2 = await mgr.allocate({ ...baseReq, attempt_number: 2 });
    assert.notEqual(l1.workspace_id, l2.workspace_id);
  });
});
