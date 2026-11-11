'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-169 (TECH LEAD, F2 on rc.29): the checkpoint retry committed T4/T5 AFTER T6/T7; `promote T4` on
// oxe/f2-t3 conflicted on tests/integration/fs-allowlist.test.ts — T4's diff assumed T6/T7's allowlist removals.
// Cherry-picking the four in commit order applied cleanly (PR #727).

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-p169-'));
  dirs.push(dir);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'tests/fs-allowlist.txt', 'keep\nrtk\ndocumentation\npreview\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'program');
  // T2 (plan: after T1) is committed FIRST: removes rtk + documentation
  write(dir, 'tests/fs-allowlist.txt', 'keep\npreview\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T2 remove rtk/doc', '-m', 'OXE-Task: F2/T2');
  const t2 = g('rev-parse', 'HEAD');
  // T1 (checkpoint retried later) edits the same lines, on top of T2
  write(dir, 'tests/fs-allowlist.txt', 'keep\n');
  write(dir, 'src/preview.js', 'gone\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T1 remove preview', '-m', 'OXE-Task: F2/T1');
  const t1 = g('rev-parse', 'HEAD');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [
    { id: 'T1', title: 'remove preview', wave: 1, files: ['tests/fs-allowlist.txt', 'src/preview.js'], done: true, done_commit: t1, verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'remove rtk/doc', wave: 2, depends_on: ['T1'], files: ['tests/fs-allowlist.txt'], done: true, done_commit: t2, verify: { commands: ['node -e 0'] } },
  ] }));
  return { dir, t1, t2 };
}

describe('OXB-169: promote in commit order', () => {
  it('T1 alone conflicts and the warning/error name T2 and the combined promote', () => {
    const { dir } = setup();
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main', prReady: false });
    assert.ok(out.conflict, 'T1 alone cannot apply: its diff assumes T2');
    assert.match(out.warnings.join('\n'), /T1 vem depois de T2 .* --tasks T2,T1/);
    assert.match(out.error, /promova junto \(--tasks T2,T1\)/);
  });

  it('--tasks T1,T2 builds ONE branch with both, in commit order, with no conflict', () => {
    const { dir, t1, t2 } = setup();
    const out = op.runtimePromote(dir, null, { tasks: 'T1,T2', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.conflict, null);
    assert.deepEqual(out.commits, [t2, t1], 'commit order, not plan order');
    assert.equal(out.branch, 'oxe/promote-t1-t2');
    assert.equal(git(dir, 'show', 'oxe/promote-t1-t2:tests/fs-allowlist.txt'), 'keep');
    const body = fs.readFileSync(path.join(dir, out.body_file), 'utf8');
    assert.match(body, /T1 remove preview · T2 remove rtk\/doc/);
  });

  it('plan lint warns when a task was committed before a task it depends on', () => {
    const { dir } = setup();
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.warnings.some((w) => /T2 depende de T1, mas o commit de T2 .* veio antes do de T1 .* --tasks T1,T2/.test(w)), lint.warnings.join('\n'));
  });
});
