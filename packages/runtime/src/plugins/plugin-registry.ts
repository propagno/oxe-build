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

export class PluginRegistry {
  private plugins: OxePlugin[] = [];

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
      } catch {
        // skip invalid plugin files
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
}

let _globalRegistry: PluginRegistry | null = null;

export function globalRegistry(): PluginRegistry {
  if (!_globalRegistry) _globalRegistry = new PluginRegistry();
  return _globalRegistry;
}

export function resetGlobalRegistry(): void {
  _globalRegistry = null;
}
