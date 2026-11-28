'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A10 — Strangler Fig Fatia 3 (D-6): plan-lint-runtime & status-doctor-commands (OXB-230-10)', () => {
  it('OXB-230-10: extracts bin/lib/operational/plan-lint-runtime.cjs and bin/lib/commands/status-doctor-commands.cjs reducing monolith sizes without cycles or SDK drift', () => {
    const planLintPath = path.join(REPO_ROOT, 'bin/lib/operational/plan-lint-runtime.cjs');
    const statusDocPath = path.join(REPO_ROOT, 'bin/lib/commands/status-doctor-commands.cjs');
    const opPath = path.join(REPO_ROOT, 'bin/lib/oxe-operational.cjs');
    const cliPath = path.join(REPO_ROOT, 'bin/oxe-cc.js');

    assert.ok(fs.existsSync(planLintPath), 'bin/lib/operational/plan-lint-runtime.cjs must exist');
    assert.ok(fs.existsSync(statusDocPath), 'bin/lib/commands/status-doctor-commands.cjs must exist');

    // Zero circular requires back to monoliths
    const planLintSrc = fs.readFileSync(planLintPath, 'utf8');
    const statusDocSrc = fs.readFileSync(statusDocPath, 'utf8');
    assert.doesNotMatch(planLintSrc, /require\(['"][^'"]*oxe-operational\.cjs['"]\)/, 'plan-lint-runtime.cjs must not circularly require oxe-operational.cjs');
    assert.doesNotMatch(statusDocSrc, /require\(['"][^'"]*oxe-cc\.js['"]\)/, 'status-doctor-commands.cjs must not circularly require bin/oxe-cc.js');

    const planLintMod = require(planLintPath);
    const statusDocMod = require(statusDocPath);
    assert.equal(typeof planLintMod.createPlanLintRuntime, 'function');
    assert.equal(typeof statusDocMod.createStatusDoctorHandlers, 'function');

    // Line-count reduction gates:
    // Pre-Slice 3 baselines: oxe-operational.cjs = 14,556 lines (>= 800 reduced => <= 13,756),
    // bin/oxe-cc.js = 10,064 lines (>= 400 reduced => <= 9,664).
    const opLines = fs.readFileSync(opPath, 'utf8').split(/\r?\n/).length;
    const cliLines = fs.readFileSync(cliPath, 'utf8').split(/\r?\n/).length;
    assert.ok(opLines <= 13756, `oxe-operational.cjs must be reduced by >= 800 lines (<= 13756), got ${opLines}`);
    assert.ok(cliLines <= 9664, `bin/oxe-cc.js must be reduced by >= 400 lines (<= 9664), got ${cliLines}`);

    // Facade preserves key operational exports
    const op = require(opPath);
    for (const fn of ['runtimePlanLint', 'runtimePlanScopeAdd', 'runtimePlanTaskEdit', 'runtimePlanTaskFold', 'runtimePlanReopen', 'runtimePlanPackFix']) {
      assert.equal(typeof op[fn], 'function', `oxe-operational.cjs facade must keep export ${fn}`);
    }

    // Zero SDK type drift (scripts/generate-sdk-types.cjs --check)
    const sdkGen = require(path.join(REPO_ROOT, 'scripts/generate-sdk-types.cjs'));
    assert.doesNotThrow(() => sdkGen.generate({ check: true }), 'SDK types must have 0 drift after Slice 3');
  });
});
