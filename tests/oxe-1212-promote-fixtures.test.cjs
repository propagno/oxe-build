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
