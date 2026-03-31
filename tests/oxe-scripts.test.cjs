'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

describe('scripts', () => {
  test('oxe-assets-scan exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'oxe-assets-scan.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });

  test('sync-cursor-from-prompts exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
  });

  test('sync-cursor-from-prompts fails without .github/prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-'));
    const fakeScript = path.join(dir, 'sync.cjs');
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs'), fakeScript);
    const r = spawnSync(process.execPath, [fakeScript], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /prompts ausente/i);
  });
});
