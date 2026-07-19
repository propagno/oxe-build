'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertSafeArgs,
  resolvePackageManagerInvocation,
  runPackageManagerSync,
} = require('../bin/lib/oxe-process.cjs');

test('Unix invokes npm directly without a shell', () => {
  let call;
  runPackageManagerSync('npm', ['view', 'oxe-cc; echo PWNED'], {
    platform: 'linux',
    spawnSync(command, args, options) { call = { command, args, options }; return { status: 0 }; },
    shell: true,
  });
  assert.equal(call.command, 'npm');
  assert.deepEqual(call.args, ['view', 'oxe-cc; echo PWNED']);
  assert.equal(call.options.shell, false);
});

test('Windows resolves npm-cli.js and preserves hostile text as one argument', () => {
  const cli = 'C:\\Node\\node_modules\\npm\\bin\\npm-cli.js';
  let call;
  runPackageManagerSync('npm', ['install', 'pkg&whoami'], {
    platform: 'win32', nodeExecutable: 'C:\\Node\\node.exe', env: {},
    existsSync(candidate) { return candidate === cli; },
    spawnSync(command, args, options) { call = { command, args, options }; return { status: 0 }; },
  });
  assert.equal(call.command, 'C:\\Node\\node.exe');
  assert.deepEqual(call.args, [cli, 'install', 'pkg&whoami']);
  assert.equal(call.options.shell, false);
});

test('Windows resolves npx-cli.js from npm_execpath sibling', () => {
  const npmCli = 'D:\\npm\\bin\\npm-cli.js';
  const npxCli = 'D:\\npm\\bin\\npx-cli.js';
  const invocation = resolvePackageManagerInvocation('npx', {
    platform: 'win32', env: { npm_execpath: npmCli }, nodeExecutable: 'D:\\node.exe',
    existsSync(candidate) { return candidate === npxCli; },
  });
  assert.deepEqual(invocation, { command: 'D:\\node.exe', argsPrefix: [npxCli] });
});

test('rejects unsupported managers, malformed args and missing Windows CLI', () => {
  assert.throws(() => resolvePackageManagerInvocation('pnpm'), /não suportado/);
  assert.throws(() => assertSafeArgs('not-array'), /array/);
  assert.throws(() => assertSafeArgs(['ok', 2]), /string/);
  assert.throws(() => assertSafeArgs(['bad\0arg']), /NUL/);
  assert.throws(() => resolvePackageManagerInvocation('npm', {
    platform: 'win32', env: {}, existsSync: () => false,
  }), /npm-cli\.js não encontrado/);
});
