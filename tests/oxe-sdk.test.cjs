'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const sdk = require('../lib/sdk/index.cjs');

describe('oxe-sdk', () => {
  test('exports version and name', () => {
    assert.match(sdk.version, /^\d+\.\d+\.\d+/);
    assert.strictEqual(sdk.name, 'oxe-cc');
  });

  test('workflows.resolveWorkflowsDir prefers .oxe/workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-wf-'));
    const nested = path.join(dir, '.oxe', 'workflows');
    const legacy = path.join(dir, 'oxe', 'workflows');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(nested, 'a.md'), 'x', 'utf8');
    assert.strictEqual(sdk.workflows.resolveWorkflowsDir(dir), nested);
  });

  test('workflows.diffWorkflows detects missing files', () => {
    const exp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-e-'));
    const act = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-a-'));
    fs.writeFileSync(path.join(exp, 'one.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(exp, 'two.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(act, 'one.md'), 'x', 'utf8');
    const d = sdk.workflows.diffWorkflows(exp, act);
    assert.strictEqual(d.ok, false);
    assert.deepStrictEqual(d.missing, ['two.md']);
  });

  test('install.resolveOptionsFromConfig applies core profile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-i-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ install: { profile: 'core', repo_layout: 'nested' } }),
      'utf8'
    );
    const base = {
      ignoreInstallConfig: false,
      explicitScope: false,
      oxeOnly: false,
      integrationsUnset: true,
      installAssetsGlobal: false,
      vscode: false,
      cursor: false,
      copilot: false,
    };
    const { options, warnings } = sdk.install.resolveOptionsFromConfig(dir, base);
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(options.cursor, false);
    assert.strictEqual(options.integrationsUnset, false);
    assert.strictEqual(options.commands, false);
  });

  test('runDoctorChecks ok after oxe-only install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-d-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    const r = spawnSync(process.execPath, [CLI, '--oxe-only', dir], {
      cwd: REPO_ROOT,
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 0);
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.strictEqual(check.ok, true, JSON.stringify(check.errors));
    assert.strictEqual(check.errors.length, 0);
    assert.ok(check.workflowDiff && check.workflowDiff.ok);
    assert.ok(check.workflowShape);
    assert.strictEqual(check.workflowShape.warnings.length, 0, JSON.stringify(check.workflowShape.warnings));
  });

  test('runDoctorChecks omits workflowShape when includeWorkflowLint is false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-d2-'));
    const { spawnSync } = require('child_process');
    const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
    const r = spawnSync(process.execPath, [CLI, '--oxe-only', dir], {
      cwd: REPO_ROOT,
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 0);
    const check = sdk.runDoctorChecks({
      projectRoot: dir,
      packageRoot: REPO_ROOT,
      includeWorkflowLint: false,
    });
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.workflowShape, null);
  });

  test('workflows.validateWorkflowShapes warns when objective missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-shape-'));
    fs.writeFileSync(path.join(dir, 'bad.md'), '# Bad\n\nSem tags.\n', 'utf8');
    const r = sdk.workflows.validateWorkflowShapes(dir);
    assert.ok(r.warnings.length >= 1);
    assert.ok(r.warnings.some((w) => w.code === 'WORKFLOW_SHAPE' && /objective/i.test(w.message)));
  });

  test('workflows.validateWorkflowShapes clean for package oxe/workflows', () => {
    const wfDir = path.join(REPO_ROOT, 'oxe', 'workflows');
    const r = sdk.workflows.validateWorkflowShapes(wfDir);
    assert.strictEqual(r.warnings.length, 0, JSON.stringify(r.warnings));
  });

  test('runDoctorChecks fails without workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-empty-'));
    const check = sdk.runDoctorChecks({ projectRoot: dir, packageRoot: REPO_ROOT });
    assert.strictEqual(check.ok, false);
    assert.ok(check.errors.some((e) => e.code === 'PROJECT_WORKFLOWS_MISSING'));
  });

  test('health.validateConfigShape re-export', () => {
    const { typeErrors } = sdk.health.validateConfigShape({ install: { profile: 'bad' } });
    assert.ok(typeErrors.length >= 1);
  });

  // parseState — blueprint e loop fields (P1.1)
  test('parseState extracts runId from STATE.md blueprint section', () => {
    const state = '## Fase atual\n\n`executing`\n\n## Blueprint de agentes (sessão)\n\n- **run_id:** oxe-test-abc123\n- **lifecycle_status:** executing\n';
    const parsed = sdk.parseState(state);
    assert.strictEqual(parsed.runId, 'oxe-test-abc123');
  });

  test('parseState extracts lifecycleStatus from STATE.md', () => {
    const state = '## Blueprint de agentes (sessão)\n\n- **run_id:** oxe-run-xyz\n- **lifecycle_status:** closed\n';
    const parsed = sdk.parseState(state);
    assert.strictEqual(parsed.lifecycleStatus, 'closed');
  });

  test('parseState returns null runId/lifecycleStatus when absent', () => {
    const state = '## Fase atual\n\n`plan_ready`\n';
    const parsed = sdk.parseState(state);
    assert.strictEqual(parsed.runId, null);
    assert.strictEqual(parsed.lifecycleStatus, null);
  });

  test('parseState extracts loopStatus from STATE.md', () => {
    const state = '## Loop (sessão)\n\n- **loop_onda:** 2\n- **loop_iteracao:** 2/3\n- **loop_status:** retrying\n';
    const parsed = sdk.parseState(state);
    assert.strictEqual(parsed.loopStatus, 'retrying');
  });

  test('parseState returns null loopStatus when absent', () => {
    const state = '## Fase atual\n\n`executing`\n';
    const parsed = sdk.parseState(state);
    assert.strictEqual(parsed.loopStatus, null);
  });

  // staleLessons in buildHealthReport (P2.1)
  test('buildHealthReport returns staleLessons with stale and days fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-lessons-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`verify_complete`\n', 'utf8');
    const report = sdk.health.buildHealthReport(dir);
    assert.ok(typeof report.staleLessons === 'object', 'staleLessons deve ser objeto');
    assert.ok(typeof report.staleLessons.stale === 'boolean');
    assert.ok(report.staleLessons.days === null || typeof report.staleLessons.days === 'number');
  });
});
