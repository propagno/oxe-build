import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { PluginRegistry, globalRegistry, resetGlobalRegistry } from '../src/plugins/plugin-registry';
import type { OxePlugin, ToolProvider } from '../src/plugins/plugin-abi';

function makeTool(name: string): ToolProvider {
  return {
    name,
    kind: 'read',
    idempotent: true,
    supports: (t: string) => t === name,
    invoke: async () => ({ success: true, output: 'ok', evidence_paths: [], side_effects_applied: [] }),
  };
}

describe('PluginRegistry — register / unregister', () => {
  it('registers a plugin and finds tool provider', () => {
    const registry = new PluginRegistry();
    const plugin: OxePlugin = { name: 'test-plugin', toolProviders: [makeTool('run_tests')] };
    registry.register(plugin);
    const provider = registry.toolProviderFor('run_tests');
    assert.ok(provider);
    assert.equal(provider.name, 'run_tests');
  });

  it('unregisters a plugin', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'p1', toolProviders: [makeTool('do_thing')] });
    registry.unregister('p1');
    assert.equal(registry.toolProviderFor('do_thing'), null);
  });

  it('lists registered plugins', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'p1' });
    registry.register({ name: 'p2' });
    const list = registry.list();
    assert.equal(list.length, 2);
  });
});

describe('PluginRegistry — workspace provider', () => {
  it('finds workspace provider by strategy', () => {
    const registry = new PluginRegistry();
    const wp = {
      name: 'my-ws',
      supportsStrategy: (s: string) => s === 'git_worktree',
      allocate: async () => ({ workspace_id: 'w1', strategy: 'git_worktree' as const, branch: null, base_commit: null, root_path: '/tmp', ttl_minutes: 30 }),
      snapshot: async () => ({ snapshot_id: 's1', workspace_id: 'w1', commit: 'abc', created_at: new Date().toISOString() }),
      reset: async () => {},
      dispose: async () => {},
    };
    registry.register({ name: 'ws-plugin', workspaceProviders: [wp] });
    const found = registry.workspaceProviderFor('git_worktree');
    assert.ok(found);
    assert.equal(found.name, 'my-ws');
  });
});

describe('PluginRegistry — hooks', () => {
  it('runs a hook without error', async () => {
    const registry = new PluginRegistry();
    let called = false;
    registry.register({
      name: 'hook-plugin',
      hooks: {
        onRunStart: async () => { called = true; },
      },
    });
    await registry.runHook('onRunStart', {});
    assert.ok(called);
  });

  it('runHook is safe when no plugin has the hook', async () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'no-hooks' });
    await assert.doesNotReject(() => registry.runHook('onRunStart', {}));
  });
});

describe('PluginRegistry — loadFromDirectory', () => {
  it('loads plugins from a directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-plugins-'));
    const pluginCode = `module.exports = { name: 'loaded-plugin', toolProviders: [] };`;
    fs.writeFileSync(path.join(dir, 'my-plugin.cjs'), pluginCode);
    const registry = new PluginRegistry();
    const loaded = registry.loadFromDirectory(dir);
    assert.ok(loaded.includes('loaded-plugin'));
  });
});

describe('globalRegistry', () => {
  beforeEach(() => { resetGlobalRegistry(); });

  it('returns singleton', () => {
    const r1 = globalRegistry();
    const r2 = globalRegistry();
    assert.equal(r1, r2);
  });

  it('resetGlobalRegistry creates a new instance', () => {
    const r1 = globalRegistry();
    resetGlobalRegistry();
    const r2 = globalRegistry();
    assert.notEqual(r1, r2);
  });
});
