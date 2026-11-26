import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { resolveWithin, realPathOf, samePathKey, PathContainmentError, BUILT_IN_TOOLS } from '../src/executor/built-in-tools';

// Cross-review 15/11: a DANGLING link (target not created yet) failed realpath; realPathOf climbed past it and
// answered "inside the workspace" while the write followed the link out. Glob/grep never walk into links.

function tmp(prefix: string) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

describe('path containment: dangling links, case, walkers', () => {
  test('a dangling junction/dir link to outside is refused, and nothing is created outside', async () => {
    const base = tmp('oxe-dangle-');
    try {
      const ws = path.join(base, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      const target = path.join(base, 'outside-not-yet');
      fs.symlinkSync(target, path.join(ws, 'out'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => resolveWithin(ws, 'out/pwned.txt'), PathContainmentError);
      assert.equal(path.relative(samePathKey(realPathOf(path.join(ws, 'out', 'pwned.txt'))), samePathKey(path.join(fs.realpathSync.native(base), 'outside-not-yet', 'pwned.txt'))), '');
      const r = await BUILT_IN_TOOLS.write_file.execute({ path: 'out/pwned.txt', content: 'x' }, ws).catch((e: Error) => `[err] ${e.message}`);
      assert.ok(!fs.existsSync(path.join(target, 'pwned.txt')), `nothing written outside (${String(r).slice(0, 80)})`);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('a dangling file symlink to outside is refused (skipped where symlinks need privileges)', (t) => {
    const base = tmp('oxe-dangle-f-');
    try {
      const ws = path.join(base, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      try { fs.symlinkSync(path.join(base, 'pwned.txt'), path.join(ws, 'out-link'), 'file'); } catch { t.skip('no symlink privilege'); return; }
      assert.throws(() => resolveWithin(ws, 'out-link'), PathContainmentError);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('a link loop does not hang', (t) => {
    const base = tmp('oxe-loop-');
    try {
      try { fs.symlinkSync(path.join(base, 'b'), path.join(base, 'a'), 'file'); fs.symlinkSync(path.join(base, 'a'), path.join(base, 'b'), 'file'); } catch { t.skip('no symlink privilege'); return; }
      assert.throws(() => resolveWithin(base, 'a'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('samePathKey folds case only on case-insensitive platforms', () => {
    const k = samePathKey('C:/Src/A.TS');
    if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(k, 'c:/src/a.ts');
    else assert.equal(k, 'C:/Src/A.TS');
  });

  test('glob and grep do not walk into a link that leaves the workspace', async () => {
    const base = tmp('oxe-walk-');
    try {
      const ws = path.join(base, 'ws');
      const outside = path.join(base, 'outside');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(ws, 'src', 'in.txt'), 'needle inside');
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'needle outside');
      fs.symlinkSync(outside, path.join(ws, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const g = await BUILT_IN_TOOLS.grep.execute({ pattern: 'needle' }, ws);
      assert.match(String(g), /in\.txt/);
      assert.doesNotMatch(String(g), /secret/);
      const gl = await BUILT_IN_TOOLS.glob.execute({ pattern: '**/*.txt' }, ws);
      assert.match(String(gl), /src\/in\.txt/);
      assert.doesNotMatch(String(gl), /secret/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
