import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractManifest,
  validatePlugin,
  isAbiCompatible,
  sandboxInvoke,
  CURRENT_ABI_VERSION,
} from '../src/plugins/plugin-manifest';
import type { OxePlugin, ToolProvider } from '../src/plugins/plugin-abi';

function makeToolProvider(name: string): ToolProvider {
  return {
    name,
    kind: 'mutation',
    idempotent: false,
    supports: (t) => t === 'generate_patch',
    invoke: async () => ({ success: true, output: 'ok', evidence_paths: [], side_effects_applied: [] }),
  };
}

function makePlugin(overrides: Partial<OxePlugin> = {}): OxePlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    toolProviders: [makeToolProvider('patch-tool')],
    ...overrides,
  };
}

describe('PluginManifest', () => {
  test('extractManifest includes correct capabilities', () => {
    const plugin = makePlugin({ hooks: { pre_execute: async () => {} } });
    const manifest = extractManifest(plugin);
    assert.ok(manifest.capabilities.includes('tool'));
    assert.ok(manifest.capabilities.includes('hooks'));
    assert.equal(manifest.name, 'test-plugin');
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.abi_version, CURRENT_ABI_VERSION);
  });

  test('extractManifest with no providers yields empty capabilities', () => {
    const plugin: OxePlugin = { name: 'empty-plugin' };
    const manifest = extractManifest(plugin);
    assert.equal(manifest.capabilities.length, 0);
  });

  test('validatePlugin passes for valid plugin', () => {
    const result = validatePlugin(makePlugin());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test('validatePlugin errors when name is missing', () => {
    const plugin = { name: '' } as OxePlugin;
    const result = validatePlugin(plugin);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('name')));
  });

  test('validatePlugin warns when no providers or hooks', () => {
    const plugin: OxePlugin = { name: 'no-effect-plugin' };
    const result = validatePlugin(plugin);
    assert.ok(result.warnings.some((w) => w.includes('no effect')));
  });

  test('validatePlugin warns on non-semver version', () => {
    const plugin = makePlugin({ version: 'latest' });
    const result = validatePlugin(plugin);
    assert.ok(result.warnings.some((w) => w.includes('semver')));
  });

  test('validatePlugin errors when ToolProvider missing supports()', () => {
    const badProvider = { name: 'bad-tool', kind: 'mutation', idempotent: false } as unknown as ToolProvider;
    const plugin: OxePlugin = { name: 'bad-plugin', toolProviders: [badProvider] };
    const result = validatePlugin(plugin);
    assert.ok(result.errors.some((e) => e.includes('supports()')));
  });

  test('isAbiCompatible returns true for same major version', () => {
    assert.equal(isAbiCompatible('1.0.0'), true);
    assert.equal(isAbiCompatible('1.5.3'), true);
    assert.equal(isAbiCompatible('1.99.0'), true);
  });

  test('isAbiCompatible returns false for different major version', () => {
    assert.equal(isAbiCompatible('2.0.0'), false);
    assert.equal(isAbiCompatible('0.9.0'), false);
  });

  test('sandboxInvoke resolves successfully', async () => {
    const result = await sandboxInvoke(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  test('sandboxInvoke rejects on timeout', async () => {
    await assert.rejects(
      sandboxInvoke(() => new Promise((r) => setTimeout(r, 500, 'late')), 10),
      /timed out/
    );
  });

  test('sandboxInvoke wraps non-Error rejections as Error', async () => {
    await assert.rejects(
      sandboxInvoke(() => Promise.reject('string error')),
      (err) => err instanceof Error && err.message === 'string error'
    );
  });
});
