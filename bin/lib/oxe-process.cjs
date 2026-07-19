'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const PACKAGE_MANAGERS = new Set(['npm', 'npx']);

function assertSafeArgs(args) {
  if (!Array.isArray(args)) throw new TypeError('args deve ser um array');
  for (const arg of args) {
    if (typeof arg !== 'string') throw new TypeError('todo argumento deve ser string');
    if (arg.includes('\0')) throw new TypeError('argumento contém byte NUL');
  }
}

/** Resolve npm/npx without ever relying on a command shell. */
function resolvePackageManagerInvocation(manager, options = {}) {
  if (!PACKAGE_MANAGERS.has(manager)) {
    throw new TypeError(`package manager não suportado: ${manager}`);
  }
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { command: manager, argsPrefix: [] };
  const platformPath = path.win32;

  const env = options.env || process.env;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const existsSync = options.existsSync || fs.existsSync;
  const cliName = `${manager}-cli.js`;
  const candidates = [];
  const pathEntries = String(env.PATH || env.Path || '').split(platformPath.delimiter).filter(Boolean);
  // Honor PATH precedence first, including test/toolchain shims that expose the
  // JavaScript CLI directly.
  for (const pathEntry of pathEntries) candidates.push(platformPath.join(pathEntry, cliName));
  const execPath = manager === 'npm' ? env.npm_execpath : env.npx_execpath;
  if (execPath && new RegExp(`${manager}-cli\\.js$`, 'i').test(execPath)) candidates.push(execPath);
  if (manager === 'npx' && env.npm_execpath && /npm-cli\.js$/i.test(env.npm_execpath)) {
    candidates.push(platformPath.join(platformPath.dirname(env.npm_execpath), cliName));
  }
  candidates.push(platformPath.join(platformPath.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', cliName));
  for (const pathEntry of pathEntries) {
    candidates.push(platformPath.join(pathEntry, 'node_modules', 'npm', 'bin', cliName));
    candidates.push(platformPath.join(platformPath.dirname(pathEntry), 'node_modules', 'npm', 'bin', cliName));
  }
  const cliPath = candidates.find((candidate) => existsSync(candidate));
  if (!cliPath) {
    throw new Error(`${cliName} não encontrado; confirme que o npm está instalado junto ao Node.js`);
  }
  return { command: nodeExecutable, argsPrefix: [cliPath] };
}

function runPackageManagerSync(manager, args, options = {}) {
  assertSafeArgs(args);
  const invocation = resolvePackageManagerInvocation(manager, options);
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const spawnOptions = { ...options };
  for (const key of ['platform', 'nodeExecutable', 'existsSync', 'spawnSync']) delete spawnOptions[key];
  // Security invariant: callers cannot opt back into a shell.
  spawnOptions.shell = false;
  return spawnSync(invocation.command, [...invocation.argsPrefix, ...args], spawnOptions);
}

module.exports = {
  assertSafeArgs,
  resolvePackageManagerInvocation,
  runPackageManagerSync,
};
