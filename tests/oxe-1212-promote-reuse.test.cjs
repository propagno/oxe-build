'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const { scriptOfBanner } = require('../bin/lib/oxe-progress-run.cjs');

// 1.21.2 — OXB-164 (TECH LEAD, rc.26): (1) a promote branch already pushed but with no PR was refused, so names had
// to be invented and stale oxe/promote-tN piled up; (2) a promote killed during pr:ready left .oxe/promote-ws/t3-*
// WITH its node_modules junction; (3) pr:ready ran 10+ min with no sign of life.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-p164-'));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  fs.mkdirSync(dir);
  git(root, 'init', '-q', '--bare', origin);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\nnode_modules/\n');
  write(dir, 'src/a.js', 'module.exports = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  g('checkout', '-qb', 'oxe/f4-plan');
  write(dir, 'src/a.js', 'module.exports = 2;\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T1 a', '-m', 'OXE-Task: T1');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], done: true }] }));
  return { root, dir };
}

describe('OXB-164: promote reuses its own pushed branch without a PR', () => {
  it('pushed, gh pr create failed (no PR): the next promote rebuilds it with a force-push lease', () => {
    const { dir } = setup();
    const failing = (cmd, args) => (args[1] === 'create' ? { status: 1, stdout: '', stderr: 'GraphQL: something went wrong' } : { status: 0, stdout: '[]', stderr: '' });
    const first = op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: failing });
    assert.match(first.error, /gh pr create falhou/);
    const before = git(dir, 'ls-remote', '--heads', 'origin', 'oxe/promote-t1').split(/\s+/)[0];
    // the program branch moves (the task got amended): the rebuilt branch has to differ
    write(dir, 'src/a.js', 'module.exports = 3;\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fix: T1 a again', '-m', 'OXE-Task: T1');
    const calls = [];
    const ok = (cmd, args) => { calls.push(args); return args[1] === 'list' ? { status: 0, stdout: '[]', stderr: '' } : { status: 0, stdout: 'https://github.com/x/y/pull/9\n', stderr: '' }; };
    const again = op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: ok });
    assert.equal(again.error, undefined, again.error);
    assert.equal(again.replaced_remote, before);
    assert.equal(again.pr, 'https://github.com/x/y/pull/9');
    const after = git(dir, 'ls-remote', '--heads', 'origin', 'oxe/promote-t1').split(/\s+/)[0];
    assert.notEqual(after, before);
    assert.ok(calls.some((a) => a[1] === 'list' && a.includes('--head') && a.includes('all')));
  });

  it('refused when gh cannot confirm there is no PR, or when the branch was not made by a promote', () => {
    const { dir } = setup();
    const failing = (cmd, args) => (args[1] === 'create' ? { status: 1, stdout: '', stderr: 'x' } : { status: 0, stdout: '[]', stderr: '' });
    op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: failing });
    const noGh = () => ({ status: 1, stdout: '', stderr: 'gh: not logged in' });
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: noGh }), /não consegui confirmar pelo gh/);
    // someone's branch on the remote with that name
    git(dir, 'push', '-q', 'origin', 'main:refs/heads/oxe/someone');
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T1', base: 'main', branch: 'oxe/someone', openPr: true, ghSpawn: failing }), /não foi criada por um promote deste projeto/);
  });
});

describe('OXB-164: killed promote cleanup', () => {
  it('a stale promote-ws (dead pid) is swept with its junction unlinked first; the real node_modules survives', () => {
    const { root, dir } = setup();
    const realNm = path.join(root, 'real-node_modules');
    write(realNm, 'dep/index.js', 'module.exports = 1;\n');
    const stale = path.join(dir, '.oxe', 'promote-ws', 't1-dead');
    git(dir, 'worktree', 'add', '-q', '--detach', stale, 'main');
    fs.symlinkSync(realNm, path.join(stale, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(`${stale}.pid`, JSON.stringify({ pid: 999999, task: 'T1' }));
    // a live one (this process's parent pid) is kept
    const live = path.join(dir, '.oxe', 'promote-ws', 't9-live');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(`${live}.pid`, JSON.stringify({ pid: process.ppid, task: 'T9' }));
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main' });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.swept, ['.oxe/promote-ws/t1-dead']);
    assert.ok(!fs.existsSync(stale));
    assert.ok(fs.existsSync(path.join(realNm, 'dep', 'index.js')), 'the junction target is intact');
    assert.ok(fs.existsSync(live), 'a promote still running is not touched');
    assert.ok(!fs.readdirSync(path.join(dir, '.oxe', 'promote-ws')).some((n) => n.startsWith('t1-') && n.endsWith('.pid')), 'own pid file removed with the worktree');
  });
});

describe('OXB-164: pr:ready progress', () => {
  it('npm banners → script names', () => {
    assert.equal(scriptOfBanner('> oxespace@1.5.0 typecheck'), 'typecheck');
    assert.equal(scriptOfBanner('> @scope/pkg@0.1.0 lint:fix'), 'lint:fix');
    assert.equal(scriptOfBanner('> tsc --noEmit'), null);
  });

  it('prints one line per script that starts, a heartbeat, and the verdict; returns the tail as JSON', () => {
    const { dir } = setup();
    write(dir, 'package.json', JSON.stringify({ name: 'p', version: '1.0.0', scripts: { 'pr:ready': 'npm run lint && npm run typecheck', lint: 'node -e 0', typecheck: 'node -e "setTimeout(()=>{},700)"' } }));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'lib', 'oxe-progress-run.cjs'), 'pr:ready', '60000', '250', '--', 'npm run pr:ready'], { cwd: dir, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 0, r.stderr);
    assert.match(r.stderr, /pr:ready: ▶ lint/);
    assert.match(r.stderr, /pr:ready: lint ok \(\d+s\) · ▶ typecheck/);
    assert.match(r.stderr, /typecheck rodando há/);
    assert.match(r.stderr, /typecheck ok · verde em/);
    assert.deepEqual(out.scripts, ['lint', 'typecheck']);
  });
});
