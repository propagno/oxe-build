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

  test('readMinNode engines.node without >= digit pattern returns 18', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-eng-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', engines: { node: 'lts/*' } }),
      'utf8'
    );
    assert.strictEqual(sdk.readMinNode(dir), 18);
  });

  test('readMinNode parses engines.node with >= major', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-eng2-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', engines: { node: '>= 20.0.0' } }),
      'utf8'
    );
    assert.strictEqual(sdk.readMinNode(dir), 20);
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

  test('runDoctorChecks WORKFLOW_DRIFT when project misses packaged workflow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-drift-'));
    const wf = path.join(dir, '.oxe', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'scan.md'), 'x', 'utf8');
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.strictEqual(check.ok, false);
    assert.ok(check.errors.some((e) => e.code === 'WORKFLOW_DRIFT'));
  });

  test('runDoctorChecks WORKFLOW_EXTRA warns on extra project workflows', () => {
    const pkgWf = path.join(REPO_ROOT, 'oxe', 'workflows');
    const files = fs.readdirSync(pkgWf).filter((f) => f.endsWith('.md'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-extra-'));
    const wf = path.join(dir, '.oxe', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    for (const f of files) {
      fs.copyFileSync(path.join(pkgWf, f), path.join(wf, f));
    }
    fs.writeFileSync(
      path.join(wf, 'extra-oxe-workflow.md'),
      '<objective>x</objective>\n<success_criteria></success_criteria>\n',
      'utf8'
    );
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.strictEqual(check.ok, true);
    assert.ok(check.warnings.some((w) => w.code === 'WORKFLOW_EXTRA'));
  });

  test('runDoctorChecks forwards workflowShape warnings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-shape-doc-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], {
        cwd: REPO_ROOT,
        env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
      }).status,
      0
    );
    fs.writeFileSync(path.join(dir, '.oxe', 'workflows', 'bad.md'), '# no tags\n', 'utf8');
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.ok(check.warnings.some((w) => w.code === 'WORKFLOW_SHAPE'));
  });

  test('runDoctorChecks applies workflowLintOptions to shape validator', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-lint-opt-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], {
        cwd: REPO_ROOT,
        env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
      }).status,
      0
    );
    const check = sdk.runDoctorChecks({
      projectRoot: dir,
      packageRoot: REPO_ROOT,
      workflowLintOptions: { maxBytesSoft: 1 },
    });
    assert.ok(check.workflowShape);
    assert.ok(check.workflowShape.warnings.some((w) => /grande|bytes/i.test(w.message)));
  });
});
