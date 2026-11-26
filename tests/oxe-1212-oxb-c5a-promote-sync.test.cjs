'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const op = require('../bin/lib/oxe-operational.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

function makePromoteRepo() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c5a-'));
  dirs.push(ws);
  const bare = path.join(ws, 'origin.git');
  const dir = path.join(ws, 'repo');
  git(ws, 'init', '--bare', '-q', bare);
  git(ws, 'init', '-q', '-b', 'main', dir);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test User');
  git(dir, 'remote', 'add', 'origin', bare);

  write(dir, 'src/base.js', 'module.exports = 1;\n');
  write(dir, 'src/design/targets/enforced.lock.json', JSON.stringify({
    enforced: ['BRD-01.base'],
    targets: { 'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' } },
  }, null, 2));
  write(dir, '.gitignore', '.oxe/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init base');
  git(dir, 'push', '-q', '-u', 'origin', 'main');

  git(dir, 'checkout', '-q', '-b', 'oxe/f4-program');
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/config.json', JSON.stringify({ phase: 'F4' }));
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({
    schema_version: 1,
    active_phase: 'F4',
    phases: [{ id: 'F4', status: 'executing', acceptance: ['A1'] }],
  }, null, 2));

  return { ws, bare, dir };
}

describe('OXB-C5a (8e 16:50Z): runtime sync --no-verify & runtime promote --dry-run / --resolve / enforced.lock union / --keep-on-conflict + --continue', () => {
  it('runtime sync accepts --no-verify (alias for --no-reverify) without printing help', () => {
    const { dir } = makePromoteRepo();
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'base work', wave: 1, files: ['src/base.js'], acceptance: ['A1'], done: true, verify: { commands: ['node -e "process.exit(1)"'] } }],
    }, null, 2));

    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/base.js', 'module.exports = 2;\n');
    git(dir, 'add', 'src/base.js');
    git(dir, 'commit', '-qm', 'upstream update');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', 'oxe/f4-program');

    const r = spawnSync(process.execPath, [CLI, 'runtime', 'sync', '--from', 'origin/main', '--no-fetch', '--no-verify', '--json', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_PROMPT: '1' },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.merged, true);
    assert.deepEqual(out.needs_reverify, ['T1']);
    assert.deepEqual(out.reverified, [], '--no-verify skipped reverify instead of printing general help');
  });

  it('runtime promote --dry-run prints the ordered commit list and writes no branch or body file', () => {
    const { dir } = makePromoteRepo();
    write(dir, 'src/t9.js', 'exports.ok = true;\n');
    git(dir, 'add', 'src/t9.js');
    git(dir, 'commit', '-qm', 'feat: T9 feature\n\nOXE-Task: F4/T9');
    const c1 = git(dir, 'rev-parse', 'HEAD');

    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T9', title: 'feature T9', wave: 1, files: ['src/t9.js'], acceptance: ['A1'], done: true, done_commit: c1 }],
    }, null, 2));

    const res = spawnSync(process.execPath, [CLI, 'runtime', 'promote', 'T9', '--base', 'main', '--dry-run', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_PROMPT: '1' },
    });
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /\(simulação\) T9/);
    assert.match(res.stdout, new RegExp(`${c1.slice(0, 10)} feat: T9 feature`));
    assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/oxe/promote-t9'], { cwd: dir }).status, 1, 'no branch created in dry-run');
    assert.equal(fs.existsSync(path.join(dir, '.oxe', 'promote', 'T9.md')), false, 'no body file written in dry-run');
  });

  it('built-in union-json-array resolves conflicting append-only enforced.lock.json automatically across cherry-pick', () => {
    const { dir } = makePromoteRepo();
    // Main advances enforced.lock.json with another task's id (same trailing line -> git cherry-pick conflict!)
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/design/targets/enforced.lock.json', JSON.stringify({
      enforced: ['BRD-01.base', 'BRD-03.sidebar'],
      targets: {
        'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' },
        'BRD-03.sidebar': { status: 'enforced', selector: '[data-surface="sidebar"]' },
      },
    }, null, 2));
    git(dir, 'add', 'src/design/targets/enforced.lock.json');
    git(dir, 'commit', '-qm', 'main adds BRD-03.sidebar');
    git(dir, 'push', '-q', 'origin', 'main');

    git(dir, 'checkout', '-q', 'oxe/f4-program');
    write(dir, 'src/t9.js', 'exports.t9 = 1;\n');
    write(dir, 'src/design/targets/enforced.lock.json', JSON.stringify({
      enforced: ['BRD-01.base', 'BRD-02.toast'],
      targets: {
        'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' },
        'BRD-02.toast': { status: 'enforced', selector: '[data-surface="toast"]' },
      },
    }, null, 2));
    git(dir, 'add', 'src/t9.js', 'src/design/targets/enforced.lock.json');
    git(dir, 'commit', '-qm', 'feat: T9 enforced toast\n\nOXE-Task: F4/T9');
    const c1 = git(dir, 'rev-parse', 'HEAD');

    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T9', title: 'toast', wave: 1, files: ['src/t9.js', 'src/design/targets/enforced.lock.json'], acceptance: ['A1'], done: true, done_commit: c1 }],
    }, null, 2));

    const out = op.runtimePromote(dir, null, { task: 'T9', base: 'main', prReady: false });
    assert.equal(out.conflict, null, out.error);
    assert.equal(out.error, undefined, out.error);
    assert.ok(out.resolved_conflicts.some((rc) => rc.file === 'src/design/targets/enforced.lock.json' && rc.strategy === 'union-json-array'));
    const lock = JSON.parse(git(dir, 'show', `${out.branch}:src/design/targets/enforced.lock.json`));
    assert.deepEqual(lock.enforced, ['BRD-01.base', 'BRD-03.sidebar', 'BRD-02.toast']);
    assert.ok(lock.targets['BRD-03.sidebar'] && lock.targets['BRD-02.toast']);
  });

  it('--resolve settles arbitrary conflicts, and --keep-on-conflict + --continue resumes hand resolution cleanly', () => {
    const { dir } = makePromoteRepo();
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/shared.txt', 'main-line\n');
    write(dir, 'config/list.json', '["main-a"]\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'main edits shared');
    git(dir, 'push', '-q', 'origin', 'main');

    git(dir, 'checkout', '-q', 'oxe/f4-program');
    write(dir, 'src/shared.txt', 'program-line\n');
    write(dir, 'config/list.json', '["prog-b"]\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T9 part 1\n\nOXE-Task: F4/T9');
    const c1 = git(dir, 'rev-parse', 'HEAD');

    write(dir, 'src/part2.js', 'exports.two = 2;\n');
    git(dir, 'add', 'src/part2.js');
    git(dir, 'commit', '-qm', 'feat: T9 part 2\n\nOXE-Task: F4/T9');
    const c2 = git(dir, 'rev-parse', 'HEAD');

    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T9', title: 'multi-commit', wave: 1, files: ['src/shared.txt', 'config/list.json', 'src/part2.js'], acceptance: ['A1'], done: true, done_commit: c2 }],
    }, null, 2));

    // Invalid --resolve fails upfront before modifying branches
    assert.throws(
      () => op.runtimePromote(dir, null, { task: 'T9', base: 'main', resolve: ['src/shared.txt=bogus'] }),
      /estratégia deve ser ours, theirs ou union-json-array/,
    );

    // Non-kept conflict does NOT mislead users with `runtime sync --from ...`
    const aborted = op.runtimePromote(dir, null, { task: 'T9', base: 'main', prReady: false });
    assert.ok(aborted.conflict);
    assert.doesNotMatch(aborted.error, /runtime sync/);
    assert.match(aborted.error, /--resolve .*--keep-on-conflict/);

    // Explicit --resolve solves both conflicts in one shot
    const autoResolved = op.runtimePromote(dir, null, {
      task: 'T9',
      base: 'main',
      branch: 'oxe/promote-t9-resolved',
      resolve: ['src/shared.txt=theirs', 'list.json=union-json-array'],
      prReady: false,
    });
    assert.equal(autoResolved.conflict, null, autoResolved.error);
    assert.equal(git(dir, 'show', 'oxe/promote-t9-resolved:src/shared.txt'), 'program-line');
    assert.deepEqual(JSON.parse(git(dir, 'show', 'oxe/promote-t9-resolved:config/list.json')), ['main-a', 'prog-b']);

    // --keep-on-conflict keeps worktree + branch + pending-conflict.json, protected from stale sweep, then --continue resumes c2
    const paused = op.runtimePromote(dir, null, { task: 'T9', base: 'main', branch: 'oxe/promote-t9-manual', keepOnConflict: true, prReady: false });
    assert.ok(paused.conflict);
    assert.equal(paused.conflict.commit, c1);
    assert.ok(paused.kept_worktree);
    const keptWt = path.join(dir, paused.kept_worktree);
    assert.ok(fs.existsSync(keptWt), 'kept promote worktree remains on disk');
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'promote', 'pending-conflict.json')));
    // Paused worktree must NOT be wiped by sweepStalePromoteWorkspaces
    assert.deepEqual(op.sweepStalePromoteWorkspaces(dir, { minAgeMs: 0 }), []);

    // Hand-resolve conflict inside kept worktree, stage, and resume via `runtime promote --continue` (without even naming T9)
    fs.writeFileSync(path.join(keptWt, 'src/shared.txt'), 'merged-by-hand\n');
    fs.writeFileSync(path.join(keptWt, 'config/list.json'), '["main-a","prog-b"]\n');
    git(keptWt, 'add', 'src/shared.txt', 'config/list.json');

    const contCli = spawnSync(process.execPath, [CLI, 'runtime', 'promote', '--continue', '--json', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_PROMPT: '1' },
    });
    assert.equal(contCli.status, 0, contCli.stderr + contCli.stdout);
    const contOut = JSON.parse(contCli.stdout);
    assert.equal(contOut.conflict, null);
    assert.equal(contOut.resumed_from_conflict, true);
    assert.equal(git(dir, 'show', 'oxe/promote-t9-manual:src/shared.txt'), 'merged-by-hand');
    assert.match(git(dir, 'show', 'oxe/promote-t9-manual:src/part2.js'), /exports\.two = 2/);
    assert.equal(fs.existsSync(keptWt), false, 'worktree cleaned up once promote --continue finishes');
    assert.equal(fs.existsSync(path.join(dir, '.oxe', 'promote', 'pending-conflict.json')), false);
  });
});
