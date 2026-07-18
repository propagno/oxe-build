'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const sdk = require('../lib/sdk/index.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');

function makeOxeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-summary-'));
  const oxe = path.join(dir, '.oxe');
  fs.mkdirSync(oxe, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE STATE\n\nphase: plan\n', 'utf8');
  fs.writeFileSync(path.join(oxe, 'config.json'), '{}', 'utf8');
  return dir;
}

describe('oxe status --summary', () => {
  test('buildStatusSummary projects a small, versioned object', () => {
    const report = health.buildHealthReport(makeOxeProject());
    const summary = health.buildStatusSummary(report);
    assert.strictEqual(summary.oxeSummarySchema, 1);
    for (const key of ['workspaceMode', 'phase', 'healthStatus', 'activeSession', 'nextStep', 'cursorCmd', 'reason', 'eventsCount', 'warningsCount']) {
      assert.ok(key in summary, `summary missing ${key}`);
    }
    assert.strictEqual(typeof summary.eventsCount, 'number');
    assert.strictEqual(typeof summary.warningsCount, 'number');
  });

  test('SDK re-exports buildStatusSummary and agentSkillsReport under health', () => {
    assert.strictEqual(typeof sdk.health.buildStatusSummary, 'function');
    assert.strictEqual(typeof sdk.health.agentSkillsReport, 'function');
  });

  test('agentSkillsReport returns the known agents with boolean skillsInstalled', () => {
    const agents = health.agentSkillsReport(makeOxeProject());
    const names = agents.map((a) => a.agent);
    for (const expected of ['copilot-vscode', 'codex', 'copilot-cli']) {
      assert.ok(names.includes(expected), `missing agent ${expected}`);
    }
    for (const a of agents) {
      assert.strictEqual(typeof a.skillsInstalled, 'boolean');
      assert.ok(Array.isArray(a.issues));
    }
  });

  test('CLI status --json --summary is small and parseable', () => {
    const dir = makeOxeProject();
    const out = execFileSync(process.execPath, [BIN, 'status', '--json', '--summary', '--dir', dir], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.oxeSummarySchema, 1);
    assert.ok(Array.isArray(parsed.agentSkills));
    // Summary must stay tiny vs the full status payload.
    const full = execFileSync(process.execPath, [BIN, 'status', '--json', '--dir', dir], { encoding: 'utf8' });
    assert.ok(out.length < full.length, 'summary should be smaller than full status');
    assert.ok(out.length < 4096, `summary unexpectedly large: ${out.length} bytes`);
  });
});
