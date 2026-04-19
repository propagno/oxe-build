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
    for (const plugin of registry.list()) {
        const providers = plugin.providers ?? [];
        for (const prov of providers) {
            let provider_type;
            if (prov.startsWith('tool:'))
                provider_type = 'tool';
            else if (prov.startsWith('workspace:'))
                provider_type = 'workspace';
            else if (prov.startsWith('verifier:'))
                provider_type = 'verifier';
            else if (prov.startsWith('context:'))
                provider_type = 'context';
            else
                continue;
            const name = prov.slice(prov.indexOf(':') + 1);
            entries.push({
                name,
                provider_type,
                stability: 'stable',
                since_abi_version: plugin_manifest_1.CURRENT_ABI_VERSION,
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
