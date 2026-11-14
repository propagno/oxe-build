'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const kf = require('../bin/lib/oxe-known-failures.cjs');
const shipPr = require('../bin/lib/oxe-ship-pr.cjs');

// 1.21.2 — G5/G8 (OxeSpace 14/11, OXE-49 / PR #799): the CI verdict of any PR (outside a phase too), of a card's PRs
// and of the repository's open PRs with the train labels; known failures shared by every worktree of the clone and
// expired when the PR that fixes them merges; the verdict published on the PR. gh is faked.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ship-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Dev');
  git(dir, 'config', 'user.email', 'dev@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** A fake gh: open PRs, their checks, the failed logs, PR states, comments. */
function fakeGh(state) {
  const calls = [];
  const spawn = (cmd, args, opts = {}) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd !== 'gh') return spawnSync(cmd, args, opts);
    const json = (o) => ({ status: 0, stdout: JSON.stringify(o) });
    if (args[0] === 'pr' && args[1] === 'list') return json(state.prs);
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('state') && !args.includes('number,title,headRefName,url,labels,isDraft,state')) return json({ state: (state.states || {})[args[2]] || 'OPEN' });
    if (args[0] === 'pr' && args[1] === 'view') return json(state.prs.find((p) => String(p.number) === args[2]) || {});
    if (args[0] === 'pr' && args[1] === 'checks') return json(state.checks[args[2]] || []);
    if (args[0] === 'run' && args[1] === 'view') return { status: 0, stdout: state.logs[args[2]] || '' };
    if (args[0] === 'api' && /issues\/\d+\/comments$/.test(args[1])) return json(state.comments);
    if (args[0] === 'api' && args[1] === '-X') { state.patched.push({ url: args[3], body: opts.input }); return json({}); }
    if (args[0] === 'pr' && args[1] === 'comment') { state.comments.push({ id: 900 + state.comments.length, body: opts.input }); return json({}); }
    return { status: 1, stderr: `fake gh: ${args.join(' ')}` };
  };
  return { spawn, calls };
}

const WORLD = () => ({
  prs: [
    { number: 799, title: 'feat(brand): OXE-49 M2 cores', headRefName: 'feat/oxe-49-m2', url: 'https://github.com/o/r/pull/799', labels: [{ name: 'na-fila' }], isDraft: false, state: 'OPEN', body: '' },
    { number: 801, title: 'fix: sidebar', headRefName: 'fix/sidebar', url: 'https://github.com/o/r/pull/801', labels: [], isDraft: false, state: 'OPEN', body: 'Card: OXE-58' },
  ],
  checks: {
    799: [{ name: 'e2e (windows)', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/43571367627/job/1' }],
    801: [{ name: 'e2e (linux)', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/43580000000/job/2' }],
  },
  logs: { 43571367627: 'x\n  ✘ e2e/split-after-layout.spec.ts:30 › split keeps the layout\n', 43580000000: '  ✘ e2e/new-thing.spec.ts:12 › fails\n' },
  states: { 797: 'OPEN', 790: 'MERGED' },
  comments: [],
  patched: [],
});

describe('G5: known failures of the REPOSITORY, shared by every worktree, expired by the fix PR merge', () => {
  it('a failure added in one worktree is in force in another worktree of the same clone; ids never collide', () => {
    const dir = repo();
    const wt = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
    dirs.push(wt);
    git(dir, 'worktree', 'add', '-q', wt, '-b', 'other');
    const a = kf.add(kf.repoDir(dir), { pattern: 'split-after-layout.spec.ts:30', item: 'OXE-49', pr: '797' });
    const b = kf.add(kf.repoDir(wt), { pattern: 'terminal-focus-exit.spec.ts:35', item: 'OXE-135' });
    assert.equal(path.resolve(kf.repoDir(dir)), path.resolve(kf.repoDir(wt)), 'one store for the clone');
    assert.deepEqual([a.id, b.id], ['KF-1', 'KF-2']);
    assert.deepEqual(kf.listAll(wt, null).map((k) => k.pattern), ['split-after-layout.spec.ts:30', 'terminal-focus-exit.spec.ts:35']);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe')), 'nothing in the checkout');
  });

  it('a folder that only sits inside another repository (a home dir under git) never writes into that repo\'s .git', () => {
    const dir = repo();
    const sub = path.join(dir, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(kf.repoDir(sub), null, 'not the repository root: no repo store');
    assert.ok(kf.repoDir(dir), 'the root: the repo store');
  });

  it('a worktree\'s old .oxe/program entries stay readable (wt:KF-n) and are not duplicated', () => {
    const dir = repo();
    const programDir = path.join(dir, '.oxe', 'program');
    kf.add(programDir, { pattern: 'thread-view.spec.ts:10', item: 'OXE-103' });
    kf.add(programDir, { pattern: 'same.spec.ts:1', item: 'OXE-1' });
    kf.add(kf.repoDir(dir), { pattern: 'same.spec.ts:1', item: 'OXE-1' });
    const all = kf.listAll(dir, programDir);
    assert.deepEqual(all.map((k) => `${k.id}:${k.scope}`), ['KF-1:repo', 'wt:KF-1:worktree']);
  });

  it('expires when the PR that fixes it merges; prune removes it', () => {
    const dir = repo();
    const store = kf.repoDir(dir);
    kf.add(store, { pattern: 'a.spec.ts:1', item: 'OXE-1', pr: '#790' });
    kf.add(store, { pattern: 'b.spec.ts:2', item: 'OXE-2', pr: '797' });
    kf.add(store, { pattern: 'c.spec.ts:3', item: 'OXE-3' });
    const prState = (pr) => ({ 790: 'MERGED', 797: 'OPEN' }[pr] || null);
    const all = kf.listAll(dir, null, { prState });
    assert.deepEqual(all.filter((k) => k.expired).map((k) => k.pattern), ['a.spec.ts:1']);
    assert.equal(kf.prune(dir, { prState }).pruned.length, 1);
    assert.deepEqual(kf.list(store).map((k) => k.pattern), ['b.spec.ts:2', 'c.spec.ts:3']);
  });
});

describe('G5/G8: ship status --pr | --card | --repo, with the CI verdict', () => {
  it('--pr: a PR outside any phase gets its verdict; a matching known failure is a flake to rerun', () => {
    const dir = repo();
    kf.add(kf.repoDir(dir), { pattern: 'split-after-layout.spec.ts:30', item: 'OXE-49', pr: '797' });
    const w = WORLD();
    const g = fakeGh(w);
    const out = op.runtimeShipPr(dir, null, { pr: '799', ghSpawn: g.spawn });
    assert.equal(out.prs.length, 1);
    assert.equal(out.prs[0].ci.state, 'known_flake');
    assert.equal(out.prs[0].ci.suggestion, 'gh run rerun 43571367627 --failed');
    assert.deepEqual(out.prs[0].train, ['na-fila']);
    // the fix PR merged: the same red is a regression again
    w.states['797'] = 'MERGED';
    const after = op.runtimeShipPr(dir, null, { pr: '799', ghSpawn: fakeGh(w).spawn });
    assert.equal(after.prs[0].ci.state, 'regression');
    assert.equal(after.expired.length, 1);
  });

  it('--card: the PRs that name the card in the title, body or branch; --repo: every open PR', () => {
    const dir = repo();
    const w = WORLD();
    assert.deepEqual(op.runtimeShipPr(dir, null, { card: 'OXE-49', ghSpawn: fakeGh(w).spawn }).prs.map((p) => p.pr), [799]);
    assert.deepEqual(op.runtimeShipPr(dir, null, { card: 'OXE-58', ghSpawn: fakeGh(w).spawn }).prs.map((p) => p.pr), [801]);
    assert.deepEqual(op.runtimeShipPr(dir, null, { card: 'OXE-4', ghSpawn: fakeGh(w).spawn }).prs.map((p) => p.pr), [], 'OXE-4 is not OXE-49');
    const all = op.runtimeShipPr(dir, null, { repo: true, ghSpawn: fakeGh(w).spawn });
    assert.deepEqual(all.prs.map((p) => [p.pr, p.ci.state]), [[799, 'regression'], [801, 'regression']]);
  });

  it('--comment: a simulation without --apply; with --apply the verdict is commented, then updated in place', () => {
    const dir = repo();
    kf.add(kf.repoDir(dir), { pattern: 'split-after-layout.spec.ts:30', item: 'OXE-49', pr: '797' });
    const w = WORLD();
    const sim = op.runtimeShipPr(dir, null, { pr: '799', comment: true, ghSpawn: fakeGh(w).spawn });
    assert.equal(sim.comments[0].planned, true);
    assert.match(sim.comments[0].body, /CI \(OXE\): falha conhecida \(rerun\)/);
    assert.equal(w.comments.length, 0);
    op.runtimeShipPr(dir, null, { pr: '799', comment: true, apply: true, ghSpawn: fakeGh(w).spawn });
    assert.equal(w.comments.length, 1);
    assert.ok(w.comments[0].body.includes(shipPr.MARKER));
    const again = op.runtimeShipPr(dir, null, { pr: '799', comment: true, apply: true, ghSpawn: fakeGh(w).spawn });
    assert.equal(again.comments[0].updated, true);
    assert.equal(w.comments.length, 1, 'one comment per PR');
    assert.equal(w.patched.length, 1);
  });

  it('the CLI: ship --help exits 0 and lists --pr/--card/--repo; the main help lists ship, quick and workflow', () => {
    const help = spawnSync(process.execPath, [CLI, 'ship', '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /ship status --pr <n> \| --card <KEY> \| --repo/);
    const main = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.match(main.stdout, /oxe-cc ship <status/);
    assert.match(main.stdout, /oxe-cc quick <KEY>/);
    assert.match(main.stdout, /oxe-cc workflow path <slug>/);
  });
});
