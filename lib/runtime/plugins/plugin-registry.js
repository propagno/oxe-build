"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginRegistry = void 0;
exports.globalRegistry = globalRegistry;
exports.resetGlobalRegistry = resetGlobalRegistry;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class PluginRegistry {
    constructor() {
        this.plugins = [];
    }
    register(plugin) {
        if (this.plugins.some((p) => p.name === plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`);
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
            catch {
                // skip invalid plugin files
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
