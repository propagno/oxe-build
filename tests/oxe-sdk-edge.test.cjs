'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const sdk = require('../lib/sdk/index.cjs');

describe('oxe-sdk edge', () => {
  test('readPackageMeta bad json falls back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-pkg-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{', 'utf8');
    const m = sdk.readPackageMeta(dir);
    assert.strictEqual(m.version, '0.0.0');
  });

  test('readMinNode without engines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-pkg-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    assert.strictEqual(sdk.readMinNode(dir), 18);
  });

  test('runDoctorChecks NODE_VERSION error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-d-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    assert.strictEqual(spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' } }).status, 0);
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT, nodeMajor: 8 });
    assert.strictEqual(check.ok, false);
    assert.ok(check.errors.some((e) => e.code === 'NODE_VERSION'));
  });

  test('runDoctorChecks PACKAGE_WORKFLOWS_MISSING', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-pkg-miss-'));
    const check = sdk.runDoctorChecks({
      projectRoot: dir,
      packageRoot: path.join(dir, 'empty-pkg'),
    });
    assert.ok(check.errors.some((e) => e.code === 'PACKAGE_WORKFLOWS_MISSING'));
  });

  test('runDoctorChecks config parseError and unknown keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-cfg-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], {
        cwd: REPO_ROOT,
        env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
      }).status,
      0
    );
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{', 'utf8');
    let check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.ok(check.errors.some((e) => e.code === 'CONFIG_JSON_INVALID'));

    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ foo_bar_unknown: true, discuss_before_plan: false }),
      'utf8'
    );
    check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.ok(check.warnings.some((w) => w.code === 'CONFIG_UNKNOWN_KEYS'));
  });
});
