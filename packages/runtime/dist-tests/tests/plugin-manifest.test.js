"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const plugin_manifest_1 = require("../src/plugins/plugin-manifest");
function makeToolProvider(name) {
    return {
        name,
        kind: 'mutation',
        idempotent: false,
        supports: (t) => t === 'generate_patch',
        invoke: async () => ({ success: true, output: 'ok', evidence_paths: [], side_effects_applied: [] }),
    };
}
function makePlugin(overrides = {}) {
    return {
        name: 'test-plugin',
        version: '1.0.0',
        toolProviders: [makeToolProvider('patch-tool')],
        ...overrides,
    };
}
(0, node_test_1.describe)('PluginManifest', () => {
    (0, node_test_1.test)('extractManifest includes correct capabilities', () => {
        const plugin = makePlugin({ hooks: { pre_execute: async () => { } } });
        const manifest = (0, plugin_manifest_1.extractManifest)(plugin);
        strict_1.default.ok(manifest.capabilities.includes('tool'));
        strict_1.default.ok(manifest.capabilities.includes('hooks'));
        strict_1.default.equal(manifest.name, 'test-plugin');
        strict_1.default.equal(manifest.version, '1.0.0');
        strict_1.default.equal(manifest.abi_version, plugin_manifest_1.CURRENT_ABI_VERSION);
    });
    (0, node_test_1.test)('extractManifest with no providers yields empty capabilities', () => {
        const plugin = { name: 'empty-plugin' };
        const manifest = (0, plugin_manifest_1.extractManifest)(plugin);
        strict_1.default.equal(manifest.capabilities.length, 0);
    });
    (0, node_test_1.test)('validatePlugin passes for valid plugin', () => {
        const result = (0, plugin_manifest_1.validatePlugin)(makePlugin());
        strict_1.default.equal(result.valid, true);
        strict_1.default.equal(result.errors.length, 0);
    });
    (0, node_test_1.test)('validatePlugin errors when name is missing', () => {
        const plugin = { name: '' };
        const result = (0, plugin_manifest_1.validatePlugin)(plugin);
        strict_1.default.equal(result.valid, false);
        strict_1.default.ok(result.errors.some((e) => e.includes('name')));
    });
    (0, node_test_1.test)('validatePlugin warns when no providers or hooks', () => {
        const plugin = { name: 'no-effect-plugin' };
        const result = (0, plugin_manifest_1.validatePlugin)(plugin);
        strict_1.default.ok(result.warnings.some((w) => w.includes('no effect')));
    });
    (0, node_test_1.test)('validatePlugin warns on non-semver version', () => {
        const plugin = makePlugin({ version: 'latest' });
        const result = (0, plugin_manifest_1.validatePlugin)(plugin);
        strict_1.default.ok(result.warnings.some((w) => w.includes('semver')));
    });
    (0, node_test_1.test)('validatePlugin errors when ToolProvider missing supports()', () => {
        const badProvider = { name: 'bad-tool', kind: 'mutation', idempotent: false };
        const plugin = { name: 'bad-plugin', toolProviders: [badProvider] };
        const result = (0, plugin_manifest_1.validatePlugin)(plugin);
        strict_1.default.ok(result.errors.some((e) => e.includes('supports()')));
    });
    (0, node_test_1.test)('isAbiCompatible returns true for same major version', () => {
        strict_1.default.equal((0, plugin_manifest_1.isAbiCompatible)('1.0.0'), true);
        strict_1.default.equal((0, plugin_manifest_1.isAbiCompatible)('1.5.3'), true);
        strict_1.default.equal((0, plugin_manifest_1.isAbiCompatible)('1.99.0'), true);
    });
    (0, node_test_1.test)('isAbiCompatible returns false for different major version', () => {
        strict_1.default.equal((0, plugin_manifest_1.isAbiCompatible)('2.0.0'), false);
        strict_1.default.equal((0, plugin_manifest_1.isAbiCompatible)('0.9.0'), false);
    });
    (0, node_test_1.test)('sandboxInvoke resolves successfully', async () => {
        const result = await (0, plugin_manifest_1.sandboxInvoke)(() => Promise.resolve(42));
        strict_1.default.equal(result, 42);
    });
    (0, node_test_1.test)('sandboxInvoke rejects on timeout', async () => {
        await strict_1.default.rejects((0, plugin_manifest_1.sandboxInvoke)(() => new Promise((r) => setTimeout(r, 500, 'late')), 10), /timed out/);
    });
    (0, node_test_1.test)('sandboxInvoke wraps non-Error rejections as Error', async () => {
        await strict_1.default.rejects((0, plugin_manifest_1.sandboxInvoke)(() => Promise.reject('string error')), (err) => err instanceof Error && err.message === 'string error');
    });
});
