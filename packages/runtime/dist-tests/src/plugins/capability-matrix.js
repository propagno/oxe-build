"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMatrix = buildMatrix;
exports.getStableEntries = getStableEntries;
exports.getExperimentalEntries = getExperimentalEntries;
exports.getDeprecatedEntries = getDeprecatedEntries;
exports.markDeprecated = markDeprecated;
exports.addEntry = addEntry;
const plugin_manifest_1 = require("./plugin-manifest");
function buildMatrix(registry) {
    const entries = [];
    for (const plugin of registry.snapshot()) {
        for (const provider of plugin.toolProviders) {
            entries.push({
                plugin: plugin.name,
                name: provider.name,
                capability: provider.name,
                provider_type: 'tool',
                stability: 'stable',
                abi_version: plugin.abi_version ?? plugin_manifest_1.CURRENT_ABI_VERSION,
                since_abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
                supported: ['read_code', 'generate_patch', 'run_tests', 'collect_evidence', 'custom'].filter((action) => registry.toolProviderFor(action)?.name === provider.name),
                fallback_available: true,
            });
        }
        for (const provider of plugin.workspaceProviders) {
            entries.push({
                plugin: plugin.name,
                name: provider.name,
                capability: provider.name,
                provider_type: 'workspace',
                stability: 'stable',
                abi_version: plugin.abi_version ?? plugin_manifest_1.CURRENT_ABI_VERSION,
                since_abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
                supported: [provider.name],
                fallback_available: true,
            });
        }
        for (const provider of plugin.verifierProviders) {
            entries.push({
                plugin: plugin.name,
                name: provider.name,
                capability: provider.name,
                provider_type: 'verifier',
                stability: 'stable',
                abi_version: plugin.abi_version ?? plugin_manifest_1.CURRENT_ABI_VERSION,
                since_abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
                supported: ['unit', 'integration', 'smoke', 'policy', 'security', 'custom'].filter((checkType) => registry.verifierProviderFor(checkType)?.name === provider.name),
                fallback_available: true,
            });
        }
        for (const provider of plugin.contextProviders) {
            entries.push({
                plugin: plugin.name,
                name: provider.name,
                capability: provider.name,
                provider_type: 'context',
                stability: 'stable',
                abi_version: plugin.abi_version ?? plugin_manifest_1.CURRENT_ABI_VERSION,
                since_abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
                supported: [provider.name],
                fallback_available: false,
            });
        }
    }
    return { abi_version: plugin_manifest_1.CURRENT_ABI_VERSION, entries };
}
function getStableEntries(matrix) {
    return matrix.entries.filter((e) => e.stability === 'stable');
}
function getExperimentalEntries(matrix) {
    return matrix.entries.filter((e) => e.stability === 'experimental');
}
function getDeprecatedEntries(matrix) {
    return matrix.entries.filter((e) => e.stability === 'deprecated');
}
function markDeprecated(matrix, name, deprecatedIn, replacement) {
    return {
        ...matrix,
        entries: matrix.entries.map((e) => e.name === name
            ? { ...e, stability: 'deprecated', deprecated_in: deprecatedIn, replacement }
            : e),
    };
}
function addEntry(matrix, entry) {
    if (matrix.entries.some((e) => e.name === entry.name && e.provider_type === entry.provider_type)) {
        return matrix;
    }
    return { ...matrix, entries: [...matrix.entries, entry] };
}
