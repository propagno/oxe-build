'use strict';

// 1.21.2 (G36): a task whose attempt was rolled back only because its frozen test was wrong re-applies that attempt
// after the CR fixed the test — verify, commit, no model turns (OxeChat F2 T5/T6, ~US$ 25 each).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content, 'utf8'); };

function setup(verifyNeedle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-reuse-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false }));
  write(dir, 'src/terminal.ts', 'a\n');
  write(dir, 'check.js', `const t = require('fs').readFileSync('src/terminal.ts', 'utf8'); process.exit(t.includes(${JSON.stringify(verifyNeedle)}) && require('fs').existsSync('src/new.ts') ? 0 : 1);\n`);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [
    { id: 'T6', title: 'aviso de notificação', wave: 1, files: ['src/terminal.ts', 'src/new.ts'], acceptance: ['A6'], verify: { commands: ['node check.js'] } },
  ] }, null, 2));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@oxe.dev');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  // what the rolled-back attempt left saved: the tracked diff as a patch, the new file as a copy (OXB-051)
  write(dir, 'src/terminal.ts', 'a\nb\n');
  const failed = path.join(dir, '.oxe', 'runs', 'oxe-run-1', 'attempts', 'T6-failed');
  write(dir, path.relative(dir, path.join(failed, 'changes.patch')), git(dir, 'diff', 'HEAD', '--', 'src/terminal.ts').stdout);
  git(dir, 'checkout', 'HEAD', '--', 'src/terminal.ts');
  write(dir, path.relative(dir, path.join(failed, 'new', 'src', 'new.ts')), 'export const x = 1;\n');
  return dir;
}

describe('G36: runtime retry T<n> --reuse-attempt', () => {
  it('re-applies the rolled-back attempt, verify green, commits it as the task checkpoint', () => {
    const dir = setup('b');
    const out = op.runtimeReuseAttempt(dir, null, { task: 'T6' });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(out.reused_from, /oxe-run-1\/attempts\/T6-failed$/);
    const body = git(dir, 'log', '-1', '--format=%B').stdout;
    assert.match(body, /OXE-Task: F2\/T6/);
    assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort(), ['src/new.ts', 'src/terminal.ts']);
    assert.equal(git(dir, 'status', '--porcelain', '--', 'src').stdout.trim(), '');
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.ok(plan.tasks[0].done_commit);
    assert.equal(op.readEvents(dir, null).filter((e) => e.type === 'AttemptReused').length, 1);
  });

  it('verify red: everything applied is undone and the task goes to a normal attempt', () => {
    const dir = setup('c');
    assert.throws(() => op.runtimeReuseAttempt(dir, null, { task: 'T6' }), /não passou[\s\S]*tentativa normal/);
    assert.equal(git(dir, 'status', '--porcelain', '--', 'src').stdout.trim(), '', 'nothing left in the tree');
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'terminal.ts'), 'utf8').replace(/\r\n/g, '\n'), 'a\n');
    assert.equal(op.readEvents(dir, null).filter((e) => e.type === 'AttemptReuseFailed').length, 1);
  });

  it('no saved attempt, or the attempt files dirty in the tree: refused before touching anything', () => {
    const dir = setup('b');
    assert.throws(() => op.runtimeReuseAttempt(dir, null, { task: 'T9' }), /nenhuma tentativa revertida de T9/);
    write(dir, 'src/terminal.ts', 'a\nlocal\n');
    assert.throws(() => op.runtimeReuseAttempt(dir, null, { task: 'T6' }), /com mudanças na árvore/);
  });
});
