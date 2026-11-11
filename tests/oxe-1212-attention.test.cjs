'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const att = require('../bin/lib/oxe-attention.cjs');

// 1.21.2 — OXB-145: one stable "needs someone" signal — ATTENTION.md, a notify hook once per item, resolve.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
function dir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-at-')); dirs.push(d); fs.mkdirSync(path.join(d, '.oxe')); fs.writeFileSync(path.join(d, '.oxe', 'STATE.md'), '# S\n'); return d; }
const notifyCfg = (d) => ({ attention: { notify: `node -e "require('fs').appendFileSync('notified.txt', process.env.OXE_ATTENTION_ID + '\\n')"` } });

describe('OXB-145: attention', () => {
  it('an environment pause writes ATTENTION.md and calls the hook once; the same pause again does not notify', () => {
    const d = dir();
    const e = { type: 'WorkItemBlocked', work_item_id: 'T4', payload: { reason: 'paused_environment', detail: 'exit 127: gradle não encontrado' } };
    const r1 = att.raise(d, att.fromEvent(e), notifyCfg(d));
    const r2 = att.raise(d, att.fromEvent(e), notifyCfg(d));
    assert.deepEqual([r1.isNew, r2.isNew], [true, false]);
    assert.equal(fs.readFileSync(path.join(d, 'notified.txt'), 'utf8').trim().split('\n').length, 1);
    const md = fs.readFileSync(path.join(d, '.oxe', 'ATTENTION.md'), 'utf8');
    assert.match(md, /env:T4 — T4 pausou pelo ambiente/);
    assert.match(md, /gradle não encontrado/);
  });

  it('one item per kind of pause', () => {
    const kinds = [
      [{ type: 'WorkItemBlocked', work_item_id: 'T1', payload: { reason: 'paused_quota', detail: 'limit' } }, 'quota'],
      [{ type: 'WorkItemBlocked', work_item_id: 'T2', payload: { reason: 'waiting_answer', detail: 'Q-1' } }, 'question:T2'],
      [{ type: 'WorkItemBlocked', work_item_id: 'T3', payload: { reason: 'pending_gate', detail: 'g' } }, 'gate:T3'],
      [{ type: 'WorkItemBlocked', work_item_id: 'T5', payload: { reason: 'repair_decompose', detail: 'x' } }, 'repair:T5'],
      [{ type: 'WorkItemDeferred', work_item_id: 'T6', payload: { task: 'T6' } }, 'deferred:T6'],
    ];
    for (const [e, id] of kinds) assert.equal(att.fromEvent(e).id, id);
    assert.equal(att.fromEvent({ type: 'WorkItemBlocked', work_item_id: 'T9', payload: { reason: 'dependency_not_met' } }), null);
  });

  it('runtime attention resolve deletes the file, records who; status shows pending attention first', () => {
    const d = dir();
    att.raise(d, att.fromEvent({ type: 'WorkItemBlocked', work_item_id: 'T4', payload: { reason: 'paused_environment', detail: 'x' } }), {});
    const st = spawnSync(process.execPath, [CLI, 'status', '--dir', d], { encoding: 'utf8' });
    assert.match(st.stdout, /ATENÇÃO \(1\)[\s\S]*env:T4/);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'attention', 'resolve', 'env:T4', '--by', 'ops', '--dir', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!fs.existsSync(path.join(d, '.oxe', 'ATTENTION.md')));
    assert.equal(att.read(d)[0].resolved_by, 'ops');
    assert.match(fs.readFileSync(path.join(d, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8'), /AttentionResolved/);
  });
});
