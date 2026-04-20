"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const gate_manager_1 = require("../src/gate/gate-manager");
function tmpDir() {
    return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-gate-test-'));
}
(0, node_test_1.describe)('GateManager', () => {
    let dir;
    (0, node_test_1.test)('setup', () => {
        dir = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('request creates a pending gate', async () => {
        const mgr = new gate_manager_1.GateManager(dir, null, 'r001');
        const token = await mgr.request('plan_approval', {
            run_id: 'r001',
            work_item_id: 'T1',
            action: 'run_tests',
            description: 'Approve plan before execution',
            evidence_refs: [],
            risks: ['high complexity'],
        });
        strict_1.default.ok(token.gate_id.startsWith('gate-'));
        strict_1.default.equal(token.scope, 'plan_approval');
        strict_1.default.equal(token.status, 'pending');
        strict_1.default.equal(token.run_id, 'r001');
        strict_1.default.equal(token.work_item_id, 'T1');
        strict_1.default.equal(token.action, 'run_tests');
    });
    (0, node_test_1.test)('isPending returns true for pending gate of same scope', async () => {
        const mgr = new gate_manager_1.GateManager(dir, null, 'r002');
        await mgr.request('critical_mutation', {
            description: 'Critical mutation gate',
            evidence_refs: [],
            risks: [],
        });
        strict_1.default.equal(mgr.isPending('critical_mutation'), true);
        strict_1.default.equal(mgr.isPending('merge'), false);
    });
    (0, node_test_1.test)('listPending returns only unresolved gates', async () => {
        const dir2 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir2, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir2, null, 'r003');
        const t1 = await mgr.request('plan_approval', { description: 'Gate 1', evidence_refs: [], risks: [] });
        const t2 = await mgr.request('security', { description: 'Gate 2', evidence_refs: [], risks: [] });
        await mgr.resolve(t1, { decision: 'approved', actor: 'user' });
        const pending = mgr.listPending();
        strict_1.default.equal(pending.length, 1);
        strict_1.default.equal(pending[0].gate_id, t2.gate_id);
        fs_1.default.rmSync(dir2, { recursive: true, force: true });
    });
    (0, node_test_1.test)('resolve sets decision and resolved_at on gate', async () => {
        const dir3 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir3, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir3, null, 'r004');
        const token = await mgr.request('merge', { description: 'Merge gate', evidence_refs: [], risks: [] });
        const resolved = await mgr.resolve(token, { decision: 'approved', actor: 'lead-eng', reason: 'LGTM' });
        strict_1.default.equal(resolved.status, 'resolved');
        strict_1.default.equal(resolved.decision, 'approved');
        strict_1.default.equal(resolved.actor, 'lead-eng');
        strict_1.default.equal(resolved.reason, 'LGTM');
        strict_1.default.ok(resolved.resolved_at);
        strict_1.default.equal(Array.isArray(resolved.resolution_history), true);
        strict_1.default.equal(resolved.resolution_history?.length, 1);
        fs_1.default.rmSync(dir3, { recursive: true, force: true });
    });
    (0, node_test_1.test)('get retrieves gate by ID', async () => {
        const mgr = new gate_manager_1.GateManager(dir, null, 'r005');
        const token = await mgr.request('pr_promotion', { description: 'PR gate', evidence_refs: ['ev-001'], risks: [] });
        const found = mgr.get(token.gate_id);
        strict_1.default.ok(found !== null);
        strict_1.default.equal(found.gate_id, token.gate_id);
        strict_1.default.deepEqual(found.context.evidence_refs, ['ev-001']);
    });
    (0, node_test_1.test)('get returns null for unknown gate ID', () => {
        const mgr = new gate_manager_1.GateManager(dir, null, 'r006');
        strict_1.default.equal(mgr.get('gate-nonexistent'), null);
    });
    (0, node_test_1.test)('gates are persisted to GATES.json', async () => {
        const dir4 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir4, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir4, null, 'r007');
        await mgr.request('plan_approval', { description: 'Persist test', evidence_refs: [], risks: [] });
        const gatesPath = path_1.default.join(dir4, '.oxe', 'execution', 'GATES.json');
        strict_1.default.ok(fs_1.default.existsSync(gatesPath));
        const raw = JSON.parse(fs_1.default.readFileSync(gatesPath, 'utf8'));
        strict_1.default.equal(Array.isArray(raw), true);
        strict_1.default.equal(raw.length, 1);
        fs_1.default.rmSync(dir4, { recursive: true, force: true });
    });
    (0, node_test_1.test)('cleanup', () => { fs_1.default.rmSync(dir, { recursive: true, force: true }); });
    (0, node_test_1.test)('listPendingByRun and stalePending expose operational queue state', async () => {
        const dir5 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir5, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir5, null, 'r008');
        const token = await mgr.request('plan_approval', {
            run_id: 'r008',
            work_item_id: 'T4',
            description: 'Queue test',
            evidence_refs: [],
            risks: [],
        });
        const gatesPath = path_1.default.join(dir5, '.oxe', 'execution', 'GATES.json');
        const gates = JSON.parse(fs_1.default.readFileSync(gatesPath, 'utf8'));
        gates[0].requested_at = '2025-01-01T00:00:00.000Z';
        fs_1.default.writeFileSync(gatesPath, JSON.stringify(gates, null, 2));
        strict_1.default.equal(mgr.listPendingByRun('r008').length, 1);
        strict_1.default.equal(mgr.listPendingForWorkItem('T4')[0].gate_id, token.gate_id);
        strict_1.default.equal(mgr.stalePending(1).length, 1);
        fs_1.default.rmSync(dir5, { recursive: true, force: true });
    });
    (0, node_test_1.test)('snapshot summarizes total, pending and stale gates', async () => {
        const dir6 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir6, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir6, null, 'r009');
        await mgr.request('plan_approval', { run_id: 'r009', description: 'Snapshot gate', evidence_refs: [], risks: [] });
        const snapshot = mgr.snapshot(999);
        strict_1.default.equal(snapshot.total, 1);
        strict_1.default.equal(snapshot.gate_sla_hours, 999);
        strict_1.default.equal(snapshot.pending.length, 1);
        strict_1.default.equal(snapshot.stale_pending.length, 0);
        strict_1.default.equal(snapshot.staleCount, 0);
        strict_1.default.equal(snapshot.byRun.r009, 1);
        strict_1.default.equal(snapshot.byScope.plan_approval, 1);
        fs_1.default.rmSync(dir6, { recursive: true, force: true });
    });
    (0, node_test_1.test)('listPendingGates helper filters by run', async () => {
        const dir7 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir7, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir7, null, 'r010');
        await mgr.request('plan_approval', { run_id: 'r010', description: 'Gate A', evidence_refs: [], risks: [] });
        await mgr.request('security', { run_id: 'r011', description: 'Gate B', evidence_refs: [], risks: [] });
        const snapshot = (0, gate_manager_1.listPendingGates)(mgr, 'r010');
        strict_1.default.equal(snapshot.pending.length, 1);
        strict_1.default.equal(snapshot.pending[0].run_id, 'r010');
        fs_1.default.rmSync(dir7, { recursive: true, force: true });
    });
    (0, node_test_1.test)('resolveGate helper resolves a gate by id', async () => {
        const dir8 = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(dir8, '.oxe'), { recursive: true });
        const mgr = new gate_manager_1.GateManager(dir8, null, 'r012');
        const token = await mgr.request('merge', { run_id: 'r012', description: 'Resolve helper', evidence_refs: [], risks: [] });
        const resolved = await (0, gate_manager_1.resolveGate)(mgr, token.gate_id, {
            decision: 'approved',
            actor: 'qa',
            reason: 'validated',
        });
        strict_1.default.equal(resolved.status, 'resolved');
        strict_1.default.equal(resolved.actor, 'qa');
        fs_1.default.rmSync(dir8, { recursive: true, force: true });
    });
});
