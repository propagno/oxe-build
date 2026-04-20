"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const inplace_1 = require("../src/workspace/strategies/inplace");
const baseReq = {
    work_item_id: 'T1',
    attempt_number: 1,
    strategy: 'inplace',
    mutation_scope: [],
};
(0, node_test_1.describe)('InplaceWorkspaceManager', () => {
    (0, node_test_1.test)('allocate returns a valid lease', async () => {
        const mgr = new inplace_1.InplaceWorkspaceManager('/tmp/fake-root');
        const lease = await mgr.allocate(baseReq);
        strict_1.default.equal(lease.strategy, 'inplace');
        strict_1.default.equal(lease.isolation_level, 'shared');
        strict_1.default.equal(lease.root_path, '/tmp/fake-root');
        strict_1.default.ok(lease.workspace_id.includes('T1'));
        strict_1.default.ok(lease.workspace_id.includes('a1'));
    });
    (0, node_test_1.test)('dispose is a no-op and does not throw', async () => {
        const mgr = new inplace_1.InplaceWorkspaceManager('/tmp/fake-root');
        const lease = await mgr.allocate(baseReq);
        await strict_1.default.doesNotReject(() => mgr.dispose(lease.workspace_id));
    });
    (0, node_test_1.test)('reset is a no-op and does not throw', async () => {
        const mgr = new inplace_1.InplaceWorkspaceManager('/tmp/fake-root');
        const lease = await mgr.allocate(baseReq);
        const snap = await mgr.snapshot(lease.workspace_id);
        await strict_1.default.doesNotReject(() => mgr.reset(lease.workspace_id, snap));
    });
    (0, node_test_1.test)('snapshot returns a ref with HEAD as commit', async () => {
        const mgr = new inplace_1.InplaceWorkspaceManager('/tmp/fake-root');
        const lease = await mgr.allocate(baseReq);
        const snap = await mgr.snapshot(lease.workspace_id);
        strict_1.default.equal(snap.commit, 'HEAD');
        strict_1.default.equal(snap.workspace_id, lease.workspace_id);
        strict_1.default.ok(snap.snapshot_id.startsWith('snap-'));
    });
    (0, node_test_1.test)('multiple allocations get unique workspace IDs', async () => {
        const mgr = new inplace_1.InplaceWorkspaceManager('/tmp/fake-root');
        const l1 = await mgr.allocate({ ...baseReq, attempt_number: 1 });
        const l2 = await mgr.allocate({ ...baseReq, attempt_number: 2 });
        strict_1.default.notEqual(l1.workspace_id, l2.workspace_id);
    });
});
