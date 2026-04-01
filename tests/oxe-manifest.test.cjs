'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const manifest = require('../bin/lib/oxe-manifest.cjs');

describe('oxe-manifest', () => {
  test('loadFileManifest empty when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    assert.deepStrictEqual(manifest.loadFileManifest(dir), {});
  });

  test('loadFileManifest invalid JSON returns {}', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const d = path.join(dir, manifest.MANIFEST_DIR);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), '{', 'utf8');
    assert.deepStrictEqual(manifest.loadFileManifest(dir), {});
  });

  test('loadFileManifest missing files object', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const d = path.join(dir, manifest.MANIFEST_DIR);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ version: '1' }), 'utf8');
    assert.deepStrictEqual(manifest.loadFileManifest(dir), {});
  });

  test('writeFileManifest roundtrip', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const files = { '/x/a': 'deadbeef' };
    manifest.writeFileManifest(dir, files, '0.1.0');
    const back = manifest.loadFileManifest(dir);
    assert.strictEqual(back['/x/a'], 'deadbeef');
  });

  test('backupModifiedFromManifest copies diverged files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const f = path.join(home, 'oxe-scan.md');
    fs.writeFileSync(f, 'v1', 'utf8');
    const prev = { [f]: manifest.sha256File(f) };
    fs.writeFileSync(f, 'v2', 'utf8');
    const colors = { yellow: '', cyan: '', dim: '', reset: '' };
    const mod = manifest.backupModifiedFromManifest(home, prev, { force: true, dryRun: false }, colors);
    assert.strictEqual(mod.length, 1);
    const patches = fs.readdirSync(path.join(home, manifest.MANIFEST_DIR, manifest.PATCHES_DIR));
    assert.strictEqual(patches.length, 1);
  });

  test('backupModifiedFromManifest no-op without force or dryRun', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    assert.deepStrictEqual(
      manifest.backupModifiedFromManifest(home, {}, { force: false, dryRun: false }, {}),
      []
    );
    assert.deepStrictEqual(
      manifest.backupModifiedFromManifest(home, {}, { force: true, dryRun: true }, {}),
      []
    );
  });

  test('backupModifiedFromManifest skips unreadable hash', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const prev = { [path.join(home, 'nope.txt')]: 'abc' };
    assert.deepStrictEqual(
      manifest.backupModifiedFromManifest(home, prev, { force: true, dryRun: false }, {
        yellow: '',
        cyan: '',
        dim: '',
        reset: '',
      }),
      []
    );
  });

  test('backupModifiedFromManifest skips path when sha256 throws', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    const dirPath = path.join(home, 'is-dir');
    fs.mkdirSync(dirPath);
    const prev = { [dirPath]: 'deadbeef' };
    const colors = { yellow: '', cyan: '', dim: '', reset: '' };
    assert.deepStrictEqual(
      manifest.backupModifiedFromManifest(home, prev, { force: true, dryRun: false }, colors),
      []
    );
  });

  test('collectFilesRecursive filters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mf-'));
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'x', 'utf8');
    const got = manifest.collectFilesRecursive(dir, (n) => n.endsWith('.md'));
    assert.strictEqual(got.length, 1);
    assert.ok(got[0].endsWith('a.md'));
  });

  test('collectFilesRecursive missing dir', () => {
    assert.deepStrictEqual(manifest.collectFilesRecursive('/nonexistent-oxe-xyz', () => true), []);
  });

  test('sha256File', () => {
    const f = path.join(os.tmpdir(), `oxe-sha-${Date.now()}.txt`);
    fs.writeFileSync(f, 'test', 'utf8');
    try {
      const h = manifest.sha256File(f);
      assert.strictEqual(typeof h, 'string');
      assert.strictEqual(h.length, 64);
    } finally {
      fs.unlinkSync(f);
    }
  });
});
