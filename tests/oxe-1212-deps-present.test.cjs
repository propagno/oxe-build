'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../bin/lib/oxe-project-env.cjs');

// 1.21.2 — OXB-039: npm ci in the plan worktree ran node-gyp on better-sqlite3, the build failed, npm dropped it as a
// "failed optional dependency", and `doctor --project` still said "ambiente compatível".

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project({ installed = [], lock }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-deps-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'better-sqlite3': '^13.0.0', zod: '^3.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  for (const name of installed) {
    fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  }
  return dir;
}

const LOCK = {
  name: 'app',
  lockfileVersion: 3,
  packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/better-sqlite3': { version: '13.0.1', optional: true, hasInstallScript: true },
    'node_modules/zod': { version: '3.23.8' },
    'node_modules/fsevents': { version: '2.3.3', optional: true, os: ['darwin'] },
    'node_modules/@esbuild/win32-x64': { version: '0.21.5', optional: true, os: ['win32'], cpu: ['x64'] },
    'node_modules/vitest': { version: '2.1.0', dev: true },
  },
};

describe('OXB-039: lockfile packages present in node_modules', () => {
  it('the dropped native optional dependency is reported; other-platform optionals are not', () => {
    const dir = project({ installed: ['zod', 'vitest'], lock: LOCK });
    const missing = env.missingLockfilePackages(dir, LOCK, { platform: 'linux', arch: 'x64', env: {} });
    assert.deepEqual(missing, ['better-sqlite3@13.0.1 (optional)']);
    const winMissing = env.missingLockfilePackages(dir, LOCK, { platform: 'win32', arch: 'x64', env: {} });
    assert.deepEqual(winMissing, ['better-sqlite3@13.0.1 (optional)', '@esbuild/win32-x64@0.21.5 (optional)']);
  });

  it('doctor --project / the execute preflight are no longer "compatible" with the package gone', () => {
    const dir = project({ installed: ['zod', 'vitest'], lock: LOCK });
    const out = env.checkProjectEnvironment(dir, { platform: 'linux', arch: 'x64', env: {}, freeMb: 4096, minFreeMb: 0 });
    assert.equal(out.ok, false);
    assert.match(out.problems.join('\n'), /1 pacote\(s\) do package-lock ausentes em node_modules: better-sqlite3@13\.0\.1 \(optional\)/);
  });

  it('a full install is ok; NODE_ENV=production omits dev; no node_modules is not this check', () => {
    const dir = project({ installed: ['zod', 'vitest', 'better-sqlite3'], lock: LOCK });
    assert.deepEqual(env.missingLockfilePackages(dir, LOCK, { platform: 'linux', arch: 'x64', env: {} }), []);
    const prod = project({ installed: ['zod', 'better-sqlite3'], lock: LOCK });
    assert.deepEqual(env.missingLockfilePackages(prod, LOCK, { platform: 'linux', arch: 'x64', env: { NODE_ENV: 'production' } }), []);
    const bare = project({ installed: [], lock: LOCK });
    fs.rmSync(path.join(bare, 'node_modules'), { recursive: true, force: true });
    assert.deepEqual(env.missingLockfilePackages(bare, LOCK, { platform: 'linux', arch: 'x64', env: {} }), []);
  });
});

describe('OXB-039: the project native check and a stale install', () => {
  it('config native_check runs and a failure is a problem with its last lines; success is silent', () => {
    const dir = project({ installed: ['zod', 'vitest', 'better-sqlite3'], lock: LOCK });
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'check.js'), "console.error('better-sqlite3: NODE_MODULE_VERSION 127 vs Electron 130'); process.exit(1);\n");
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ native_check: 'node check.js' }));
    const bad = env.checkProjectEnvironment(dir, { platform: 'linux', arch: 'x64', env: {}, freeMb: 4096, minFreeMb: 0 });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join('\n'), /native_check falhou \(node check\.js\): better-sqlite3: NODE_MODULE_VERSION 127/);
    fs.writeFileSync(path.join(dir, 'check.js'), 'process.exit(0);\n');
    assert.equal(env.checkProjectEnvironment(dir, { platform: 'linux', arch: 'x64', env: {}, freeMb: 4096, minFreeMb: 0 }).ok, true);
  });

  it('warns when node_modules is older than package-lock.json', () => {
    const dir = project({ installed: ['zod', 'vitest', 'better-sqlite3'], lock: LOCK });
    const marker = path.join(dir, 'node_modules', '.package-lock.json');
    fs.writeFileSync(marker, '{}');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(marker, old, old);
    const out = env.checkProjectEnvironment(dir, { platform: 'linux', arch: 'x64', env: {}, freeMb: 4096, minFreeMb: 0 });
    assert.ok(out.warnings.some((w) => /node_modules mais velho que o package-lock\.json/.test(w)), out.warnings.join('\n'));
  });
});
