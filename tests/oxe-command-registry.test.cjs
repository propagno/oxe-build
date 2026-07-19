'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCommandRegistry } = require('../bin/lib/oxe-command-registry.cjs');
const { createCoreCommandRegistry } = require('../bin/lib/oxe-core-command-handlers.cjs');

test('registry dispatches a copy of argv with context', async () => {
  const argv = ['--json'];
  const registry = createCommandRegistry([{ name: 'status', handler(args, ctx) {
    args.push('mutated');
    return `${ctx.project}:${args[0]}`;
  } }]);
  const dispatched = await registry.dispatch('status', argv, { project: 'oxe' });
  assert.deepEqual(dispatched, { handled: true, result: 'oxe:--json' });
  assert.deepEqual(argv, ['--json']);
  assert.deepEqual(registry.names(), ['status']);
  assert.equal(registry.has('status'), true);
});

test('registry reports unknown command without executing anything', async () => {
  const registry = createCommandRegistry([]);
  assert.deepEqual(await registry.dispatch('missing'), { handled: false, result: undefined });
  assert.equal(registry.get('missing'), null);
});

test('registry rejects invalid definitions and duplicate commands', () => {
  assert.throws(() => createCommandRegistry([{ name: '../bad', handler() {} }]), /inválido/);
  assert.throws(() => createCommandRegistry([{ name: 'ok' }]), /handler obrigatório/);
  assert.throws(() => createCommandRegistry([
    { name: 'status', handler() {} }, { name: 'status', handler() {} },
  ]), /duplicado/);
});

function coreFixture(overrides = {}) {
  const calls = [];
  const basic = () => ({ dir: 'project', help: false, parseError: false });
  const deps = {
    existsSync: () => true, printBanner: () => calls.push('banner'), usage() {},
    log() {}, error() {}, exit(code) { throw new Error(`exit:${code}`); },
    colors: { red: '', yellow: '', reset: '' }, readPkgVersion: () => '1.0.0',
    parseUninstallArgs: basic, parseUpdateArgs: basic, parseCapabilitiesArgs: basic,
    parseRuntimeArgs: basic, parseAzureArgs: basic, parseInstallArgs: basic,
    runUninstall: (opts) => calls.push(['uninstall', opts]),
    runUpdateVersionCheck: (opts) => calls.push(['update-check', opts]),
    runUpdate: (opts) => calls.push(['update', opts]),
    runCapabilities: (opts) => calls.push(['capabilities', opts]),
    runRuntime: (opts) => calls.push(['runtime', opts]),
    runAzure: (opts) => calls.push(['azure', opts]),
    runDoctor: (...args) => calls.push(['doctor', ...args]),
    runStatus: (...args) => calls.push(['status', ...args]),
    runStatusFull: (...args) => calls.push(['status-full', ...args]),
    ...overrides,
  };
  return { registry: createCoreCommandRegistry(deps), calls };
}

test('core handlers expose the decomposed command boundary', async () => {
  const { registry, calls } = coreFixture({
    parseInstallArgs: () => ({ dir: 'project', jsonOutput: true, statusHints: true }),
  });
  assert.deepEqual(registry.names(), [
    'uninstall', 'update', 'capabilities', 'runtime', 'azure', 'doctor', 'status',
  ]);
  await registry.dispatch('status', ['--json']);
  assert.equal(calls.includes('banner'), false);
  assert.deepEqual(calls[0], ['status', 'project', { json: true, hints: true, summary: undefined }]);
});

test('core update handler dispatches version check and validates missing directories', async () => {
  const checking = coreFixture({ parseUpdateArgs: () => ({ dir: 'missing', check: true }) });
  await checking.registry.dispatch('update');
  assert.equal(checking.calls[1][0], 'update-check');

  const missing = coreFixture({ existsSync: () => false });
  await assert.rejects(() => missing.registry.dispatch('runtime'), /exit:1/);
});
