import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { resolveWithin, realPathOf, PathContainmentError } from '../src/executor/built-in-tools';

// External review 15/11 (P0-2): resolveWithin compared lexical paths only; a junction or a symlink inside the
// workspace (the runtime links node_modules into worktrees) let a tool reach a file outside it.

describe('path containment through links', () => {
  test('a path through a junction/symlink that leaves the workspace is refused; a plain inner path is not', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-contain-'));
    try {
      const ws = path.join(base, 'ws');
      const outside = path.join(base, 'outside');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
      fs.symlinkSync(outside, path.join(ws, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => resolveWithin(ws, 'link/secret.txt'), PathContainmentError);
      assert.throws(() => resolveWithin(ws, 'link/new-file.txt'), PathContainmentError, 'a new file through the link too');
      assert.equal(resolveWithin(ws, 'src/a.ts'), path.join(ws, 'src', 'a.ts'));
      assert.equal(resolveWithin(ws, 'src/not-yet/b.ts'), path.join(ws, 'src', 'not-yet', 'b.ts'));
      assert.throws(() => resolveWithin(ws, '../outside/secret.txt'), PathContainmentError);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('realPathOf of a path that does not exist yet resolves its nearest existing ancestor', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-realp-'));
    try {
      const real = fs.realpathSync.native(base);
      assert.equal(realPathOf(path.join(base, 'a', 'b.txt')), path.join(real, 'a', 'b.txt'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
