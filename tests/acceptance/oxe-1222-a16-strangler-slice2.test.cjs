'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

describe('A16 — Decomposição Strangler Fig Fatia 2 (ADR D-6) (OXB-222-16)', () => {
  it('OXB-222-16: extracts promote-runtime.cjs and spec-program-commands.cjs shrinking monoliths with zero circular requires and full SDK parity', () => {
    const promoteModPath = path.join(ROOT, 'bin', 'lib', 'operational', 'promote-runtime.cjs');
    const specCmdModPath = path.join(ROOT, 'bin', 'lib', 'commands', 'spec-program-commands.cjs');
    assert.equal(fs.existsSync(promoteModPath), true, 'bin/lib/operational/promote-runtime.cjs must exist');
    assert.equal(fs.existsSync(specCmdModPath), true, 'bin/lib/commands/spec-program-commands.cjs must exist');

    const promoteSrc = fs.readFileSync(promoteModPath, 'utf8');
    const specCmdSrc = fs.readFileSync(specCmdModPath, 'utf8');
    assert.equal(/oxe-operational\.cjs/.test(promoteSrc), false, 'promote-runtime.cjs must not circular-require oxe-operational.cjs');
    assert.equal(/oxe-cc\.js/.test(specCmdSrc), false, 'spec-program-commands.cjs must not circular-require bin/oxe-cc.js');

    const promoteMod = require(promoteModPath);
    const specCmdMod = require(specCmdModPath);
    assert.equal(typeof promoteMod.createPromoteRuntime, 'function');
    assert.equal(typeof specCmdMod.createSpecProgramCommandRegistry, 'function');

    // Monolith line reduction verified against pre-F7 baseline (oxe-operational: 15,422L; bin/oxe-cc.js: 10,322L)
    const opLines = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'oxe-operational.cjs'), 'utf8').split(/\r?\n/).length;
    const cliLines = fs.readFileSync(path.join(ROOT, 'bin', 'oxe-cc.js'), 'utf8').split(/\r?\n/).length;
    assert.ok(opLines <= 14600, `expected oxe-operational.cjs <= 14600 lines (reduced >= 800L), got ${opLines}`);
    assert.ok(cliLines <= 10050, `expected bin/oxe-cc.js <= 10050 lines (reduced >= 250L), got ${cliLines}`);

    // Full SDK export parity + zero drift
    const op = require(path.join(ROOT, 'bin', 'lib', 'oxe-operational.cjs'));
    const exportCount = Object.keys(op).length;
    assert.ok(exportCount >= 211, `expected >= 211 exports in oxe-operational.cjs, got ${exportCount}`);
    for (const fn of ['runtimePromote', 'runtimeSpecCheck', 'runtimeProgramPhaseAdd', 'runtimeProgramClose', 'runtimeOnboard', 'runtimeWorktreeHygiene']) {
      assert.equal(typeof op[fn], 'function', `export ${fn} must remain a function`);
    }

    const sdkCheck = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-sdk-types.cjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.match(sdkCheck, /OK/i);
  });
});
