'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const unsafe = require('../bin/lib/oxe-unsafe-commands.cjs');
const { dryRunVerifyCommands } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21.2 — OXB-147 (F2 finding): T18's verify held `npm ci --ignore-scripts (on CI: …)` and two prose lines. The
// dry-verify ran a real `npm ci` in the program worktree: node_modules was deleted, vitest went missing.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const T18 = [
  "npm ci --ignore-scripts (on CI: the PR's own jobs; pr:ready takes the packages path, #664)",
  "the PR's Package (windows-x64) and Package (linux-x64) jobs green: the installer builds without transformers/ONNX/sharp",
  'install-over.yml dispatched on the PR head: green on NSIS, deb and AppImage',
];

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe('OXB-147 (a): destructive or prose verify commands', () => {
  it('flags T18\'s three lines and git/npm mutations; real checks pass', () => {
    for (const c of T18) assert.ok(unsafe.unsafeReason(c) || unsafe.looksLikeProse(c), c);
    for (const c of ['npm install', 'pnpm add x', 'yarn', 'rm -rf node_modules', 'npx rimraf dist', 'git stash', 'git checkout main', 'git reset --hard HEAD', 'git clean -fdx', 'npm rebuild better-sqlite3']) assert.ok(unsafe.unsafeReason(c), c);
    for (const c of ['npx vitest run --maxWorkers=2 --reporter=verbose tests/a.test.ts', 'npm run test:electron -- tests/x.test.ts', 'npm run typecheck', 'npm run lint', 'npm run build', 'npx tsc --noEmit', 'node scripts/check.mjs', './gradlew test', 'git diff --exit-code', 'npm test']) {
      assert.equal(unsafe.unsafeReason(c), null, c);
      assert.equal(unsafe.looksLikeProse(c), false, c);
    }
  });

  it('plan lint: a structural error with the exact wording, so the dry-verify never starts', () => {
    const dir = tmp('oxe-1212-uv-');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{"external_dependency_check":false}');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T18', title: 'pacotes', wave: 1, files: ['package.json'], acceptance: ['A1'], verify: { commands: T18 } }] }));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const lint = op.runtimePlanLint(dir, null, { preflight: false, dryVerify: true });
    const mine = lint.errors.filter((e) => /^T18: comando de verify em prosa ou destrutivo: /.test(e));
    assert.equal(mine.length, 3, lint.errors.join('\n'));
    assert.match(mine[0], /npm ci --ignore-scripts .* — reinstala\/remove pacotes \(npm ci apaga node_modules/);
    assert.equal(lint.dry_verify, null, 'the dry-verify did not run');
  });

  it('the dry-verify itself never runs such a segment (defense in depth)', () => {
    const dir = tmp('oxe-1212-uv-');
    const r = dryRunVerifyCommands(dir, { tasks: [{ id: 'T18', files: ['x.js'], verifyCommand: `node -e "require('fs').writeFileSync('ran.flag','x')" && ${T18[0]}` }] });
    assert.equal(r.results[0].verdict, 'unsafe_command');
    assert.ok(r.errors.some((e) => /comando de verify em prosa ou destrutivo: npm ci/.test(e)));
  });
});

describe('OXB-147 (b): node_modules against the lock, at start and at wave boundaries', () => {
  function withDeps() {
    const dir = tmp('oxe-1212-deps-');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/vitest': { version: '5.0.5' }, 'node_modules/left-pad': { version: '1.0.0' } } }));
    for (const p of ['vitest', 'left-pad']) {
      fs.mkdirSync(path.join(dir, 'node_modules', p), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', p, 'package.json'), '{}');
    }
    return dir;
  }

  it('a broken tree stops the dry-verify before any command', () => {
    const dir = withDeps();
    fs.rmSync(path.join(dir, 'node_modules', 'vitest'), { recursive: true });
    const r = dryRunVerifyCommands(dir, { tasks: [{ id: 'T1', wave: 1, files: ['a.js'], verifyCommand: "node -e \"require('fs').writeFileSync('ran.flag','x')\"" }] }, { depsCheck: true });
    assert.match(r.deps_broken, /1 pacote\(s\) ausente\(s\) \(vitest@5\.0\.5\) — rode npm install/);
    assert.ok(!fs.existsSync(path.join(dir, 'ran.flag')));
  });

  it('a tree that breaks during wave 1 stops before wave 2', () => {
    const dir = withDeps();
    const r = dryRunVerifyCommands(dir, { tasks: [
      { id: 'T1', wave: 1, files: ['a.js'], verifyCommand: "node -e \"require('fs').rmSync('node_modules/vitest',{recursive:true})\"" },
      { id: 'T2', wave: 2, files: ['b.js'], verifyCommand: "node -e \"require('fs').writeFileSync('ran2.flag','x')\"" },
    ] }, { depsCheck: true });
    assert.ok(r.errors.some((e) => /quebrou durante a rodada \(antes da onda 2\)/.test(e)), r.errors.join('\n'));
    assert.ok(!fs.existsSync(path.join(dir, 'ran2.flag')));
  });
});

describe('OXB-147 (c): runtime sync and changed dependencies', () => {
  it('a merge that brings a new package-lock stops with the command to run, and does not re-verify on the stale tree', () => {
    const dir = tmp('oxe-1212-sync-');
    const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('checkout', '-qb', 'program');
    g('checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
    g('add', '-A'); g('commit', '-qm', 'deps');
    g('checkout', '-q', 'program');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ post_install: 'npm run fix:native' }));
    const out = op.runtimeSync(dir, null, { from: 'main', fetch: false });
    assert.equal(out.merged, true);
    assert.deepEqual(out.deps.changed, ['package-lock.json']);
    assert.match(out.error, /^dependências mudaram: rode npm install && npm run fix:native \(package-lock\.json vieram no merge\)/);
  });
});
