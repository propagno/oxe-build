import type { PluginRegistry } from './plugin-registry';
import { CURRENT_ABI_VERSION } from './plugin-manifest';

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

export function buildMatrix(registry: PluginRegistry): CapabilityMatrix {
  const entries: ProviderCapabilityEntry[] = [];

  for (const plugin of registry.snapshot()) {
    for (const provider of plugin.toolProviders) {
      entries.push({
        plugin: plugin.name,
        name: provider.name,
        capability: provider.name,
        provider_type: 'tool',
        stability: 'stable',
        abi_version: plugin.abi_version ?? CURRENT_ABI_VERSION,
        since_abi_version: CURRENT_ABI_VERSION,
        supported: ['read_code', 'generate_patch', 'run_tests', 'collect_evidence', 'custom'].filter((action) =>
          registry.toolProviderFor(action)?.name === provider.name
        ),
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
        abi_version: plugin.abi_version ?? CURRENT_ABI_VERSION,
        since_abi_version: CURRENT_ABI_VERSION,
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
        abi_version: plugin.abi_version ?? CURRENT_ABI_VERSION,
        since_abi_version: CURRENT_ABI_VERSION,
        supported: ['unit', 'integration', 'smoke', 'policy', 'security', 'custom'].filter((checkType) =>
          registry.verifierProviderFor(checkType)?.name === provider.name
        ),
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
        abi_version: plugin.abi_version ?? CURRENT_ABI_VERSION,
        since_abi_version: CURRENT_ABI_VERSION,
        supported: [provider.name],
        fallback_available: false,
      });
    }
  }

  return { abi_version: CURRENT_ABI_VERSION, entries };
}

export function getStableEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[] {
  return matrix.entries.filter((e) => e.stability === 'stable');
}

export function getExperimentalEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[] {
  return matrix.entries.filter((e) => e.stability === 'experimental');
}

export function getDeprecatedEntries(matrix: CapabilityMatrix): ProviderCapabilityEntry[] {
  return matrix.entries.filter((e) => e.stability === 'deprecated');
}

export function markDeprecated(
  matrix: CapabilityMatrix,
  name: string,
  deprecatedIn: string,
  replacement?: string
): CapabilityMatrix {
  return {
    ...matrix,
    entries: matrix.entries.map((e) =>
      e.name === name
        ? { ...e, stability: 'deprecated', deprecated_in: deprecatedIn, replacement }
        : e
    ),
  };
}

export function addEntry(
  matrix: CapabilityMatrix,
  entry: ProviderCapabilityEntry
): CapabilityMatrix {
  if (matrix.entries.some((e) => e.name === entry.name && e.provider_type === entry.provider_type)) {
    return matrix;
  }
  return { ...matrix, entries: [...matrix.entries, entry] };
}
