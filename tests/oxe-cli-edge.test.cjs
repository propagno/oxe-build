'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const { isolatedHomeEnv } = require('./isolated-home-env.cjs');

describe('oxe-cc CLI edge', () => {
  test('install --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /oxe-cc|Instalação/i);
  });

  test('uninstall --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('update --dry-run exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /simulação|npx/i);
  });

  test('doctor missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'doctor', path.join(os.tmpdir(), 'oxe-nope-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'status', path.join(os.tmpdir(), 'oxe-nope2-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('init-oxe --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-init-'));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', '--dry-run', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('--config-dir with --all-agents exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--all-agents', '--config-dir', fakeHome, '--oxe-only', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
  });

  test('uninstall unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('install --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dr-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(process.execPath, [CLI, '--dry-run', '--oxe-only', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fakeHome),
    });
    assert.strictEqual(r.status, 0);
  });
});
