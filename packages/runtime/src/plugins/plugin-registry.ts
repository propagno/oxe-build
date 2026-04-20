import fs from 'fs';
import path from 'path';
import type {
  OxePlugin,
  ToolProvider,
  WorkspaceProvider,
  VerifierProvider,
  ContextProvider,
} from './plugin-abi';
import { validatePlugin } from './plugin-manifest';
import { buildMatrix, type CapabilityMatrix } from './capability-matrix';
import { loadCapabilityPlugins } from './capability-adapter';

export class PluginRegistry {
  private plugins: OxePlugin[] = [];
  private loadErrors: string[] = [];

  register(plugin: OxePlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    const validation = validatePlugin(plugin);
    if (!validation.valid && validation.errors.length > 0) {
      throw new Error(`Plugin "${plugin.name}" failed validation: ${validation.errors.join('; ')}`);
    }
    this.plugins.push(plugin);
  }

  unregister(name: string): void {
    this.plugins = this.plugins.filter((p) => p.name !== name);
  }

  loadFromDirectory(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const loaded: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.cjs') && !file.endsWith('.js')) continue;
      const fullPath = path.resolve(dir, file);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(fullPath) as OxePlugin | { default?: OxePlugin };
        const plugin = 'default' in mod && mod.default ? mod.default : (mod as OxePlugin);
        if (plugin && plugin.name) {
          this.register(plugin);
          loaded.push(plugin.name);
        }
      } catch (error) {
        this.loadErrors.push(
          `Plugin ${fullPath} falhou ao carregar: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return loaded;
  }

  toolProviderFor(actionType: string): ToolProvider | null {
    for (const plugin of this.plugins) {
      const provider = plugin.toolProviders?.find((p) => p.supports(actionType));
      if (provider) return provider;
    }
    return null;
  }

  workspaceProviderFor(strategy: string): WorkspaceProvider | null {
    for (const plugin of this.plugins) {
      const provider = plugin.workspaceProviders?.find((p) => p.supportsStrategy(strategy));
      if (provider) return provider;
    }
    return null;
  }

  verifierProviderFor(checkType: string): VerifierProvider | null {
    for (const plugin of this.plugins) {
      const provider = plugin.verifierProviders?.find((p) => p.supports(checkType));
      if (provider) return provider;
    }
    return null;
  }

  contextProviderFor(name: string): ContextProvider | null {
    for (const plugin of this.plugins) {
      const provider = plugin.contextProviders?.find((p) => p.name === name);
      if (provider) return provider;
    }
    return null;
  }

  allContextProviders(): ContextProvider[] {
    return this.plugins.flatMap((p) => p.contextProviders ?? []);
  }

  allToolProviders(): ToolProvider[] {
    return this.plugins.flatMap((p) => p.toolProviders ?? []);
  }

  async runHook(
    hookName: string,
    ctx: Record<string, unknown>
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.[hookName];
      if (hook) await hook(ctx);
    }
  }

  list(): Array<{ name: string; version?: string; providers: string[] }> {
    return this.plugins.map((p) => ({
      name: p.name,
      version: p.version,
      providers: [
        ...(p.toolProviders?.map((tp) => `tool:${tp.name}`) ?? []),
        ...(p.workspaceProviders?.map((wp) => `workspace:${wp.name}`) ?? []),
        ...(p.verifierProviders?.map((vp) => `verifier:${vp.name}`) ?? []),
        ...(p.contextProviders?.map((cp) => `context:${cp.name}`) ?? []),
      ],
    }));
  }

  registerProjectCapabilities(projectRoot: string): string[] {
    const loaded: string[] = [];
    for (const plugin of loadCapabilityPlugins(projectRoot)) {
      try {
        this.register(plugin);
        loaded.push(plugin.name);
      } catch (error) {
        this.loadErrors.push(
          `Capability plugin ${plugin.name} falhou ao registrar: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return loaded;
  }

  loadErrorsSnapshot(): string[] {
    return [...this.loadErrors];
  }

  clearLoadErrors(): void {
    this.loadErrors = [];
  }

  snapshot(): Array<{
    name: string;
    version?: string;
    abi_version?: string;
    toolProviders: Array<{ name: string; kind: string; idempotent: boolean }>;
    workspaceProviders: Array<{ name: string }>;
    verifierProviders: Array<{ name: string }>;
    contextProviders: Array<{ name: string }>;
  }> {
    return this.plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      abi_version: plugin.abi_version,
      toolProviders: (plugin.toolProviders ?? []).map((provider) => ({
        name: provider.name,
        kind: provider.kind,
        idempotent: provider.idempotent,
      })),
      workspaceProviders: (plugin.workspaceProviders ?? []).map((provider) => ({
        name: provider.name,
      })),
      verifierProviders: (plugin.verifierProviders ?? []).map((provider) => ({
        name: provider.name,
      })),
      contextProviders: (plugin.contextProviders ?? []).map((provider) => ({
        name: provider.name,
      })),
    }));
  }

  summary(): {
    total_plugins: number;
    tool_providers: number;
    workspace_providers: number;
    verifier_providers: number;
    context_providers: number;
    load_errors: number;
    pluginsCount: number;
    toolProviders: number;
    workspaceProviders: number;
    verifierProviders: number;
    contextProviders: number;
    loadErrors: number;
    plugins: Array<{ name: string; version?: string; providers: string[] }>;
  } {
    const plugins = this.list();
    const toolProviders = plugins.reduce((sum, plugin) => sum + plugin.providers.filter((provider) => provider.startsWith('tool:')).length, 0);
    const workspaceProviders = plugins.reduce((sum, plugin) => sum + plugin.providers.filter((provider) => provider.startsWith('workspace:')).length, 0);
    const verifierProviders = plugins.reduce((sum, plugin) => sum + plugin.providers.filter((provider) => provider.startsWith('verifier:')).length, 0);
    const contextProviders = plugins.reduce((sum, plugin) => sum + plugin.providers.filter((provider) => provider.startsWith('context:')).length, 0);
    const loadErrors = this.loadErrors.length;
    return {
      total_plugins: plugins.length,
      tool_providers: toolProviders,
      workspace_providers: workspaceProviders,
      verifier_providers: verifierProviders,
      context_providers: contextProviders,
      load_errors: loadErrors,
      pluginsCount: plugins.length,
      toolProviders,
      workspaceProviders,
      verifierProviders,
      contextProviders,
      loadErrors,
      plugins,
    };
  }

  capabilityMatrix(): CapabilityMatrix {
    return buildMatrix(this);
  }
}

let _globalRegistry: PluginRegistry | null = null;

export function globalRegistry(): PluginRegistry {
  if (!_globalRegistry) _globalRegistry = new PluginRegistry();
  return _globalRegistry;
}

export function resetGlobalRegistry(): void {
  _globalRegistry = null;
}

export function registrySummary(registry: PluginRegistry): ReturnType<PluginRegistry['summary']> {
  return registry.summary();
}

export function resolveCapabilityMatrix(registry: PluginRegistry): CapabilityMatrix {
  return registry.capabilityMatrix();
}
