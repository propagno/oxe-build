'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../lib/runtime/index.js');

// 1.21.2 — OXB-129: stream dispatch — a dependent task starts when its dependencies land, not its whole wave.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sd-')); dirs.push(d); return d; };

function graph(tasks) {
  const waves = {};
  for (const t of tasks) (waves[t.wave] = waves[t.wave] || []).push(t.id);
  const full = tasks.map((t) => ({ title: t.id, dependsOn: [], verifyCommand: null, aceite: [], done: false, ...t }));
  return runtime.compile({ tasks: full, waves, totalTasks: full.length }, { objective: 's', criteria: [] }, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(dispatch, tasks, opts = {}) {
  const dir = tmp();
  const log = [];
  const durations = opts.durations || {};
  const executor = {
    async execute(node) {
      log.push(`start:${node.id}`);
      await sleep(durations[node.id] ?? 20);
      log.push(`end:${node.id}`);
      if ((opts.fail || []).includes(node.id)) return { success: false, failure_class: 'llm', evidence: [], output: 'no' };
      return { success: true, failure_class: null, evidence: [], output: 'ok' };
    },
  };
  const events = [];
  const manager = new runtime.InplaceWorkspaceManager(dir);
  const result = await new runtime.Scheduler().run(graph(tasks), {
    projectRoot: dir, sessionId: null, runId: `r-${dispatch}`, executor, workspaceManager: manager,
    onEvent: (e) => events.push(e),
    options: { dispatch, maxRunDurationMs: 60_000 },
    parallel: { maxParallel: opts.max ?? 3, manager, integrate: async () => ({ ok: true, files: [], outside: [] }), discard: async () => undefined },
  });
  return { result, log, events };
}

const PLAN = [
  { id: 'T1', wave: 1, files: ['src/slow.js'] },
  { id: 'T2', wave: 1, files: ['src/b.js'] },
  { id: 'T3', wave: 2, files: ['src/c.js'], dependsOn: ['T2'] },
];

describe('OXB-129: stream dispatch', () => {
  it('T3 (depends only on T2) starts before the slow T1 ends; in wave mode it waits for the whole wave', async () => {
    const s = await run('stream', PLAN, { durations: { T1: 400 } });
    assert.deepEqual(s.result.completed.sort(), ['T1', 'T2', 'T3']);
    assert.ok(s.log.indexOf('start:T3') < s.log.indexOf('end:T1'), s.log.join(' '));
    const w = await run('wave', PLAN, { durations: { T1: 400 } });
    assert.ok(w.log.indexOf('start:T3') > w.log.indexOf('end:T1'), w.log.join(' '));
    const ds = s.events.filter((e) => e.type === 'DispatchState');
    assert.ok(ds.some((e) => e.payload.waiting.some((x) => x.id === 'T3' && /depende de T2/.test(x.reason))));
  });

  it('the parallel limit is respected and a hot file serializes', async () => {
    const tasks = [{ id: 'T1', wave: 1, files: ['src/x.js'] }, { id: 'T2', wave: 1, files: ['src/x.js'] }, { id: 'T3', wave: 1, files: ['src/y.js'] }, { id: 'T4', wave: 1, files: ['src/z.js'] }];
    const r = await run('stream', tasks, { max: 2, durations: { T1: 100, T2: 100, T3: 100, T4: 100 } });
    let live = 0;
    let peak = 0;
    for (const e of r.log) { live += e.startsWith('start:') ? 1 : -1; peak = Math.max(peak, live); }
    assert.equal(peak, 2);
    assert.ok(r.log.indexOf('start:T2') > r.log.indexOf('end:T1'), 'T2 shares src/x.js with T1');
    assert.ok(r.events.some((e) => e.type === 'DispatchState' && e.payload.waiting.some((x) => x.id === 'T2' && /arquivo quente/.test(x.reason))));
  });

  it('a failed dependency blocks only its dependents', async () => {
    const tasks = [{ id: 'T1', wave: 1, files: ['a.js'] }, { id: 'T2', wave: 1, files: ['b.js'] }, { id: 'T3', wave: 2, files: ['c.js'], dependsOn: ['T1'] }, { id: 'T4', wave: 2, files: ['d.js'], dependsOn: ['T2'] }];
    const r = await run('stream', tasks, { fail: ['T1'] });
    assert.deepEqual(r.result.completed.sort(), ['T2', 'T4']);
    assert.ok(r.result.blocked.includes('T3'));
  });
});
