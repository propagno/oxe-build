import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  AuditTrail,
  createQuota,
  checkQuota,
  consumeQuota,
} from '../src/audit/audit-trail';
import type { AuditEntry, AuditQueryFilter, RemoteAuditSink } from '../src/audit/audit-trail';

describe('AuditTrail', () => {
  let tmpDir: string;
  let trail: AuditTrail;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-audit-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
    trail = new AuditTrail(tmpDir);
  });

  test('record appends an entry', () => {
    const entry = trail.record('run_started', 'scheduler', { runId: 'r1' });
    assert.ok(entry.audit_id.startsWith('aud-'));
    assert.equal(entry.action, 'run_started');
    assert.equal(entry.severity, 'info');
    assert.equal(entry.actor, 'scheduler');
    assert.equal(entry.run_id, 'r1');
  });

  test('record with critical action gets critical severity', () => {
    const entry = trail.record('secret_accessed', 'plugin', { resource: 'env.DB_PASSWORD' });
    assert.equal(entry.severity, 'critical');
  });

  test('query filters by action', () => {
    trail.record('run_completed', 'scheduler', { runId: 'r2' });
    const results = trail.query({ action: 'run_completed' });
    assert.ok(results.length >= 1);
    assert.ok(results.every((e) => e.action === 'run_completed'));
  });

  test('query filters by runId', () => {
    trail.record('gate_requested', 'policy', { runId: 'r-filter' });
    const results = trail.query({ runId: 'r-filter' });
    assert.ok(results.length >= 1);
    assert.ok(results.every((e) => e.run_id === 'r-filter'));
  });

  test('query filters by severity', () => {
    trail.record('infra_mutation', 'executor', { runId: 'r3' });
    const critical = trail.query({ severity: 'critical' });
    assert.ok(critical.length >= 1);
    assert.ok(critical.every((e) => e.severity === 'critical'));
  });

  test('query filters by since timestamp', () => {
    const before = new Date(Date.now() - 1000).toISOString();
    trail.record('plugin_registered', 'registry', {});
    const recent = trail.query({ since: before });
    assert.ok(recent.length >= 1);
  });

  test('critical() returns only critical severity entries', () => {
    const criticals = trail.critical();
    assert.ok(criticals.every((e) => e.severity === 'critical'));
  });

  test('entries are persisted as NDJSON', () => {
    trail.record('pr_created', 'prmanager', { runId: 'r4' });
    const trailPath = path.join(tmpDir, '.oxe', 'AUDIT-TRAIL.ndjson');
    assert.ok(fs.existsSync(trailPath));
    const lines = fs.readFileSync(trailPath, 'utf8').split('\n').filter(Boolean);
    assert.ok(lines.length >= 1);
    const parsed = JSON.parse(lines[0]);
    assert.ok(parsed.audit_id);
    assert.ok(parsed.action);
  });

  test('record stores detail correctly', () => {
    const entry = trail.record('policy_denied', 'engine', {
      runId: 'r5',
      workItemId: 'T1',
      resource: 'write_fs',
      detail: { rule_id: 'no-write-prod' },
    });
    assert.equal(entry.work_item_id, 'T1');
    assert.equal(entry.resource, 'write_fs');
    assert.deepEqual(entry.detail, { rule_id: 'no-write-prod' });
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('AuditTrail.metrics()', () => {
  let tmpDir: string;
  let trail: AuditTrail;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-metrics-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
    trail = new AuditTrail(tmpDir);
  });

  test('metrics() on empty trail', () => {
    const m = trail.metrics();
    assert.equal(m.total_entries, 0);
    assert.equal(m.critical_count, 0);
    assert.equal(m.warn_count, 0);
    assert.equal(m.oldest, null);
    assert.equal(m.newest, null);
    assert.deepEqual(m.actors, []);
  });

  test('metrics() counts entries correctly', () => {
    trail.record('run_started', 'scheduler', { runId: 'r1' });
    trail.record('secret_accessed', 'plugin', { runId: 'r1' });
    trail.record('gate_requested', 'policy', { runId: 'r1' });
    const m = trail.metrics();
    assert.equal(m.total_entries, 3);
    assert.equal(m.critical_count, 1);
    assert.ok(m.warn_count >= 1);
  });

  test('metrics() tracks actors', () => {
    const m = trail.metrics();
    assert.ok(m.actors.includes('scheduler'));
    assert.ok(m.actors.includes('plugin'));
  });

  test('metrics() tracks by_action counts', () => {
    const m = trail.metrics();
    assert.ok((m.by_action['run_started'] ?? 0) >= 1);
  });

  test('metrics() sets oldest and newest timestamps', () => {
    const m = trail.metrics();
    assert.ok(m.oldest !== null);
    assert.ok(m.newest !== null);
    assert.ok(m.oldest! <= m.newest!);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('RemoteAuditSink', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-remote-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('remote sink receives written entries', async () => {
    const received: AuditEntry[] = [];
    const sink: RemoteAuditSink = {
      async write(entry) { received.push(entry); },
      async query(_filter: AuditQueryFilter) { return received; },
    };
    const trail = new AuditTrail(tmpDir, sink);
    trail.record('run_started', 'scheduler', { runId: 'r-remote' });
    // Give the fire-and-forget a tick to complete
    await new Promise((r) => setImmediate(r));
    assert.equal(received.length, 1);
    assert.equal(received[0].action, 'run_started');
  });

  test('failing remote sink does not throw', async () => {
    const sink: RemoteAuditSink = {
      async write() { throw new Error('remote unavailable'); },
      async query() { return []; },
    };
    const trail = new AuditTrail(tmpDir, sink);
    assert.doesNotThrow(() => trail.record('run_completed', 'scheduler', {}));
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('RunQuota', () => {
  test('createQuota with defaults has Infinity limits', () => {
    const q = createQuota('run-1');
    assert.equal(q.max_work_items, Infinity);
    assert.equal(q.consumed_work_items, 0);
  });

  test('createQuota with custom limits', () => {
    const q = createQuota('run-2', { max_work_items: 10, max_mutations: 5 });
    assert.equal(q.max_work_items, 10);
    assert.equal(q.max_mutations, 5);
    assert.equal(q.max_retries_total, Infinity);
  });

  test('checkQuota returns null when within limits', () => {
    const q = createQuota('run-3', { max_work_items: 5 });
    assert.equal(checkQuota(q), null);
  });

  test('checkQuota detects work_items violation', () => {
    let q = createQuota('run-4', { max_work_items: 2 });
    q = consumeQuota(q, 'work_items', 3);
    const violation = checkQuota(q);
    assert.ok(violation !== null);
    assert.equal(violation!.quota_type, 'work_items');
    assert.equal(violation!.limit, 2);
    assert.equal(violation!.consumed, 3);
  });

  test('checkQuota detects mutations violation', () => {
    let q = createQuota('run-5', { max_mutations: 10 });
    q = consumeQuota(q, 'mutations', 11);
    const violation = checkQuota(q);
    assert.ok(violation !== null);
    assert.equal(violation!.quota_type, 'mutations');
  });

  test('checkQuota detects retries violation', () => {
    let q = createQuota('run-6', { max_retries_total: 3 });
    q = consumeQuota(q, 'retries', 4);
    const violation = checkQuota(q);
    assert.ok(violation !== null);
    assert.equal(violation!.quota_type, 'retries');
  });

  test('consumeQuota is immutable (returns new object)', () => {
    const q = createQuota('run-7', { max_work_items: 5 });
    const q2 = consumeQuota(q, 'work_items', 2);
    assert.equal(q.consumed_work_items, 0);
    assert.equal(q2.consumed_work_items, 2);
  });

  test('consumeQuota accumulates across calls', () => {
    let q = createQuota('run-8', { max_retries_total: 10 });
    q = consumeQuota(q, 'retries', 3);
    q = consumeQuota(q, 'retries', 2);
    assert.equal(q.consumed_retries, 5);
    assert.equal(checkQuota(q), null);
  });
});
