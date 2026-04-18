"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const plugin_registry_1 = require("../src/plugins/plugin-registry");
function makeTool(name) {
    return {
        name,
        kind: 'read',
        idempotent: true,
        supports: (t) => t === name,
        invoke: async () => ({ success: true, output: 'ok', evidence_paths: [], side_effects_applied: [] }),
    };
}
(0, node_test_1.describe)('PluginRegistry — register / unregister', () => {
    (0, node_test_1.it)('registers a plugin and finds tool provider', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        const plugin = { name: 'test-plugin', toolProviders: [makeTool('run_tests')] };
        registry.register(plugin);
        const provider = registry.toolProviderFor('run_tests');
        strict_1.default.ok(provider);
        strict_1.default.equal(provider.name, 'run_tests');
    });
    (0, node_test_1.it)('unregisters a plugin', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register({ name: 'p1', toolProviders: [makeTool('do_thing')] });
        registry.unregister('p1');
        strict_1.default.equal(registry.toolProviderFor('do_thing'), null);
    });
    (0, node_test_1.it)('lists registered plugins', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register({ name: 'p1' });
        registry.register({ name: 'p2' });
        const list = registry.list();
        strict_1.default.equal(list.length, 2);
    });
});
(0, node_test_1.describe)('PluginRegistry — workspace provider', () => {
    (0, node_test_1.it)('finds workspace provider by strategy', () => {
        const registry = new plugin_registry_1.PluginRegistry();
        const wp = {
            name: 'my-ws',
            supportsStrategy: (s) => s === 'git_worktree',
            allocate: async () => ({ workspace_id: 'w1', strategy: 'git_worktree', branch: null, base_commit: null, root_path: '/tmp', ttl_minutes: 30 }),
            snapshot: async () => ({ snapshot_id: 's1', workspace_id: 'w1', commit: 'abc', created_at: new Date().toISOString() }),
            reset: async () => { },
            dispose: async () => { },
        };
        registry.register({ name: 'ws-plugin', workspaceProviders: [wp] });
        const found = registry.workspaceProviderFor('git_worktree');
        strict_1.default.ok(found);
        strict_1.default.equal(found.name, 'my-ws');
    });
});
(0, node_test_1.describe)('PluginRegistry — hooks', () => {
    (0, node_test_1.it)('runs a hook without error', async () => {
        const registry = new plugin_registry_1.PluginRegistry();
        let called = false;
        registry.register({
            name: 'hook-plugin',
            hooks: {
                onRunStart: async () => { called = true; },
            },
        });
        await registry.runHook('onRunStart', {});
        strict_1.default.ok(called);
    });
    (0, node_test_1.it)('runHook is safe when no plugin has the hook', async () => {
        const registry = new plugin_registry_1.PluginRegistry();
        registry.register({ name: 'no-hooks' });
        await strict_1.default.doesNotReject(() => registry.runHook('onRunStart', {}));
    });
});
(0, node_test_1.describe)('PluginRegistry — loadFromDirectory', () => {
    (0, node_test_1.it)('loads plugins from a directory', () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-plugins-'));
        const pluginCode = `module.exports = { name: 'loaded-plugin', toolProviders: [] };`;
        fs_1.default.writeFileSync(path_1.default.join(dir, 'my-plugin.cjs'), pluginCode);
        const registry = new plugin_registry_1.PluginRegistry();
        const loaded = registry.loadFromDirectory(dir);
        strict_1.default.ok(loaded.includes('loaded-plugin'));
    });
});
(0, node_test_1.describe)('globalRegistry', () => {
    (0, node_test_1.beforeEach)(() => { (0, plugin_registry_1.resetGlobalRegistry)(); });
    (0, node_test_1.it)('returns singleton', () => {
        const r1 = (0, plugin_registry_1.globalRegistry)();
        const r2 = (0, plugin_registry_1.globalRegistry)();
        strict_1.default.equal(r1, r2);
    });
    (0, node_test_1.it)('resetGlobalRegistry creates a new instance', () => {
        const r1 = (0, plugin_registry_1.globalRegistry)();
        (0, plugin_registry_1.resetGlobalRegistry)();
        const r2 = (0, plugin_registry_1.globalRegistry)();
        strict_1.default.notEqual(r1, r2);
    });
});
