'use strict';

// 1.21.2: the cost of failure, reproducible from the events and the CRs (coordination, 14/11).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('../bin/lib/oxe-failure-cost.cjs');

const t = (min) => new Date(Date.UTC(2026, 10, 14, 20, 0) + min * 60_000).toISOString();
const usage = (task, attempt, usd, min, run = 'r1') => ({ type: 'ExecutorUsage', run_id: run, work_item_id: task, timestamp: t(min), payload: { attempt, cost_usd: usd } });

describe('report failure-cost', () => {
  it('discarded attempts by cause, a CR redo, and the stopped time', () => {
    const events = [
      // T5: attempt 1 failed on a frozen-test defect (retry), attempt 2 done
      usage('T5', 1, 7.6, 0), { type: 'RetryScheduled', run_id: 'r1', work_item_id: 'T5', timestamp: t(1), payload: { reason: 'verify_suspect' } },
      usage('T5', 2, 6.0, 5), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T5', timestamp: t(6) },
      // T6: done, then redone after CR-F2-7 named it
      usage('T6', 1, 25, 10), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T6', timestamp: t(11) },
      // a 2-hour silence in the run
      { type: 'CheckpointCreated', run_id: 'r1', work_item_id: 'T6', timestamp: t(12) },
      usage('T6', 1, 9, 140, 'r1'), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T6', timestamp: t(141) },
      // T4: blocked out of scope
      usage('T4', 1, 3.5, 150), { type: 'WorkItemBlocked', run_id: 'r1', work_item_id: 'T4', timestamp: t(151), payload: { failure_class: 'scope_insufficient' } },
    ];
    const crs = [{ id: 'CR-F2-7', class: 'defect', status: 'resolved', tasks: ['T6'], at: t(60), summary: 'userEvent sob fake timers' }];
    const r = fc.report(events, crs, { fixes: { verify_suspect: 'G36 (215c340)' } });
    assert.equal(r.spent_usd, 51.1);
    const by = Object.fromEntries(r.causes.map((c) => [c.cause, c]));
    assert.equal(by['CR defect'].usd, 25);
    assert.deepEqual(by['CR defect'].crs, ['CR-F2-7']);
    assert.equal(by.verify_suspect.usd, 7.6);
    assert.equal(by.verify_suspect.fix, 'G36 (215c340)');
    assert.equal(by.scope_insufficient.usd, 3.5);
    assert.equal(r.discarded_usd, 36.1);
    assert.equal(r.stops[0].minutes, 128);
    assert.equal(r.stops[0].after, 'CheckpointCreated');
    assert.ok(r.stopped_hours >= 2);
    assert.match(fc.render(r), /US\$ 36\.10 descartados de US\$ 51\.10/);
  });

  it('fixes match the cause by its parts; ratio and _pct; a wait after VerificationStarted is verifying_hours (OxeSpace 15/11)', () => {
    const events = [
      usage('T1', 1, 4, 0), { type: 'WorkItemBlocked', run_id: 'r1', work_item_id: 'T1', timestamp: t(1), payload: { failure_class: 'no_progress' } },
      usage('T2', 1, 6, 2), { type: 'RetryScheduled', run_id: 'r1', work_item_id: 'T2', timestamp: t(3), payload: { reason: 'Env' } },
      usage('T2', 2, 10, 4), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T2', timestamp: t(5) },
      { type: 'VerificationStarted', run_id: 'r1', timestamp: t(6) },
      { type: 'VerificationCompleted', run_id: 'r1', timestamp: t(76) },
    ];
    const crs = [{ id: 'CR-F5-2', class: 'constraint', status: 'open', tasks: ['T1'], at: t(1.5) }];
    const r = fc.report(events, crs, { fixes: { no_progress: 'OXB-186', env: 'G29' } });
    const by = Object.fromEntries(r.causes.map((c) => [c.cause, c]));
    assert.equal(by['CR constraint (no_progress)'].fix, 'OXB-186');
    assert.deepEqual(by['CR constraint (no_progress)'].fix_keys, ['CR constraint (no_progress)', 'no_progress', 'constraint']);
    assert.equal(by.Env.fix, 'G29', 'case-insensitive');
    assert.equal(r.discarded_share_pct, r.discarded_share);
    assert.equal(r.discarded_ratio, Math.round((10 / 20) * 10000) / 10000);
    assert.equal(r.verifying_hours, 1.2);
    assert.equal(r.stopped_hours, 0);
    // a redo after done, by a CR naming the task WITH its phase prefix (F2/T6): attributed to the CR
    const redo = fc.report([
      usage('T6', 1, 25, 10), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T6', timestamp: t(11) },
      usage('T6', 1, 9, 140), { type: 'WorkItemCompleted', run_id: 'r1', work_item_id: 'T6', timestamp: t(141) },
    ], [{ id: 'CR-F2-7', class: 'defect', status: 'resolved', tasks: ['F2/T6'], at: t(60) }]);
    assert.deepEqual(redo.causes.map((c) => [c.cause, c.crs]), [['CR defect', ['CR-F2-7']]]);
  });

  it('--since cuts the events and the CRs', () => {
    const r = fc.report([usage('T1', 1, 5, 0), { type: 'RetryScheduled', run_id: 'r1', work_item_id: 'T1', timestamp: t(1), payload: { reason: 'x' } }], [], { since: t(30) });
    assert.equal(r.spent_usd, 0);
    assert.deepEqual(r.causes, []);
  });
});
