import type { PluginRegistry } from './plugin-registry';
export type ApiStability = 'stable' | 'experimental' | 'deprecated';
export interface ProviderCapabilityEntry {
    plugin: string;
    name: string;
    capability: string;
    provider_type: 'tool' | 'workspace' | 'verifier' | 'context';
    stability: ApiStability;
    abi_version: string;
    since_abi_version: string;
    supported: string[];
    fallback_available: boolean;
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
