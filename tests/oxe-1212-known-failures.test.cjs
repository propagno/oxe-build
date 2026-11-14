'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const kf = require('../bin/lib/oxe-known-failures.cjs');

// 1.21.2 — from the ALM coordination: a merge-train car fell on a flake already fixed elsewhere
// (thread-view.spec.ts:310 → PR #797, OXE-103). A red CI that matches a known failure is a rerun, not a regression.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-kf-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ delivery: 'pr' }));
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, active_phase: 'F2', phases: [{ id: 'F2', status: 'verifying', acceptance: [], started_at: new Date(Date.now() - 60_000).toISOString() }] }));
  return dir;
}

/** Fake gh: one failed check whose log has the given text. */
const gh = (log, checks) => (cmd, args) => {
  const a = args.join(' ');
  if (a.startsWith('pr checks')) return { status: 1, stdout: JSON.stringify(checks || [{ name: 'e2e-windows', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/4242/job/7' }, { name: 'lint', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/4243/job/1' }]) };
  if (a.startsWith('run view 4242 --log-failed')) return { status: 0, stdout: log };
  if (a.startsWith('pr view')) return { status: 0, stdout: JSON.stringify({ state: 'OPEN' }) };
  return { status: 1, stdout: '', stderr: 'sem rota' };
};

describe('known CI failures', () => {
  it('registry: add (needs the item), list, remove; substring or /regex/', () => {
    const dir = project();
    const pdir = path.join(dir, '.oxe', 'program');
    assert.throws(() => kf.add(pdir, { pattern: 'thread-view.spec.ts:310' }), /--item/);
    const k = kf.add(pdir, { pattern: 'thread-view.spec.ts:310', item: 'OXE-103', pr: '797' });
    assert.equal(k.id, 'KF-1');
    kf.add(pdir, { pattern: '/sidebar.*flash/i', item: 'OXE-110' });
    assert.equal(kf.list(pdir).length, 2);
    assert.deepEqual(kf.match('✘ e2e/thread-view.spec.ts:310:5 › abre a thread', kf.list(pdir)).map((x) => x.id), ['KF-1']);
    assert.deepEqual(kf.match('Sidebar FLASH before first use', kf.list(pdir)).map((x) => x.id), ['KF-2']);
    kf.remove(pdir, 'KF-1', { reason: 'PR #797 na main' });
    assert.deepEqual(kf.list(pdir).map((x) => x.id), ['KF-2']);
  });

  it('ship status: a red that matches a known failure → known_flake + "gh run rerun <id> --failed"; otherwise regression', () => {
    const dir = project();
    const pdir = path.join(dir, '.oxe', 'program');
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T3', payload: { pr: 'https://github.com/o/r/pull/801' } });
    kf.add(pdir, { pattern: 'thread-view.spec.ts:310', item: 'OXE-103', pr: '797' });
    const flaky = op.runtimeDeliveryStatus(dir, null, { ghSpawn: gh('  ✘ e2e/thread-view.spec.ts:310:5 › abre a thread (timeout)') });
    const ci = flaky.prs[0].ci;
    assert.equal(ci.state, 'known_flake');
    assert.equal(ci.suggestion, 'gh run rerun 4242 --failed');
    assert.deepEqual(ci.failed[0].known.map((k) => k.item), ['OXE-103']);
    const red = op.runtimeDeliveryStatus(dir, null, { ghSpawn: gh('  ✘ e2e/compose.spec.ts:44 › envia (assert)') });
    assert.equal(red.prs[0].ci.state, 'regression');
    assert.equal(red.prs[0].ci.suggestion, undefined);
    const closed = op.runtimeDeliveryStatus(dir, null, { ghSpawn: gh('✘ thread-view.spec.ts:310'), itemOpen: () => false });
    assert.equal(closed.prs[0].ci.state, 'regression', 'the tracking item is closed: the flake should be gone');
    const green = op.runtimeDeliveryStatus(dir, null, { ghSpawn: gh('', [{ name: 'e2e', state: 'SUCCESS', bucket: 'pass', link: 'x' }]) });
    assert.equal(green.prs[0].ci.state, 'green');
  });

  it('CLI: ship known-failure add / list', () => {
    const dir = project();
    const run = (...a) => spawnSync(process.execPath, [CLI, 'ship', 'known-failure', ...a, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const add = run('add', 'thread-view.spec.ts:310', '--item', 'OXE-103', '--pr', '797');
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /KF-1: "thread-view.spec.ts:310" (→|->) OXE-103 \(PR 797\)/);
    assert.match(run('list').stdout, /KF-1 {2}"thread-view.spec.ts:310" (→|->) OXE-103/);
    assert.equal(run('add', 'x.spec.ts').status, 1, 'no item → refused');
  });
});
