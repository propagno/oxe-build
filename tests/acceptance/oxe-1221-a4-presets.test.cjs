'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateConfigShape } = require('../../bin/lib/oxe-project-health.cjs');

describe('v1.22.1 F1 A4 — OXB-221-04 (OB-28)', () => {
  it('A4: OXB-221-04 resolvePresetConfig resolves cli, web, desktop-mobile and brand-strict with explicit key overrides and ALLOWED_CONFIG_KEYS', () => {
    const { PRESET_NAMES, resolvePresetConfig } = require('../../bin/lib/oxe-presets.cjs');
    assert.deepEqual([...PRESET_NAMES].sort(), ['brand-strict', 'cli', 'desktop-mobile', 'web']);

    const cliRes = resolvePresetConfig({ preset: 'cli' });
    assert.equal(cliRes.ui.brandGate, false);
    assert.deepEqual(cliRes.ship.requiredCommitStatuses, []);
    assert.equal(cliRes.release.expectedAssets.some((a) => (a.patterns || []).includes('*.apk')), false);
    assert.deepEqual(cliRes.warnings, []);

    const brandRes = resolvePresetConfig({ preset: 'brand-strict' });
    assert.equal(brandRes.ui.brandGate, true);
    assert.ok(brandRes.ship.requiredCommitStatuses.includes('marca/conformidade'));
    assert.equal(brandRes.preflight.cssTargetsDir, 'src/design/targets');

    const composed = resolvePresetConfig({
      presets: ['web', 'brand-strict'],
      ship: { requiredCommitStatuses: ['custom/check'] },
    });
    assert.deepEqual(composed.ship.requiredCommitStatuses, ['custom/check'], 'explicit key must override preset');
    assert.equal(composed.ui.brandGate, true);

    const unknown = resolvePresetConfig({ preset: 'nonexistent-preset' });
    assert.ok(unknown.warnings.some((w) => /nonexistent-preset/.test(w)), 'unknown preset must emit warning');

    const cfgCheck = validateConfigShape({ preset: 'cli', presets: ['cli'] });
    assert.deepEqual(cfgCheck.unknownKeys, [], JSON.stringify(cfgCheck));

    // Also resolves from a directory on disk
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-preset-dir-'));
    try {
      fs.writeFileSync(path.join(tmp, 'oxe.config.json'), JSON.stringify({ preset: 'web' }));
      const fromDir = resolvePresetConfig(tmp);
      assert.deepEqual(fromDir.appliedPresets, ['web']);
      assert.equal(fromDir.ui.brandGate, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
