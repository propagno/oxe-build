'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectEnv = require('../../bin/lib/oxe-project-env.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('A9 — OXB-222-09: Workflow discovery docs and doctor --project stripEnvPrefixes leak warning', () => {
  it('OXB-222-09: doctor --project warns when stripEnvPrefixes variables leak into current env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1222-a9-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'env-test', engines: { node: '>=18.0.0' } }));
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      stripEnvPrefixes: ['MYAPP_', 'CUSTOM_SECRET_'],
    }, null, 2));

    // 1. Clean env -> zero leak warnings
    const clean = projectEnv.checkProjectEnvironment(dir, {
      node: '22.0.0',
      env: { PATH: process.env.PATH || '' },
      nativeCheck: false,
    });
    assert.equal(clean.ok, true);
    assert.deepEqual(clean.leaked_env || [], []);
    assert.ok(!clean.warnings.some((w) => /stripEnvPrefixes|MYAPP_/i.test(w)), 'clean env must not emit stripEnvPrefixes warning');

    // 2. Leaked env matching stripEnvPrefixes -> actionable warning + leaked_env list (still non-blocking ok:true)
    const dirty = projectEnv.checkProjectEnvironment(dir, {
      node: '22.0.0',
      env: { PATH: process.env.PATH || '', MYAPP_DB_URL: 'x', CUSTOM_SECRET_KEY: 'y' },
      nativeCheck: false,
    });
    assert.equal(dirty.ok, true);
    assert.ok(Array.isArray(dirty.leaked_env) && dirty.leaked_env.includes('MYAPP_DB_URL') && dirty.leaked_env.includes('CUSTOM_SECRET_KEY'), `must report leaked_env: ${JSON.stringify(dirty.leaked_env)}`);
    assert.ok(dirty.warnings.some((w) => /MYAPP_DB_URL/.test(w) && /stripEnvPrefixes/i.test(w)), `warnings must alert about stripEnvPrefixes leak: ${JSON.stringify(dirty.warnings)}`);
  });

  it('OXB-222-09: canonical workflows and CONFIG.md document v1.22.2 capabilities cleanly', () => {
    const leanExecute = fs.readFileSync(path.join(REPO_ROOT, 'oxe/workflows/lean/execute.md'), 'utf8');
    const shipWf = fs.readFileSync(path.join(REPO_ROOT, 'oxe/workflows/ship.md'), 'utf8');
    const configDoc = fs.readFileSync(path.join(REPO_ROOT, 'oxe/templates/CONFIG.md'), 'utf8');

    assert.match(leanExecute, /plan scope add.*--auto-cr/i, 'lean/execute.md must document plan scope add --auto-cr');
    assert.match(leanExecute, /--full/i, 'lean/execute.md must mention compact JSON default and --full');
    assert.match(shipWf, /--with-ci/i, 'ship.md must document runtime scorecard --with-ci');
    assert.match(shipWf, /oxe-cc sync|version_pins/i, 'ship.md must mention oxe-cc sync / version_pins');
    assert.match(configDoc, /version_pins/i, 'CONFIG.md must document sync.version_pins');
    assert.match(configDoc, /allow_no_alm_quick/i, 'CONFIG.md must document origin.allow_no_alm_quick');
    assert.match(configDoc, /phase_gates[\s\S]*paths|paths.*globs/i, 'CONFIG.md must document path-aware phase_gates');
    assert.match(configDoc, /grill promote|grill import/i, 'CONFIG.md must document grill promote / grill import');
  });
});
