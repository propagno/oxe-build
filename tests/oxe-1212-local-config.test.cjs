'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const local = require('../bin/lib/oxe-local-config.cjs');
const { classifyFailure } = require('../bin/lib/oxe-verify-dryrun.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-163: F10's dry-verify failed every `:app:testDebugUnitTest` with "SDK location not found …
// local.properties": a fresh worktree has no gitignored machine-local config.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-local-')); dirs.push(d); return d; };
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function repo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  write(dir, '.gitignore', '.oxe/\nlocal.properties\n.env.local\n');
  write(dir, 'mobile/android/build.gradle', '// app\n');
  write(dir, 'tracked.properties', 'x=1\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  write(dir, 'mobile/android/local.properties', 'sdk.dir=C:\\\\Android\\\\Sdk\n');
  write(dir, '.env.local', 'API=dev\n');
  return dir;
}

describe('OXB-163: worktree.copy_local', () => {
  it('nothing by default; listed gitignored files are copied, tracked or existing ones are not; globs work', () => {
    const src = repo();
    const dst = tmp();
    assert.deepEqual(local.copyLocalFiles(src, dst).copied, [], 'no list → nothing copied');
    write(src, '.oxe/config.json', JSON.stringify({ worktree: { copy_local: ['**/local.properties', '.env.local', 'tracked.properties', 'missing.txt'] } }));
    write(dst, '.env.local', 'API=mine\n');
    const out = local.copyLocalFiles(src, dst);
    assert.deepEqual(out.copied, ['mobile/android/local.properties']);
    assert.equal(fs.readFileSync(path.join(dst, '.env.local'), 'utf8'), 'API=mine\n', 'never overwritten');
    assert.deepEqual(out.skipped.map((s) => s.path).sort(), ['.env.local', 'missing.txt', 'tracked.properties']);
    assert.match(out.skipped.find((s) => s.path === 'tracked.properties').why, /versionado/);
  });

  it('program init --from copies them into the new worktree', () => {
    const main = repo();
    write(main, '.oxe/config.json', JSON.stringify({ worktree: { copy_local: ['mobile/android/local.properties'] } }));
    write(main, '.oxe/STATE.md', '# S\n');
    write(main, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
    write(main, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — App\n\n**Depende de:** F1\n**Critérios de aceite:** A2\n');
    op.runtimeProgramInit(main, null, {});
    const fork = path.join(tmp(), 'f10');
    git(main, 'worktree', 'add', '-q', '--detach', fork, 'main');
    const out = op.runtimeProgramInitFrom(fork, null, { from: main });
    assert.ok(out.copied.includes('mobile/android/local.properties (local da máquina)'), out.copied.join(', '));
    assert.match(fs.readFileSync(path.join(fork, 'mobile', 'android', 'local.properties'), 'utf8'), /sdk\.dir/);
    git(main, 'worktree', 'remove', '--force', fork); // no node_modules links in this test tree
  });
});

describe('OXB-163: the dry-verify reads a missing SDK location as the environment', () => {
  it('"SDK location not found" / ANDROID_HOME → environment, not broken_command', () => {
    const out = "FAILURE: Build failed with an exception.\n* What went wrong:\nCould not determine the dependencies of task ':app:testDebugUnitTest'.\n> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file at '/w/mobile/android/local.properties'.";
    assert.equal(classifyFailure(out, ['mobile/android/app/src/main/X.kt'], {}), 'environment');
    assert.equal(classifyFailure('error: unknown flag --foo', ['a.ts'], {}), 'broken_command');
  });
});
