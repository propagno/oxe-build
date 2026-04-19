import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatrix,
  getStableEntries,
  getExperimentalEntries,
  getDeprecatedEntries,
  markDeprecated,
  addEntry,
} from '../src/plugins/capability-matrix';
import type { CapabilityMatrix } from '../src/plugins/capability-matrix';
import { PluginRegistry } from '../src/plugins/plugin-registry';
import type { OxePlugin } from '../src/plugins/plugin-abi';
import { CURRENT_ABI_VERSION } from '../src/plugins/plugin-manifest';

function makePlugin(name: string, overrides: Partial<OxePlugin> = {}): OxePlugin {
  return {
    name,
    version: '1.0.0',
    toolProviders: [{
      name: `${name}-tool`,
      kind: 'mutation',
      idempotent: false,
      supports: () => true,
      invoke: async () => ({ success: true, output: '', evidence_paths: [], side_effects_applied: [] }),
    }],
    ...overrides,
  };
}

describe('buildMatrix', () => {
  test('empty registry produces empty matrix', () => {
    const registry = new PluginRegistry();
    const matrix = buildMatrix(registry);
    assert.equal(matrix.entries.length, 0);
    assert.equal(matrix.abi_version, CURRENT_ABI_VERSION);
  });

  test('registers entries from plugins', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('alpha'));
    const matrix = buildMatrix(registry);
    assert.ok(matrix.entries.length > 0);
  });

  test('tool provider appears as tool type in matrix', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('beta'));
    const matrix = buildMatrix(registry);
    const toolEntries = matrix.entries.filter((e) => e.provider_type === 'tool');
    assert.ok(toolEntries.length > 0);
    assert.equal(toolEntries[0].name, 'beta-tool');
  });

  test('context provider appears in matrix', () => {
    const registry = new PluginRegistry();
    registry.register({
      name: 'ctx-plugin',
      contextProviders: [{
        name: 'ctx-provider',
        collect: async () => ({ included: [], excluded: [], total_weight: 0 }),
      }],
    });
    const matrix = buildMatrix(registry);
    const ctxEntries = matrix.entries.filter((e) => e.provider_type === 'context');
    assert.ok(ctxEntries.length > 0);
    assert.equal(ctxEntries[0].name, 'ctx-provider');
  });
});

describe('getStableEntries / getExperimentalEntries / getDeprecatedEntries', () => {
  let matrix: CapabilityMatrix;

  test('setup', () => {
    matrix = {
      abi_version: CURRENT_ABI_VERSION,
      entries: [
        { name: 'stable-tool', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' },
        { name: 'exp-tool', provider_type: 'tool', stability: 'experimental', since_abi_version: '1.0.0' },
        { name: 'dep-tool', provider_type: 'tool', stability: 'deprecated', since_abi_version: '1.0.0', deprecated_in: '1.1.0' },
      ],
    };
  });

  test('getStableEntries returns only stable', () => {
    const stable = getStableEntries(matrix);
    assert.equal(stable.length, 1);
    assert.equal(stable[0].name, 'stable-tool');
  });

  test('getExperimentalEntries returns only experimental', () => {
    const exp = getExperimentalEntries(matrix);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].name, 'exp-tool');
  });

  test('getDeprecatedEntries returns only deprecated', () => {
    const dep = getDeprecatedEntries(matrix);
    assert.equal(dep.length, 1);
    assert.equal(dep[0].deprecated_in, '1.1.0');
  });
});

describe('markDeprecated', () => {
  test('marks an entry as deprecated (immutable)', () => {
    const matrix: CapabilityMatrix = {
      abi_version: CURRENT_ABI_VERSION,
      entries: [
        { name: 'my-tool', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' },
      ],
    };
    const updated = markDeprecated(matrix, 'my-tool', '1.2.0', 'new-tool');
    assert.equal(updated.entries[0].stability, 'deprecated');
    assert.equal(updated.entries[0].deprecated_in, '1.2.0');
    assert.equal(updated.entries[0].replacement, 'new-tool');
    // Original unchanged
    assert.equal(matrix.entries[0].stability, 'stable');
  });

  test('markDeprecated is no-op for unknown name', () => {
    const matrix: CapabilityMatrix = { abi_version: CURRENT_ABI_VERSION, entries: [] };
    const updated = markDeprecated(matrix, 'no-such', '1.0.0');
    assert.equal(updated.entries.length, 0);
  });
});

describe('addEntry', () => {
  test('adds a new entry', () => {
    const matrix: CapabilityMatrix = { abi_version: CURRENT_ABI_VERSION, entries: [] };
    const updated = addEntry(matrix, { name: 'new-tool', provider_type: 'tool', stability: 'experimental', since_abi_version: '1.0.0' });
    assert.equal(updated.entries.length, 1);
  });

  test('does not add duplicate entry', () => {
    const matrix: CapabilityMatrix = {
      abi_version: CURRENT_ABI_VERSION,
      entries: [{ name: 'tool-a', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' }],
    };
    const updated = addEntry(matrix, { name: 'tool-a', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' });
    assert.equal(updated.entries.length, 1);
  });
});

describe('PluginRegistry validation on register', () => {
  test('registers a valid plugin without error', () => {
    const registry = new PluginRegistry();
    assert.doesNotThrow(() => registry.register(makePlugin('valid-plugin')));
  });

  test('throws on plugin with no name', () => {
    const registry = new PluginRegistry();
    assert.throws(
      () => registry.register({ name: '' } as OxePlugin),
      /failed validation|must have a non-empty/i
    );
  });

  test('warns but does not throw for plugin with no providers', () => {
    const registry = new PluginRegistry();
    // no providers → warning but should still register (warnings !== errors)
    assert.doesNotThrow(() => registry.register({ name: 'no-providers-plugin' }));
  });
});
