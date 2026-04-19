import type { OxePlugin } from './plugin-abi';

export const CURRENT_ABI_VERSION = '1.0.0';

export interface PluginManifest {
  name: string;
  version: string;
  abi_version: string;
  capabilities: Array<'tool' | 'workspace' | 'verifier' | 'context' | 'hooks'>;
  tool_action_types?: string[];
  workspace_strategies?: string[];
  verifier_check_types?: string[];
  context_provider_names?: string[];
  hook_names?: string[];
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function extractManifest(plugin: OxePlugin): PluginManifest {
  const capabilities: PluginManifest['capabilities'] = [];
  if (plugin.toolProviders?.length) capabilities.push('tool');
  if (plugin.workspaceProviders?.length) capabilities.push('workspace');
  if (plugin.verifierProviders?.length) capabilities.push('verifier');
  if (plugin.contextProviders?.length) capabilities.push('context');
  if (plugin.hooks && Object.keys(plugin.hooks).length > 0) capabilities.push('hooks');

  return {
    name: plugin.name,
    version: plugin.version ?? '0.0.0',
    abi_version: CURRENT_ABI_VERSION,
    capabilities,
    tool_action_types: plugin.toolProviders?.flatMap((p) =>
      ['read_code', 'generate_patch', 'run_tests', 'collect_evidence', 'custom'].filter((t) => p.supports(t))
    ) ?? [],
    workspace_strategies: plugin.workspaceProviders?.map((p) => p.name) ?? [],
    verifier_check_types: plugin.verifierProviders?.flatMap((p) =>
      ['unit', 'integration', 'smoke', 'policy', 'security', 'custom'].filter((t) => p.supports(t))
    ) ?? [],
    context_provider_names: plugin.contextProviders?.map((p) => p.name) ?? [],
    hook_names: plugin.hooks ? Object.keys(plugin.hooks) : [],
  };
}

export function validatePlugin(plugin: OxePlugin): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plugin.name || typeof plugin.name !== 'string') {
    errors.push('Plugin must have a non-empty string name');
  }

  if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version)) {
    warnings.push(`Plugin version "${plugin.version}" does not follow semver`);
  }

  if (!plugin.toolProviders?.length &&
      !plugin.workspaceProviders?.length &&
      !plugin.verifierProviders?.length &&
      !plugin.contextProviders?.length &&
      !plugin.hooks) {
    warnings.push('Plugin declares no providers or hooks — it has no effect');
  }

  // Validate each tool provider
  for (const tp of plugin.toolProviders ?? []) {
    if (!tp.name) errors.push('ToolProvider missing name');
    if (typeof tp.supports !== 'function') errors.push(`ToolProvider "${tp.name}" missing supports() method`);
    if (typeof tp.invoke !== 'function') errors.push(`ToolProvider "${tp.name}" missing invoke() method`);
  }

  // Validate each workspace provider
  for (const wp of plugin.workspaceProviders ?? []) {
    if (!wp.name) errors.push('WorkspaceProvider missing name');
    if (typeof wp.supportsStrategy !== 'function') errors.push(`WorkspaceProvider "${wp.name}" missing supportsStrategy()`);
    if (typeof wp.allocate !== 'function') errors.push(`WorkspaceProvider "${wp.name}" missing allocate()`);
  }

  // Validate each verifier provider
  for (const vp of plugin.verifierProviders ?? []) {
    if (!vp.name) errors.push('VerifierProvider missing name');
    if (typeof vp.supports !== 'function') errors.push(`VerifierProvider "${vp.name}" missing supports()`);
    if (typeof vp.execute !== 'function') errors.push(`VerifierProvider "${vp.name}" missing execute()`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function isAbiCompatible(pluginAbiVersion: string): boolean {
  // Major version must match; minor/patch are backwards-compatible
  const [currMajor] = CURRENT_ABI_VERSION.split('.').map(Number);
  const [plugMajor] = pluginAbiVersion.split('.').map(Number);
  return currMajor === plugMajor;
}

export function sandboxInvoke<T>(
  fn: () => Promise<T>,
  timeoutMs = 10_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Plugin invocation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); }
    );
  });
}
