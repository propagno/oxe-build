'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-060: the program branch (oxe/f1-plan) drifts from main; delivery is a per-task PR cherry-picked by hand.
// Everything here is local: a bare repo plays `origin`, and `gh` is a fake. No network, no executor.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const planOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
const node = (code) => `node -e "${code}"`;

/** main: base files; program branch oxe/f1-plan: T1 (src/a.js) and T2 (src/b.js) checkpoints, plus the A1 test. */
function setup({ plan } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sync-'));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  fs.mkdirSync(dir);
  git(root, 'init', '-q', '--bare', origin);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/a.js', 'module.exports = 1;\n');
  write(dir, 'src/b.js', 'module.exports = 2;\n');
  write(dir, 'src/shared.js', 'module.exports = "ok";\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'checkout', '-q', '-b', 'oxe/f1-plan');
  write(dir, 'tests/a1.test.js', 'frozen acceptance test of A1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'test(a1): frozen acceptance test');
  write(dir, 'src/a.js', 'module.exports = 10;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'feat: T1 a\n\nOXE-Task: T1');
  write(dir, 'src/b.js', 'module.exports = 20;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'feat: T2 b\n\nOXE-Task: T2');
  const doc = plan || {
    schema_version: 1,
    tasks: [
      // T1 reads src/shared.js: its verify goes red if main changes that file to "broken".
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js', 'src/shared.js'], acceptance: ['A1'], done: true, verify: { commands: [`${node("process.exit(require('./src/shared.js')==='ok'?0:1)")} && ${node('process.exit(0)')}`] } },
      { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A2'], done: true, verify: { commands: [node('process.exit(0)')] } },
      { id: 'T3', title: 'c', wave: 2, files: ['src/c.js'], acceptance: ['A3'], done: false, verify: { commands: [node('process.exit(0)')] } },
    ],
    acceptance_tests: [{ criterion: 'A1', files: ['tests/a1.test.js'], command: 'node --test tests/a1.test.js' }],
  };
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify(doc, null, 2));
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/config.json', '{}');
  return { dir, origin };
}

/** Another clone pushes to main: `files` changed upstream. */
function advanceMain(dir, files) {
  git(dir, 'checkout', '-q', 'main');
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'upstream change');
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'checkout', '-q', 'oxe/f1-plan');
}

describe('OXB-060: runtime sync --from origin/main', () => {
  it('merges main; done tasks whose files changed are reverified per segment: still green stays done, now red reopens', () => {
    const { dir } = setup();
    advanceMain(dir, { 'src/shared.js': 'module.exports = "broken";\n' });
    const out = op.runtimeSync(dir, null, { from: 'origin/main' });
    assert.equal(out.merged, true, out.error);
    assert.deepEqual(out.upstream_files, ['src/shared.js']);
    assert.deepEqual(out.needs_reverify, ['T1']);
    assert.deepEqual(out.table.map((r) => [r.task, r.status]), [['T1', 'now_red']]);
    assert.deepEqual(out.table[0].failed_segment.index, 1);
    assert.equal(out.table[0].failed_segment.total, 2);
    const plan = planOf(dir);
    assert.equal(plan.tasks[0].done, false, 'T1 reopened');
    assert.equal(plan.tasks[1].done, true, 'T2 untouched by main');
    assert.match(git(dir, 'log', '-1', '--format=%s'), /Merge origin\/main/);
  });

  it('a change that keeps the task green clears needs_reverify; up to date is a no-op', () => {
    const { dir } = setup();
    advanceMain(dir, { 'src/shared.js': 'module.exports = "ok"; // comment\n' });
    const out = op.runtimeSync(dir, null, { from: 'origin/main' });
    assert.deepEqual(out.table.map((r) => [r.task, r.status]), [['T1', 'still_green']]);
    const t1 = planOf(dir).tasks[0];
    assert.equal(t1.done, true);
    assert.equal(t1.needs_reverify, undefined);
    assert.equal(t1.reverified.since, 'origin/main');
    assert.equal(op.runtimeSync(dir, null, { from: 'origin/main' }).up_to_date, true);
  });

  it('a conflict aborts the merge and leaves the branch as it was', () => {
    const { dir } = setup();
    advanceMain(dir, { 'src/a.js': 'module.exports = 99;\n' });
    const head = git(dir, 'rev-parse', 'HEAD');
    const out = op.runtimeSync(dir, null, { from: 'origin/main' });
    assert.equal(out.merged, false);
    assert.deepEqual(out.conflicts, ['src/a.js']);
    assert.match(out.error, /conflito/);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
    assert.equal(git(dir, 'status', '--porcelain'), '');
  });

  it('refuses a dirty working tree (outside .oxe/)', () => {
    const { dir } = setup();
    write(dir, 'src/a.js', 'dirty\n');
    assert.throws(() => op.runtimeSync(dir, null, { from: 'main' }), /working tree com mudanças/);
  });
});

describe('OXB-060: runtime promote T<n> --base main', () => {
  it('branch from main with the task checkpoint and its frozen test, cherry-picked -x; back on the program branch', () => {
    const { dir } = setup();
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main' });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.commits.length, 2, 'the A1 test commit and the T1 checkpoint');
    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'oxe/f1-plan');
    const log = git(dir, 'log', '--format=%s%n%b', 'main..oxe/promote-t1');
    assert.match(log, /feat: T1 a/);
    assert.match(log, /test\(a1\)/);
    assert.match(log, /cherry picked from commit/);
    assert.doesNotMatch(log, /T2/);
    assert.equal(git(dir, 'show', 'oxe/promote-t1:src/b.js'), 'module.exports = 2;', 'T2 hunks do not leak');
    const body = fs.readFileSync(path.join(dir, out.body_file), 'utf8');
    assert.match(body, /## T1 — a/);
    assert.match(body, /`src\/a\.js`/);
    assert.ok(out.commands.some((c) => /--body-file \.oxe\/promote\/T1\.md/.test(c)), 'PR body always by file');
    assert.ok(!out.commands.some((c) => /--body /.test(c) || /label/.test(c)));
  });

  it('runs pr:ready on the promoted branch head and reports it', () => {
    const { dir } = setup();
    write(dir, 'package.json', JSON.stringify({ scripts: { 'pr:ready': `node -e "process.exit(require('fs').readFileSync('src/a.js','utf8').includes('10')?0:1)"` } }));
    git(dir, 'add', 'package.json');
    git(dir, 'commit', '-qm', 'chore: pr:ready');
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'package.json', JSON.stringify({ scripts: { 'pr:ready': `node -e "process.exit(require('fs').readFileSync('src/a.js','utf8').includes('10')?0:1)"` } }));
    git(dir, 'add', 'package.json');
    git(dir, 'commit', '-qm', 'chore: pr:ready on main');
    git(dir, 'checkout', '-q', 'oxe/f1-plan');
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main' });
    assert.equal(out.pr_ready.ok, true, out.pr_ready.tail);
  });

  it('--open-pr pushes and calls gh with --body-file; refuses a branch already on the remote', () => {
    const { dir } = setup();
    const calls = [];
    const ghSpawn = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: 'https://github.com/x/y/pull/1\n', stderr: '' }; };
    const out = op.runtimePromote(dir, null, { task: 'T2', base: 'main', openPr: true, ghSpawn });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.pr, 'https://github.com/x/y/pull/1');
    assert.ok(git(dir, 'ls-remote', '--heads', 'origin', 'oxe/promote-t2'));
    assert.ok(calls[0].includes('--body-file') && !calls[0].includes('--body') && !calls[0].includes('--label'));
    git(dir, 'branch', '-D', 'oxe/promote-t2');
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T2', base: 'main', openPr: true, ghSpawn }), /já existe em origin.*não sobrescreve nem faz force-push/);
  });

  it('a conflict discards the branch and returns to the program branch', () => {
    const { dir } = setup();
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/a.js', 'module.exports = 77;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'main edits a.js');
    git(dir, 'checkout', '-q', 'oxe/f1-plan');
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main' });
    assert.deepEqual(out.conflict.files, ['src/a.js']);
    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'oxe/f1-plan');
    assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/oxe/promote-t1'], { cwd: dir }).status, 1);
    assert.equal(git(dir, 'status', '--porcelain'), '');
  });

  it('refuses a task not done, and the CLI routes runtime promote T<n> without breaking the run pipeline', () => {
    const { dir } = setup();
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T3', base: 'main' }), /não está done/);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'promote', 'T2', '--base', 'main', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /T2 -> branch oxe\/promote-t2 a partir de main|T2 → branch oxe\/promote-t2 a partir de main/);
    assert.match(r.stdout, /gh pr create --base main --head oxe\/promote-t2 .*--body-file/);
    const s = spawnSync(process.execPath, [CLI, 'runtime', 'sync', '--from', 'main', '--no-fetch', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(s.status, 0, s.stderr + s.stdout);
  });
});
