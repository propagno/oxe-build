import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { BUILT_IN_TOOLS, resolveWithin, PathContainmentError } from '../src/executor/built-in-tools';

describe('built-in tools — contenção de caminhos ao workspace', () => {
  let outer: string;
  let workspace: string;

  test('setup', () => {
    outer = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-contain-'));
    workspace = path.join(outer, 'ws');
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'a.txt'), 'hello\n', 'utf8');
    fs.writeFileSync(path.join(outer, 'secret.txt'), 'top secret\n', 'utf8');
  });

  test('resolveWithin aceita caminhos relativos dentro do workspace e recusa escapes', () => {
    assert.equal(resolveWithin(workspace, 'src/a.txt'), path.join(workspace, 'src', 'a.txt'));
    assert.equal(resolveWithin(workspace, '.'), path.resolve(workspace));
    assert.throws(() => resolveWithin(workspace, '../secret.txt'), PathContainmentError);
    assert.throws(() => resolveWithin(workspace, path.join(outer, 'secret.txt')), PathContainmentError);
  });

  test('read_file não lê fora do workspace', async () => {
    await assert.rejects(() => BUILT_IN_TOOLS.read_file.execute({ path: '../secret.txt' }, workspace), PathContainmentError);
    assert.equal(await BUILT_IN_TOOLS.read_file.execute({ path: 'src/a.txt' }, workspace), 'hello\n');
  });

  test('write_file e patch_file não escrevem fora do workspace', async () => {
    await assert.rejects(
      () => BUILT_IN_TOOLS.write_file.execute({ path: '../escaped.txt', content: 'x' }, workspace),
      PathContainmentError
    );
    assert.equal(fs.existsSync(path.join(outer, 'escaped.txt')), false);
    await assert.rejects(
      () => BUILT_IN_TOOLS.patch_file.execute({ path: '../secret.txt', old_string: 'top', new_string: 'no' }, workspace),
      PathContainmentError
    );
    assert.equal(fs.readFileSync(path.join(outer, 'secret.txt'), 'utf8'), 'top secret\n');
  });

  test('grep e glob não saem do workspace', async () => {
    await assert.rejects(() => BUILT_IN_TOOLS.grep.execute({ pattern: 'secret', path: '..' }, workspace), PathContainmentError);
    assert.equal(await BUILT_IN_TOOLS.glob.execute({ pattern: '../*.txt' }, workspace), '(no files matched)');
    assert.equal(await BUILT_IN_TOOLS.glob.execute({ pattern: 'src/*.txt' }, workspace), 'src/a.txt');
  });

  test('teardown', () => {
    fs.rmSync(outer, { recursive: true, force: true });
  });
});
