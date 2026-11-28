'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

function findEmptyDirs(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0) {
      out.push(path.relative(rootDir, dir).replace(/\\/g, '/') || '.');
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(rootDir);
  return out;
}

describe('A20 — Zero mkdirSync ansioso: 0 pastas vazias em install, init-oxe e leituras read-only (OXB-230-20)', () => {
  it('OXB-230-20: oxe-cc init-oxe, install, capabilities list and read-only health/operational/dashboard calls create zero empty dirs in .oxe/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a20-lazy-'));
    try {
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;

      const run = (args) => {
        const res = spawnSync(process.execPath, [CLI, ...args], {
          cwd: REPO_ROOT,
          env: childEnv,
          encoding: 'utf8',
          windowsHide: true,
        });
        assert.equal(res.status, 0, `comando falhou: oxe-cc ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
      };

      run(['init-oxe', '--dir', tmp]);
      assert.deepEqual(findEmptyDirs(path.join(tmp, '.oxe')), [], 'init-oxe não deve criar pastas vazias');

      run(['install', '--dir', tmp, '--ide-local', '--force']);
      assert.deepEqual(findEmptyDirs(path.join(tmp, '.oxe')), [], 'install não deve criar pastas vazias');

      // Read-only CLI commands including `capabilities list` must NOT eagerly create empty dirs
      run(['capabilities', 'list', '--dir', tmp]);
      run(['status', '--dir', tmp, '--json']);
      run(['doctor', '--dir', tmp, '--json']);
      run(['onboard', '--dir', tmp, '--json']);
      run(['primer', '--dir', tmp, '--json']);
      run(['map', '--dir', tmp, '--json']);

      const emptyAfterCli = findEmptyDirs(path.join(tmp, '.oxe'));
      assert.deepEqual(emptyAfterCli, [], `comandos read-only não devem criar pastas vazias, encontrou: ${JSON.stringify(emptyAfterCli)}`);

      // Read-only library APIs in health, operational and dashboard
      const health = require(path.join(REPO_ROOT, 'bin/lib/oxe-project-health.cjs'));
      const operational = require(path.join(REPO_ROOT, 'bin/lib/oxe-operational.cjs'));
      const dashboard = require(path.join(REPO_ROOT, 'bin/lib/oxe-dashboard.cjs'));

      health.buildHealthReport(tmp);
      operational.readCapabilityCatalog(tmp);
      operational.buildMemoryLayers(tmp, null);
      operational.readRuntimeGates(tmp, null);
      operational.runtimeProgramStatus(tmp, null);
      dashboard.loadDashboardContext(tmp);

      const emptyAfterApis = findEmptyDirs(path.join(tmp, '.oxe'));
      assert.deepEqual(emptyAfterApis, [], `APIs read-only de health/operational/dashboard não devem criar pastas vazias, encontrou: ${JSON.stringify(emptyAfterApis)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
