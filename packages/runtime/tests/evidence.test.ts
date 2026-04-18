import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { EvidenceStore } from '../src/evidence/evidence-store';
import type { EvidenceCollectOptions } from '../src/evidence/evidence-store';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ev-test-'));
}

const opts: EvidenceCollectOptions = { work_item_id: 'T1', run_id: 'r001', attempt_number: 1 };

describe('EvidenceStore', () => {
  let dir: string;

  test('setup', () => { dir = tmpDir(); });

  test('collect creates file and returns Evidence record', async () => {
    const store = new EvidenceStore(dir);
    const ev = await store.collect('stdout', 'hello world', opts);
    assert.ok(ev.evidence_id.includes('r001'));
    assert.ok(ev.evidence_id.includes('T1'));
    assert.equal(ev.type, 'stdout');
    assert.ok(ev.checksum !== null && ev.checksum.length === 16);
    assert.ok(fs.existsSync(path.join(dir, ev.path)));
  });

  test('collect writes correct content to disk', async () => {
    const store = new EvidenceStore(dir);
    const content = JSON.stringify({ exit_code: 0, tests: 42 });
    const ev = await store.collect('summary', content, opts);
    const onDisk = fs.readFileSync(path.join(dir, ev.path), 'utf8');
    assert.equal(onDisk, content);
  });

  test('list returns all evidence for an attempt', async () => {
    const store = new EvidenceStore(dir);
    const o: EvidenceCollectOptions = { ...opts, run_id: 'r002' };
    await store.collect('diff', '--- a\n+++ b', o);
    await store.collect('stdout', 'test output', o);
    const items = await store.list(o);
    assert.equal(items.length, 2);
  });

  test('list returns empty for unknown attempt', async () => {
    const store = new EvidenceStore(dir);
    const items = await store.list({ ...opts, run_id: 'r-unknown' });
    assert.deepEqual(items, []);
  });

  test('get retrieves content by evidence_id', async () => {
    const store = new EvidenceStore(dir);
    const o: EvidenceCollectOptions = { ...opts, run_id: 'r003' };
    const ev = await store.collect('log', 'build output', o);
    const result = await store.get(ev.evidence_id, o);
    assert.ok(result !== null);
    assert.equal(result!.content.toString('utf8'), 'build output');
  });

  test('get returns null for unknown evidence_id', async () => {
    const store = new EvidenceStore(dir);
    const result = await store.get('ev-nonexistent', opts);
    assert.equal(result, null);
  });

  test('multiple collects of same type get sequenced filenames', async () => {
    const store = new EvidenceStore(dir);
    const o: EvidenceCollectOptions = { ...opts, run_id: 'r004' };
    const ev1 = await store.collect('stdout', 'first', o);
    const ev2 = await store.collect('stdout', 'second', o);
    assert.notEqual(ev1.path, ev2.path);
    assert.ok(ev1.path.endsWith('stdout.txt'));
    assert.ok(ev2.path.endsWith('stdout-2.txt'));
  });

  test('binary content stored without corruption', async () => {
    const store = new EvidenceStore(dir);
    const o: EvidenceCollectOptions = { ...opts, run_id: 'r005' };
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ev = await store.collect('screenshot', buf, o);
    const result = await store.get(ev.evidence_id, o);
    assert.ok(result !== null);
    assert.deepEqual(result!.content, buf);
  });

  test('listByRun aggregates across work items', async () => {
    const store = new EvidenceStore(dir);
    const runId = 'r006';
    await store.collect('stdout', 'T1 output', { work_item_id: 'T1', run_id: runId, attempt_number: 1 });
    await store.collect('diff', 'T2 diff', { work_item_id: 'T2', run_id: runId, attempt_number: 1 });
    const all = await store.listByRun(runId);
    assert.equal(all.length, 2);
    assert.ok(all.some((e) => e.type === 'stdout'));
    assert.ok(all.some((e) => e.type === 'diff'));
  });

  test('cleanup', () => { fs.rmSync(dir, { recursive: true, force: true }); });
});
