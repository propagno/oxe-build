'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const resolve = require('../bin/lib/oxe-install-resolve.cjs');

const baseOpts = () => ({
  ignoreInstallConfig: false,
  explicitScope: false,
  oxeOnly: false,
  integrationsUnset: true,
  installAssetsGlobal: false,
  vscode: false,
  cursor: false,
  copilot: false,
  copilotCli: false,
  allAgents: false,
  commands: true,
  agents: true,
});

describe('oxe-install-resolve full', () => {
  test('ignoreInstallConfig short-circuit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    const { options, warnings } = resolve.resolveInstallOptionsFromConfig(dir, {
      ...baseOpts(),
      ignoreInstallConfig: true,
    });
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(options.ignoreInstallConfig, true);
  });

  test('missing project root', () => {
    const { warnings } = resolve.resolveInstallOptionsFromConfig('/nonexistent-oxe-ir-xyz', baseOpts());
    assert.strictEqual(warnings.length, 0);
  });

  test('parseError in config skips install block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{', 'utf8');
    const { options, warnings } = resolve.resolveInstallOptionsFromConfig(dir, baseOpts());
    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(options.cursor, false);
  });

  test('repo_layout classic from config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ install: { repo_layout: 'classic' } }),
      'utf8'
    );
    const { options } = resolve.resolveInstallOptionsFromConfig(dir, {
      ...baseOpts(),
      integrationsUnset: false,
      cursor: true,
    });
    assert.strictEqual(options.installAssetsGlobal, true);
    assert.strictEqual(options.explicitScope, true);
  });

  test('vscode true from config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ install: { vscode: true } }),
      'utf8'
    );
    const { options } = resolve.resolveInstallOptionsFromConfig(dir, {
      ...baseOpts(),
      integrationsUnset: false,
      cursor: true,
    });
    assert.strictEqual(options.vscode, true);
  });

  test('profiles recommended cursor copilot core cli all_agents', () => {
    const profiles = ['recommended', 'cursor', 'copilot', 'core', 'cli', 'all_agents'];
    for (const profile of profiles) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.oxe', 'config.json'),
        JSON.stringify({ install: { profile } }),
        'utf8'
      );
      const { options, warnings } = resolve.resolveInstallOptionsFromConfig(dir, baseOpts());
      assert.strictEqual(warnings.length, 0, profile);
      assert.strictEqual(options.integrationsUnset, false, profile);
      if (profile === 'cursor') {
        assert.strictEqual(options.cursor, true);
        assert.strictEqual(options.copilot, false);
      }
      if (profile === 'all_agents') {
        assert.strictEqual(options.allAgents, true);
        assert.strictEqual(options.copilotCli, true);
      }
      if (profile === 'core') {
        assert.strictEqual(options.cursor, false);
        assert.strictEqual(options.commands, false);
        assert.strictEqual(options.agents, false);
      }
    }
  });

  test('invalid profile warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ install: { profile: 'nope' } }),
      'utf8'
    );
    const { warnings } = resolve.resolveInstallOptionsFromConfig(dir, baseOpts());
    assert.ok(warnings.some((w) => w.includes('ignorado')));
  });

  test('include_commands_dir and include_agents_md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({
        install: { profile: 'recommended', include_commands_dir: false, include_agents_md: false },
      }),
      'utf8'
    );
    const { options } = resolve.resolveInstallOptionsFromConfig(dir, baseOpts());
    assert.strictEqual(options.commands, false);
    assert.strictEqual(options.agents, false);
  });

  test('oxeOnly returns early before profile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ir-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ install: { profile: 'recommended' } }),
      'utf8'
    );
    const { options } = resolve.resolveInstallOptionsFromConfig(dir, {
      ...baseOpts(),
      oxeOnly: true,
      integrationsUnset: true,
    });
    assert.strictEqual(options.oxeOnly, true);
  });
});
