'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-161: `runtime promote T3 --open-pr` (rc.25) built oxe/promote-t3 on origin/main; T3 imports what T1
// creates and T1's PR (#720) was not merged yet → pr:ready's typecheck red. In a strict chain every task after the
// first failed this way. Local only: a bare repo is `origin`, gh is a fake.

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-p161-'));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  fs.mkdirSync(dir);
  git(root, 'init', '-q', '--bare', origin);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/index.js', 'module.exports = 0;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  g('checkout', '-qb', 'oxe/f2-plan');
  write(dir, 'src/private-json.js', 'exports.writePrivateJson = () => 1;\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T1 private json', '-m', 'OXE-Task: T1');
  write(dir, 'src/export.js', "const { writePrivateJson } = require('./private-json');\nmodule.exports = writePrivateJson;\n");
  g('add', '-A'); g('commit', '-qm', 'feat: T3 export', '-m', 'OXE-Task: T3');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'private json', wave: 1, files: ['src/private-json.js'], done: true },
    { id: 'T3', title: 'export', wave: 2, files: ['src/export.js'], depends_on: ['T1'], done: true },
  ] }));
  // pr:ready = the import must resolve on the promoted branch (the typecheck of the real case)
  write(dir, 'package.json', JSON.stringify({ name: 'x', scripts: { 'pr:ready': 'node -e "require(\'fs\').existsSync(\'src/export.js\') && require(\'./src/export.js\')"' } }));
  g('add', 'package.json'); g('commit', '-qm', 'chore: pr:ready');
  g('checkout', '-q', 'main'); g('checkout', '-q', 'oxe/f2-plan', '--', 'package.json'); g('commit', '-qm', 'chore: pr:ready'); g('push', '-q', 'origin', 'main');
  g('checkout', '-q', 'oxe/f2-plan');
  return { dir, origin };
}

const fakeGh = (states = {}) => {
  const calls = [];
  let n = 700;
  const ghSpawn = (cmd, args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'create') { n += 20; return { status: 0, stdout: `https://github.com/x/y/pull/${n}\n`, stderr: '' }; }
    if (args[0] === 'pr' && args[1] === 'view') return { status: 0, stdout: JSON.stringify({ state: states[args[2]] || 'OPEN' }), stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { ghSpawn, calls };
};

describe('OXB-161: dependency-aware promote', () => {
  it('T3 depends on T1 (promoted, PR open): built on T1\'s branch, PR against main, stacked_on recorded', () => {
    const { dir } = setup();
    const gh = fakeGh();
    const t1 = op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    assert.equal(t1.error, undefined, t1.error);
    assert.equal(t1.pr, 'https://github.com/x/y/pull/720');
    const t3 = op.runtimePromote(dir, null, { task: 'T3', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    assert.equal(t3.error, undefined, t3.error);
    assert.equal(t3.pr_ready.ok, true, 'the import resolves: T1 is under T3');
    assert.equal(t3.stacked_on.task, 'T1');
    assert.equal(t3.stacked_on.pr, 'https://github.com/x/y/pull/720');
    const create = gh.calls.filter((a) => a[1] === 'create').pop();
    assert.equal(create[create.indexOf('--base') + 1], 'main', 'the PR targets the base, not T1\'s branch');
    const body = fs.readFileSync(path.join(dir, t3.body_file), 'utf8');
    assert.match(body, /Empilhada sobre T1\*\* \(PR https:\/\/github\.com\/x\/y\/pull\/720/);
    const events = fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8');
    assert.match(events, /"stacked_on":\{"task":"T1"/);
    assert.ok(git(dir, 'log', '--format=%s', 'origin/main..origin/oxe/promote-t3').includes('feat: T1 private json'));
  });

  it('once T1\'s PR is merged, T3 is built on the base as before', () => {
    const { dir } = setup();
    const gh = fakeGh();
    op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    // the train merges T1 into main
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', 'origin/oxe/promote-t1', '-m', 'Merge #720');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', 'oxe/f2-plan');
    const merged = fakeGh({ 'https://github.com/x/y/pull/720': 'MERGED' });
    const t3 = op.runtimePromote(dir, null, { task: 'T3', base: 'main', openPr: true, ghSpawn: merged.ghSpawn });
    assert.equal(t3.error, undefined, t3.error);
    assert.equal(t3.stacked_on, undefined);
    assert.equal(git(dir, 'log', '--format=%s', 'origin/main..origin/oxe/promote-t3'), 'feat: T3 export');
  });

  it('merged detected by git when gh cannot answer (patch already in the base)', () => {
    const { dir } = setup();
    const gh = fakeGh();
    op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'cherry-pick', 'origin/oxe/promote-t1');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', 'oxe/f2-plan');
    const noGh = () => ({ status: 1, stdout: '', stderr: 'gh: not logged in' });
    const t3 = op.runtimePromote(dir, null, { task: 'T3', base: 'main', ghSpawn: noGh, branch: 'oxe/t3-b' });
    assert.equal(t3.error, undefined, t3.error);
    assert.equal(t3.stacked_on, undefined);
  });

  it('--hold-deps waits for the merge instead of stacking; times out with the PR named', () => {
    const { dir } = setup();
    const gh = fakeGh();
    op.runtimePromote(dir, null, { task: 'T1', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    assert.throws(
      () => op.runtimePromote(dir, null, { task: 'T3', base: 'main', openPr: true, ghSpawn: gh.ghSpawn, holdDeps: true, holdTimeoutMs: 300, holdPollMs: 100 }),
      /T3 aguarda o merge de T1 \(https:\/\/github\.com\/x\/y\/pull\/720\)/,
    );
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8'), /TaskPromoteHeld/);
  });

  it('a dependency never promoted: warned, branch from the base; pr:ready red message keeps the PR against main', () => {
    const { dir } = setup();
    const gh = fakeGh();
    const t3 = op.runtimePromote(dir, null, { task: 'T3', base: 'main', openPr: true, ghSpawn: gh.ghSpawn });
    assert.match(t3.warnings.join('\n'), /T3 depende de T1, que não foi promovida/);
    assert.equal(t3.pr_ready.ok, false);
    assert.match(t3.error, /o PR vai contra main/);
    assert.ok(t3.commands.some((c) => /gh pr create --base main /.test(c)));
  });
});
