'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-160: `runtime promote T3` (rc.24) died with EISDIR: T3's frozen test imports '../../../shared/types/ipc'
// (a directory with index.ts) and the fixture copier read it as a file; it also followed product modules. And a local
// branch left by an earlier failed promote made the next one refuse.

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-p160-'));
  dirs.push(dir);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'shared/types/ipc/index.ts', 'export type Ipc = 1;\n');
  write(dir, 'electron/main/db/index.ts', 'export const db = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'program');
  write(dir, 'tests/acceptance/f2/t3.test.ts', [
    "import type { Ipc } from '../../../shared/types/ipc';",
    "import { db } from '../../../electron/main/db/index';",
    "import { fx } from './fixtures/t3';",
    "import { help } from '../helpers/h.js';",
    "it('exports', () => {});",
    '',
  ].join('\n'));
  write(dir, 'tests/acceptance/f2/fixtures/t3.ts', 'export const fx = 1;\n');
  write(dir, 'tests/acceptance/helpers/h.ts', 'export const help = 1;\n');
  // the product changes on the program branch too (another task's work): never copied as a "fixture"
  write(dir, 'shared/types/ipc/index.ts', 'export type Ipc = 2;\n');
  g('add', '-A'); g('commit', '-qm', 'test(acceptance): imports');
  write(dir, 'electron/main/export.ts', 'export const x = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'feat: T3 export', '-m', 'OXE-Task: T3');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T3', title: 'export', wave: 1, files: ['electron/main/export.ts'], acceptance: ['A5'], done: true }], acceptance_tests: [{ criterion: 'A5', task: 'T3', files: ['tests/acceptance/f2/t3.test.ts'], command: 'vitest run tests/acceptance/f2/t3.test.ts' }] }));
  return dir;
}

describe('OXB-160: promote fixtures and its own leftover branch', () => {
  it('copies only fixtures/helpers inside the tests tree (dir imports, product modules skipped; .js → .ts resolved)', () => {
    const dir = setup();
    const out = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.frozen_tests.sort(), ['tests/acceptance/f2/fixtures/t3.ts', 'tests/acceptance/f2/t3.test.ts', 'tests/acceptance/helpers/h.ts']);
    assert.equal(git(dir, 'show', 'oxe/promote-t3:shared/types/ipc/index.ts'), 'export type Ipc = 1;', 'product source is not copied from the program tip');
    // the frozen-tests commit carries the task's origin (the commit-msg hook refused it, OxeSpace 14/11)
    const body = git(dir, 'log', '-1', '--format=%B', 'oxe/promote-t3');
    assert.match(body, /^test\(acceptance\): frozen tests of T3/);
    assert.match(body, /^OXE-Task: (F\d+\/)?T3$/m);  });

  it('a test of the task scope re-frozen by a CR quick goes in from the program tip; a verify test of another task is named, not carried (OxeSpace 15/11, F6 T30)', () => {
    const dir = setup();
    const g = (...a) => git(dir, ...a);
    // main has the 1.5.0 u83; the program branch re-froze it (CR quick, no OXE-Task of T3) and changed another test
    g('checkout', '-q', 'main');
    write(dir, 'tests/acceptance/f8/u83.test.ts', "it('old', () => {});\n");
    write(dir, 'tests/unit/other.test.ts', "it('old', () => {});\n");
    g('add', '-A'); g('commit', '-qm', 'u83 1.5.0');
    g('checkout', '-q', 'program');
    g('merge', '-q', '--no-edit', 'main');
    write(dir, 'tests/acceptance/f8/u83.test.ts', "it('new hints', () => {});\n");
    g('add', '-A'); g('commit', '-qm', 'test(quick): re-freeze u83 for CR-F6-5');
    write(dir, 'tests/unit/other.test.ts', "it('changed by T9', () => {});\n");
    g('add', '-A'); g('commit', '-qm', 'test: other changed by T9', '-m', 'OXE-Task: T9');
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    plan.tasks[0].files.push('tests/acceptance/f8/u83.test.ts');
    plan.tasks[0].verify = { commands: ['vitest run tests/acceptance/f8/u83.test.ts tests/unit/other.test.ts'] };
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan));
    const out = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(out.error, undefined, out.error);
    assert.ok(out.frozen_tests.includes('tests/acceptance/f8/u83.test.ts'), JSON.stringify(out.frozen_tests));
    assert.equal(git(dir, 'show', 'oxe/promote-t3:tests/acceptance/f8/u83.test.ts'), "it('new hints', () => {});");
    assert.deepEqual(out.not_carried_tests, ['tests/unit/other.test.ts']);
    assert.ok(out.warnings.some((w) => /tests\/unit\/other\.test\.ts está no verify de T3 e difere de main.*mudado por [0-9a-f]+ test: other changed by T9/.test(w)), out.warnings.join(' | '));
    assert.equal(git(dir, 'show', 'oxe/promote-t3:tests/unit/other.test.ts'), "it('old', () => {});", 'not carried');
  });

  it('a SHARED suite in the task files that another task changed on the program branch is not copied from the tip (cross-review 15/11)', () => {
    const dir = setup();
    const g = (...a) => git(dir, ...a);
    g('checkout', '-q', 'main');
    write(dir, 'tests/shared.test.ts', "it('base', () => {});\n");
    g('add', '-A'); g('commit', '-qm', 'shared base');
    g('checkout', '-q', 'program');
    g('merge', '-q', '--no-edit', 'main');
    write(dir, 'tests/shared.test.ts', "it('base', () => {});\nit('T3 case', () => {});\n");
    g('add', '-A'); g('commit', '-qm', 'feat: T3 shared case', '-m', 'OXE-Task: T3');
    write(dir, 'tests/shared.test.ts', "import { b } from '../src/b';\nit('base', () => {});\nit('T3 case', () => {});\nit('T32 case', () => b());\n");
    g('add', '-A'); g('commit', '-qm', 'feat: T32 shared case', '-m', 'OXE-Task: T32');
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    plan.tasks[0].files.push('tests/shared.test.ts');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan));
    const out = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(out.error, undefined, out.error);
    assert.ok(!out.frozen_tests.includes('tests/shared.test.ts'), JSON.stringify(out.frozen_tests));
    assert.equal(git(dir, 'show', 'oxe/promote-t3:tests/shared.test.ts'), "it('base', () => {});\nit('T3 case', () => {});", 'only what the task cherry-pick brought');
    assert.ok(out.warnings.some((w) => /tests\/shared\.test\.ts está nos files de T3, mas outra tarefa também o mudou/.test(w)), out.warnings.join(' | '));
  });

  it('the dirty worktree of a failed promote (pid gone) never blocks the next one (OxeSpace 14/11)', () => {
    const dir = setup();
    const first = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(first.error, undefined, first.error);
    // what the failed promote left: its worktree holding the branch, an uncommitted file, the pid of a dead process
    const wt = path.join(dir, '.oxe', 'promote-ws', 't3-old');
    git(dir, 'worktree', 'add', '-q', wt, 'oxe/promote-t3');
    fs.writeFileSync(path.join(wt, 'pendente.txt'), 'x\n');
    const dead = require('../bin/lib/oxe-agent-coord.cjs').findGuaranteedDeadPid();
    fs.writeFileSync(`${wt}.pid`, JSON.stringify({ pid: dead, task: 'T3' }));
    const again = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(again.error, undefined, again.error);
    assert.ok(again.replaced_branch);
    assert.ok(again.swept.some((s) => /t3-old$/.test(s)), JSON.stringify(again.swept));
    assert.equal(fs.existsSync(wt), false);
  });

  it('a promote branch left local and unpushed is rebuilt; a branch with other commits is refused', () => {
    const dir = setup();
    const first = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(first.error, undefined, first.error);
    const again = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(again.error, undefined, again.error);
    assert.ok(again.replaced_branch, 'the old local branch was replaced');
    // a branch from rc.24 (no mark) but made only of promote commits is reused too
    git(dir, 'config', '--unset', 'branch.oxe/promote-t3.oxePromote');
    const third = op.runtimePromote(dir, null, { task: 'T3', base: 'main' });
    assert.equal(third.error, undefined, third.error);
    // someone's own branch with that name: refused, untouched
    git(dir, 'branch', '-D', 'oxe/promote-t3');
    git(dir, 'branch', 'oxe/promote-t3', 'main');
    git(dir, 'checkout', '-q', 'oxe/promote-t3');
    write(dir, 'mine.txt', 'x\n');
    git(dir, 'add', 'mine.txt'); git(dir, 'commit', '-qm', 'my work');
    const mine = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', 'program');
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T3', base: 'main' }), /já existe \(tem commits que não são do promote\)/);
    assert.equal(git(dir, 'rev-parse', 'oxe/promote-t3'), mine);
  });
});
