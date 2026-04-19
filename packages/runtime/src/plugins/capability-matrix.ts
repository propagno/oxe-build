import type { PluginRegistry } from './plugin-registry';
import { CURRENT_ABI_VERSION } from './plugin-manifest';

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

export function buildMatrix(registry: PluginRegistry): CapabilityMatrix {
  const entries: ProviderCapabilityEntry[] = [];

  for (const plugin of registry.list()) {
    const providers = plugin.providers ?? [];

    for (const prov of providers) {
      let provider_type: ProviderCapabilityEntry['provider_type'];
      if (prov.startsWith('tool:')) provider_type = 'tool';
      else if (prov.startsWith('workspace:')) provider_type = 'workspace';
      else if (prov.startsWith('verifier:')) provider_type = 'verifier';
      else if (prov.startsWith('context:')) provider_type = 'context';
      else continue;

      const name = prov.slice(prov.indexOf(':') + 1);
      entries.push({
        name,
        provider_type,
        stability: 'stable',
        since_abi_version: CURRENT_ABI_VERSION,
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
