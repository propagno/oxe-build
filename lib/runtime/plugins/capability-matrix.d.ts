import type { PluginRegistry } from './plugin-registry';
export type ApiStability = 'stable' | 'experimental' | 'deprecated';
export interface ProviderCapabilityEntry {
    name: string;
    provider_type: 'tool' | 'workspace' | 'verifier' | 'context';
    stability: ApiStability;
    since_abi_version: string;
    deprecated_in?: string;
    replacement?: string;
}
export interface CapabilityMatrix {
    abi_version: string;
    entries: ProviderCapabilityEntry[];
}
export declare function buildMatrix(registry: PluginRegistry): CapabilityMatrix;
export declare function getStableEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[];
export declare function getExperimentalEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[];
export declare function getDeprecatedEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[];
export declare function markDeprecated(matrix: CapabilityMatrix, name: string, deprecatedIn: string, replacement?: string): CapabilityMatrix;
export declare function addEntry(matrix: CapabilityMatrix, entry: ProviderCapabilityEntry): CapabilityMatrix;
