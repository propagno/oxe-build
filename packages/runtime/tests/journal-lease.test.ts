import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createJournal, saveJournal, loadJournal, isJournalStale, markInterrupted, isProcessAlive } from '../src/scheduler/run-journal';

// OXB-010: depois do OOM da F1 do OxeVoice, `recover` via `Journal: running` e não reconciliava. 1.20c: lease.

describe('lease do journal', () => {
  test('saveJournal carimba dono e heartbeat quando running', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-lease-'));
    try {
      saveJournal(dir, 'r1', createJournal('r1'));
      const j = loadJournal(dir, 'r1')!;
      assert.equal(j.owner_pid, process.pid);
      assert.ok(j.heartbeat_at);
      assert.equal(isJournalStale(j), false, 'dono vivo (este processo) não é stale');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dono morto, sem dono (journal antigo) ou heartbeat velho = stale; outros estados nunca', () => {
    const base = { ...createJournal('r'), owner_pid: 999_999, heartbeat_at: new Date().toISOString() };
    assert.equal(isJournalStale(base, { isAlive: () => false }), true);
    assert.equal(isJournalStale({ ...base, owner_pid: null }), true);
    const old = { ...base, heartbeat_at: new Date(Date.now() - 7 * 3600_000).toISOString() };
    assert.equal(isJournalStale(old, { isAlive: () => true }), true);
    assert.equal(isJournalStale({ ...base, heartbeat_at: new Date().toISOString() }, { isAlive: () => true }), false);
    assert.equal(isJournalStale({ ...base, scheduler_state: 'paused' }, { isAlive: () => false }), false);
  });

  test('markInterrupted preserva o progresso e libera o dono', () => {
    const j = { ...createJournal('r'), completed_work_items: ['T1', 'T2'], owner_pid: 123 };
    const m = markInterrupted(j);
    assert.equal(m.scheduler_state, 'interrupted');
    assert.deepEqual(m.completed_work_items, ['T1', 'T2']);
    assert.equal(m.owner_pid, null);
    assert.ok(m.interrupted_at);
  });

  test('isProcessAlive', () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive(2_147_483_000), false);
  });
});
