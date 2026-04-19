"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const capability_matrix_1 = require("../src/plugins/capability-matrix");
const plugin_registry_1 = require("../src/plugins/plugin-registry");
const plugin_manifest_1 = require("../src/plugins/plugin-manifest");
function makePlugin(name, overrides = {}) {
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
(0, node_test_1.describe)('buildMatrix', () => {
    (0, node_test_1.test)('empty registry produces empty matrix', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        const matrix = (0, capability_matrix_1.buildMatrix)(registry);
        strict_1.default.equal(matrix.entries.length, 0);
        strict_1.default.equal(matrix.abi_version, plugin_manifest_1.CURRENT_ABI_VERSION);
    });
    (0, node_test_1.test)('registers entries from plugins', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register(makePlugin('alpha'));
        const matrix = (0, capability_matrix_1.buildMatrix)(registry);
        strict_1.default.ok(matrix.entries.length > 0);
    });
    (0, node_test_1.test)('tool provider appears as tool type in matrix', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register(makePlugin('beta'));
        const matrix = (0, capability_matrix_1.buildMatrix)(registry);
        const toolEntries = matrix.entries.filter((e) => e.provider_type === 'tool');
        strict_1.default.ok(toolEntries.length > 0);
        strict_1.default.equal(toolEntries[0].name, 'beta-tool');
    });
    (0, node_test_1.test)('context provider appears in matrix', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register({
            name: 'ctx-plugin',
            contextProviders: [{
                    name: 'ctx-provider',
                    collect: async () => ({ included: [], excluded: [], total_weight: 0 }),
                }],
        });
        const matrix = (0, capability_matrix_1.buildMatrix)(registry);
        const ctxEntries = matrix.entries.filter((e) => e.provider_type === 'context');
        strict_1.default.ok(ctxEntries.length > 0);
        strict_1.default.equal(ctxEntries[0].name, 'ctx-provider');
    });
});
(0, node_test_1.describe)('getStableEntries / getExperimentalEntries / getDeprecatedEntries', () => {
    let matrix;
    (0, node_test_1.test)('setup', () => {
        matrix = {
            abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
            entries: [
                { name: 'stable-tool', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' },
                { name: 'exp-tool', provider_type: 'tool', stability: 'experimental', since_abi_version: '1.0.0' },
                { name: 'dep-tool', provider_type: 'tool', stability: 'deprecated', since_abi_version: '1.0.0', deprecated_in: '1.1.0' },
            ],
        };
    });
    (0, node_test_1.test)('getStableEntries returns only stable', () => {
        const stable = (0, capability_matrix_1.getStableEntries)(matrix);
        strict_1.default.equal(stable.length, 1);
        strict_1.default.equal(stable[0].name, 'stable-tool');
    });
    (0, node_test_1.test)('getExperimentalEntries returns only experimental', () => {
        const exp = (0, capability_matrix_1.getExperimentalEntries)(matrix);
        strict_1.default.equal(exp.length, 1);
        strict_1.default.equal(exp[0].name, 'exp-tool');
    });
    (0, node_test_1.test)('getDeprecatedEntries returns only deprecated', () => {
        const dep = (0, capability_matrix_1.getDeprecatedEntries)(matrix);
        strict_1.default.equal(dep.length, 1);
        strict_1.default.equal(dep[0].deprecated_in, '1.1.0');
    });
});
(0, node_test_1.describe)('markDeprecated', () => {
    (0, node_test_1.test)('marks an entry as deprecated (immutable)', () => {
        const matrix = {
            abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
            entries: [
                { name: 'my-tool', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' },
            ],
        };
        const updated = (0, capability_matrix_1.markDeprecated)(matrix, 'my-tool', '1.2.0', 'new-tool');
        strict_1.default.equal(updated.entries[0].stability, 'deprecated');
        strict_1.default.equal(updated.entries[0].deprecated_in, '1.2.0');
        strict_1.default.equal(updated.entries[0].replacement, 'new-tool');
        // Original unchanged
        strict_1.default.equal(matrix.entries[0].stability, 'stable');
    });
    (0, node_test_1.test)('markDeprecated is no-op for unknown name', () => {
        const matrix = { abi_version: plugin_manifest_1.CURRENT_ABI_VERSION, entries: [] };
        const updated = (0, capability_matrix_1.markDeprecated)(matrix, 'no-such', '1.0.0');
        strict_1.default.equal(updated.entries.length, 0);
    });
});
(0, node_test_1.describe)('addEntry', () => {
    (0, node_test_1.test)('adds a new entry', () => {
        const matrix = { abi_version: plugin_manifest_1.CURRENT_ABI_VERSION, entries: [] };
        const updated = (0, capability_matrix_1.addEntry)(matrix, { name: 'new-tool', provider_type: 'tool', stability: 'experimental', since_abi_version: '1.0.0' });
        strict_1.default.equal(updated.entries.length, 1);
    });
    (0, node_test_1.test)('does not add duplicate entry', () => {
        const matrix = {
            abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
            entries: [{ name: 'tool-a', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' }],
        };
        const updated = (0, capability_matrix_1.addEntry)(matrix, { name: 'tool-a', provider_type: 'tool', stability: 'stable', since_abi_version: '1.0.0' });
        strict_1.default.equal(updated.entries.length, 1);
    });
});
(0, node_test_1.describe)('PluginRegistry validation on register', () => {
    (0, node_test_1.test)('registers a valid plugin without error', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        strict_1.default.doesNotThrow(() => registry.register(makePlugin('valid-plugin')));
    });
    (0, node_test_1.test)('throws on plugin with no name', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        strict_1.default.throws(() => registry.register({ name: '' }), /failed validation|must have a non-empty/i);
    });
    (0, node_test_1.test)('warns but does not throw for plugin with no providers', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        // no providers → warning but should still register (warnings !== errors)
        strict_1.default.doesNotThrow(() => registry.register({ name: 'no-providers-plugin' }));
    });
});
