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
const audit_trail_1 = require("../src/audit/audit-trail");
(0, node_test_1.describe)('AuditTrail', () => {
    let tmpDir;
    let trail;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-audit-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
        trail = new audit_trail_1.AuditTrail(tmpDir);
    });
    (0, node_test_1.test)('record appends an entry', () => {
        const entry = trail.record('run_started', 'scheduler', { runId: 'r1' });
        strict_1.default.ok(entry.audit_id.startsWith('aud-'));
        strict_1.default.equal(entry.action, 'run_started');
        strict_1.default.equal(entry.severity, 'info');
        strict_1.default.equal(entry.actor, 'scheduler');
        strict_1.default.equal(entry.run_id, 'r1');
    });
    (0, node_test_1.test)('record with critical action gets critical severity', () => {
        const entry = trail.record('secret_accessed', 'plugin', { resource: 'env.DB_PASSWORD' });
        strict_1.default.equal(entry.severity, 'critical');
    });
    (0, node_test_1.test)('query filters by action', () => {
        trail.record('run_completed', 'scheduler', { runId: 'r2' });
        const results = trail.query({ action: 'run_completed' });
        strict_1.default.ok(results.length >= 1);
        strict_1.default.ok(results.every((e) => e.action === 'run_completed'));
    });
    (0, node_test_1.test)('query filters by runId', () => {
        trail.record('gate_requested', 'policy', { runId: 'r-filter' });
        const results = trail.query({ runId: 'r-filter' });
        strict_1.default.ok(results.length >= 1);
        strict_1.default.ok(results.every((e) => e.run_id === 'r-filter'));
    });
    (0, node_test_1.test)('query filters by severity', () => {
        trail.record('infra_mutation', 'executor', { runId: 'r3' });
        const critical = trail.query({ severity: 'critical' });
        strict_1.default.ok(critical.length >= 1);
        strict_1.default.ok(critical.every((e) => e.severity === 'critical'));
    });
    (0, node_test_1.test)('query filters by since timestamp', () => {
        const before = new Date(Date.now() - 1000).toISOString();
        trail.record('plugin_registered', 'registry', {});
        const recent = trail.query({ since: before });
        strict_1.default.ok(recent.length >= 1);
    });
    (0, node_test_1.test)('critical() returns only critical severity entries', () => {
        const criticals = trail.critical();
        strict_1.default.ok(criticals.every((e) => e.severity === 'critical'));
    });
    (0, node_test_1.test)('entries are persisted as NDJSON', () => {
        trail.record('pr_created', 'prmanager', { runId: 'r4' });
        const trailPath = path_1.default.join(tmpDir, '.oxe', 'AUDIT-TRAIL.ndjson');
        strict_1.default.ok(fs_1.default.existsSync(trailPath));
        const lines = fs_1.default.readFileSync(trailPath, 'utf8').split('\n').filter(Boolean);
        strict_1.default.ok(lines.length >= 1);
        const parsed = JSON.parse(lines[0]);
        strict_1.default.ok(parsed.audit_id);
        strict_1.default.ok(parsed.action);
    });
    (0, node_test_1.test)('record stores detail correctly', () => {
        const entry = trail.record('policy_denied', 'engine', {
            runId: 'r5',
            workItemId: 'T1',
            resource: 'write_fs',
            detail: { rule_id: 'no-write-prod' },
        });
        strict_1.default.equal(entry.work_item_id, 'T1');
        strict_1.default.equal(entry.resource, 'write_fs');
        strict_1.default.deepEqual(entry.detail, { rule_id: 'no-write-prod' });
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('AuditTrail.metrics()', () => {
    let tmpDir;
    let trail;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-metrics-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
        trail = new audit_trail_1.AuditTrail(tmpDir);
    });
    (0, node_test_1.test)('metrics() on empty trail', () => {
        const m = trail.metrics();
        strict_1.default.equal(m.total_entries, 0);
        strict_1.default.equal(m.critical_count, 0);
        strict_1.default.equal(m.warn_count, 0);
        strict_1.default.equal(m.oldest, null);
        strict_1.default.equal(m.newest, null);
        strict_1.default.deepEqual(m.actors, []);
    });
    (0, node_test_1.test)('metrics() counts entries correctly', () => {
        trail.record('run_started', 'scheduler', { runId: 'r1' });
        trail.record('secret_accessed', 'plugin', { runId: 'r1' });
        trail.record('gate_requested', 'policy', { runId: 'r1' });
        const m = trail.metrics();
        strict_1.default.equal(m.total_entries, 3);
        strict_1.default.equal(m.critical_count, 1);
        strict_1.default.ok(m.warn_count >= 1);
    });
    (0, node_test_1.test)('metrics() tracks actors', () => {
        const m = trail.metrics();
        strict_1.default.ok(m.actors.includes('scheduler'));
        strict_1.default.ok(m.actors.includes('plugin'));
    });
    (0, node_test_1.test)('metrics() tracks by_action counts', () => {
        const m = trail.metrics();
        strict_1.default.ok((m.by_action['run_started'] ?? 0) >= 1);
    });
    (0, node_test_1.test)('metrics() sets oldest and newest timestamps', () => {
        const m = trail.metrics();
        strict_1.default.ok(m.oldest !== null);
        strict_1.default.ok(m.newest !== null);
        strict_1.default.ok(m.oldest <= m.newest);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('RemoteAuditSink', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-remote-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('remote sink receives written entries', async () => {
        const received = [];
        const sink = {
            async write(entry) { received.push(entry); },
            async query(_filter) { return received; },
        };
        const trail = new audit_trail_1.AuditTrail(tmpDir, sink);
        trail.record('run_started', 'scheduler', { runId: 'r-remote' });
        // Give the fire-and-forget a tick to complete
        await new Promise((r) => setImmediate(r));
        strict_1.default.equal(received.length, 1);
        strict_1.default.equal(received[0].action, 'run_started');
    });
    (0, node_test_1.test)('failing remote sink does not throw', async () => {
        const sink = {
            async write() { throw new Error('remote unavailable'); },
            async query() { return []; },
        };
        const trail = new audit_trail_1.AuditTrail(tmpDir, sink);
        strict_1.default.doesNotThrow(() => trail.record('run_completed', 'scheduler', {}));
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('RunQuota', () => {
    (0, node_test_1.test)('createQuota with defaults has Infinity limits', () => {
        const q = (0, audit_trail_1.createQuota)('run-1');
        strict_1.default.equal(q.max_work_items, Infinity);
        strict_1.default.equal(q.consumed_work_items, 0);
    });
    (0, node_test_1.test)('createQuota with custom limits', () => {
        const q = (0, audit_trail_1.createQuota)('run-2', { max_work_items: 10, max_mutations: 5 });
        strict_1.default.equal(q.max_work_items, 10);
        strict_1.default.equal(q.max_mutations, 5);
        strict_1.default.equal(q.max_retries_total, Infinity);
    });
    (0, node_test_1.test)('checkQuota returns null when within limits', () => {
        const q = (0, audit_trail_1.createQuota)('run-3', { max_work_items: 5 });
        strict_1.default.equal((0, audit_trail_1.checkQuota)(q), null);
    });
    (0, node_test_1.test)('checkQuota detects work_items violation', () => {
        let q = (0, audit_trail_1.createQuota)('run-4', { max_work_items: 2 });
        q = (0, audit_trail_1.consumeQuota)(q, 'work_items', 3);
        const violation = (0, audit_trail_1.checkQuota)(q);
        strict_1.default.ok(violation !== null);
        strict_1.default.equal(violation.quota_type, 'work_items');
        strict_1.default.equal(violation.limit, 2);
        strict_1.default.equal(violation.consumed, 3);
    });
    (0, node_test_1.test)('checkQuota detects mutations violation', () => {
        let q = (0, audit_trail_1.createQuota)('run-5', { max_mutations: 10 });
        q = (0, audit_trail_1.consumeQuota)(q, 'mutations', 11);
        const violation = (0, audit_trail_1.checkQuota)(q);
        strict_1.default.ok(violation !== null);
        strict_1.default.equal(violation.quota_type, 'mutations');
    });
    (0, node_test_1.test)('checkQuota detects retries violation', () => {
        let q = (0, audit_trail_1.createQuota)('run-6', { max_retries_total: 3 });
        q = (0, audit_trail_1.consumeQuota)(q, 'retries', 4);
        const violation = (0, audit_trail_1.checkQuota)(q);
        strict_1.default.ok(violation !== null);
        strict_1.default.equal(violation.quota_type, 'retries');
    });
    (0, node_test_1.test)('consumeQuota is immutable (returns new object)', () => {
        const q = (0, audit_trail_1.createQuota)('run-7', { max_work_items: 5 });
        const q2 = (0, audit_trail_1.consumeQuota)(q, 'work_items', 2);
        strict_1.default.equal(q.consumed_work_items, 0);
        strict_1.default.equal(q2.consumed_work_items, 2);
    });
    (0, node_test_1.test)('consumeQuota accumulates across calls', () => {
        let q = (0, audit_trail_1.createQuota)('run-8', { max_retries_total: 10 });
        q = (0, audit_trail_1.consumeQuota)(q, 'retries', 3);
        q = (0, audit_trail_1.consumeQuota)(q, 'retries', 2);
        strict_1.default.equal(q.consumed_retries, 5);
        strict_1.default.equal((0, audit_trail_1.checkQuota)(q), null);
    });
});
