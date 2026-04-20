"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginRegistry = void 0;
exports.globalRegistry = globalRegistry;
exports.resetGlobalRegistry = resetGlobalRegistry;
exports.registrySummary = registrySummary;
exports.resolveCapabilityMatrix = resolveCapabilityMatrix;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const plugin_manifest_1 = require("./plugin-manifest");
const capability_matrix_1 = require("./capability-matrix");
const capability_adapter_1 = require("./capability-adapter");
class PluginRegistry {
    constructor() {
        this.plugins = [];
        this.loadErrors = [];
    }
    register(plugin) {
        if (this.plugins.some((p) => p.name === plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`);
        }
        const validation = (0, plugin_manifest_1.validatePlugin)(plugin);
        if (!validation.valid && validation.errors.length > 0) {
            throw new Error(`Plugin "${plugin.name}" failed validation: ${validation.errors.join('; ')}`);
        }
        this.plugins.push(plugin);
    }
    unregister(name) {
        this.plugins = this.plugins.filter((p) => p.name !== name);
    }
    loadFromDirectory(dir) {
        if (!fs_1.default.existsSync(dir))
            return [];
        const loaded = [];
        for (const file of fs_1.default.readdirSync(dir)) {
            if (!file.endsWith('.cjs') && !file.endsWith('.js'))
                continue;
            const fullPath = path_1.default.resolve(dir, file);
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const mod = require(fullPath);
                const plugin = 'default' in mod && mod.default ? mod.default : mod;
                if (plugin && plugin.name) {
                    this.register(plugin);
                    loaded.push(plugin.name);
                }
            }
            catch (error) {
                this.loadErrors.push(`Plugin ${fullPath} falhou ao carregar: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return loaded;
    }
    toolProviderFor(actionType) {
        for (const plugin of this.plugins) {
            const provider = plugin.toolProviders?.find((p) => p.supports(actionType));
            if (provider)
                return provider;
        }
        return null;
    }
    workspaceProviderFor(strategy) {
        for (const plugin of this.plugins) {
            const provider = plugin.workspaceProviders?.find((p) => p.supportsStrategy(strategy));
            if (provider)
                return provider;
        }
        return null;
    }
    verifierProviderFor(checkType) {
        for (const plugin of this.plugins) {
            const provider = plugin.verifierProviders?.find((p) => p.supports(checkType));
            if (provider)
                return provider;
        }
        return null;
    }
    contextProviderFor(name) {
        for (const plugin of this.plugins) {
            const provider = plugin.contextProviders?.find((p) => p.name === name);
            if (provider)
                return provider;
        }
        return null;
    }
    allContextProviders() {
        return this.plugins.flatMap((p) => p.contextProviders ?? []);
    }
    allToolProviders() {
        return this.plugins.flatMap((p) => p.toolProviders ?? []);
    }
    async runHook(hookName, ctx) {
        for (const plugin of this.plugins) {
            const hook = plugin.hooks?.[hookName];
            if (hook)
                await hook(ctx);
        }
    }
    list() {
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
    registerProjectCapabilities(projectRoot) {
        const loaded = [];
        for (const plugin of (0, capability_adapter_1.loadCapabilityPlugins)(projectRoot)) {
            try {
                this.register(plugin);
                loaded.push(plugin.name);
            }
            catch (error) {
                this.loadErrors.push(`Capability plugin ${plugin.name} falhou ao registrar: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return loaded;
    }
    loadErrorsSnapshot() {
        return [...this.loadErrors];
    }
    clearLoadErrors() {
        this.loadErrors = [];
    }
    snapshot() {
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
    summary() {
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
    capabilityMatrix() {
        return (0, capability_matrix_1.buildMatrix)(this);
    }
}
exports.PluginRegistry = PluginRegistry;
let _globalRegistry = null;
function globalRegistry() {
    if (!_globalRegistry)
        _globalRegistry = new PluginRegistry();
    return _globalRegistry;
}
function resetGlobalRegistry() {
    _globalRegistry = null;
}
function registrySummary(registry) {
    return registry.summary();
}
function resolveCapabilityMatrix(registry) {
    return registry.capabilityMatrix();
}
