'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-138: defer the task that does not converge and go on with the independent ones.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const gate = 'node -e "process.exit(require(\'fs\').existsSync(\'.oxe/fixed\')?0:1)"';

function project(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-df-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', budget: { max_retries: 0 }, tasks: [
    { id: 'T1', title: 'nao converge', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: [gate] } },
    { id: 'T3', title: 'independente', wave: 1, files: ['src/c.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'depende de T1', wave: 2, depends_on: ['T1'], files: ['src/b.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    { id: 'T4', title: 'depende de T3', wave: 2, depends_on: ['T3'], files: ['src/d.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
  ] }, null, 2));
  for (const f of ['a', 'b', 'c', 'd']) write(dir, `src/${f}.js`, '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const exec = (calls) => ({ async execute(node) { calls.push(node.id); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } });

describe('OXB-138: deferred tasks', () => {
  it('T1 exhausts its attempts: T3 and T4 land, T2 is blocked_by_deferred, the ledger has T1', async () => {
    const dir = project();
    const calls = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: exec(calls), skipPreflight: true });
    assert.deepEqual(res.result.completed.sort(), ['T3', 'T4']);
    assert.ok(!calls.includes('T2'), 'the dependent never runs');
    const ev = op.readEvents(dir, null);
    assert.ok(ev.some((e) => e.type === 'WorkItemDeferred' && e.work_item_id === 'T1'));
    assert.ok(ev.some((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T2' && e.payload.reason === 'blocked_by_deferred'));
    const d = op.runtimeDeferred(dir, null, {});
    assert.deepEqual(d.open.map((e) => [e.id, e.task]), [['AD-F1-1', 'T1']]);
    // the close does not pass with an open AD
    const defects = op.runtimeDefects(dir, null, {});
    assert.ok(defects.open.some((x) => x.kind === 'deferred' && /AD-F1-1/.test(x.text)));
  });

  it('deferred retry: already resolved when the verify passes on the current tree', async () => {
    const dir = project();
    await op.runRuntimeExecute(dir, null, { executor: exec([]), skipPreflight: true });
    assert.equal(op.runtimeDeferred(dir, null, { action: 'retry', dryRun: true }).retry[0].status, 'ready');
    write(dir, '.oxe/fixed', '');
    const r = op.runtimeDeferred(dir, null, { action: 'retry' });
    assert.deepEqual(r.retry.map((x) => [x.id, x.status]), [['AD-F1-1', 'already_resolved']]);
    assert.equal(op.runtimeDeferred(dir, null, {}).open.length, 0);
  });

  it('execute.defer_failed: false keeps the old stop-at-the-failed-wave', async () => {
    const dir = project({ execute: { defer_failed: false } });
    const calls = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: exec(calls), skipPreflight: true });
    assert.ok(!res.result.completed.includes('T4'));
  });
});
