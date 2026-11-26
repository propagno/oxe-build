'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const origin = require('../bin/lib/oxe-origin.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');
const envSanitize = require('../bin/lib/oxe-env-sanitize.cjs');
const wtDeps = require('../bin/lib/oxe-worktree-deps.cjs');
const wtGc = require('../bin/lib/oxe-worktree-gc.cjs');

const BIN = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-1230-l1-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('v1.23.0 Lote 1 — Estabilidade imediata (OXB-G01, G02, G03+G15, G12)', () => {
  it('OXB-G01: ship check-origin and mirrorDirOf({ readOnly: true }) never call mkdirSync or create .git/oxe/quick', () => {
    const dir = mkGitRepo('oxe-g01-');
    try {
      const gitOxeDir = path.join(dir, '.git', 'oxe');
      assert.equal(fs.existsSync(gitOxeDir), false);

      // readOnly lookup must return null and leave .git/oxe untouched
      assert.equal(quick.mirrorDirOf(dir, { readOnly: true }), null);
      assert.equal(fs.existsSync(gitOxeDir), false, '.git/oxe must not be created by mirrorDirOf({ readOnly: true })');

      // quick.exists must also be strictly read-only
      assert.equal(quick.exists(dir, 'Q-20261126-abcd'), false);
      assert.equal(fs.existsSync(gitOxeDir), false, '.git/oxe must not be created by quick.exists()');

      // origin.check against a real git range must stay 100% read-only
      execFileSync('git', ['checkout', '-b', 'feat/ro'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n');
      execFileSync('git', ['add', 'a.txt'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'feat: test\n\nOXE-Task: T1'], { cwd: dir, stdio: 'ignore' });
      const res = origin.check(dir, { target: 'main..HEAD' });
      assert.equal(res.ok, true);
      assert.equal(fs.existsSync(gitOxeDir), false, '.git/oxe must NEVER be created by check-origin');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G02: envSanitize / stripEnvPrefixes strips OXESPACE_*, AI_MEMORY_*, custom prefixes and honors allowlist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g02-'));
    try {
      fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({
        envSanitize: { enabled: true, stripEnvPrefixes: ['CUSTOM_APP_'], allow: ['OXESPACE_KEEP'] },
        stripEnvPrefixes: ['LEGACY_HOST_'],
      }));
      const raw = {
        PATH: '/usr/bin',
        OXESPACE_MCP_PORT: '9999',
        OXESPACE_KEEP: 'ok',
        AI_MEMORY_DB: '/tmp/mem.db',
        CUSTOM_APP_SECRET: '1',
        LEGACY_HOST_FLAG: '1',
        NODE_TEST_CONTEXT: 'child-v8',
        SAFE_VAR: 'hello',
      };
      const { env, stripped } = envSanitize.sanitizeEnv(raw, dir);
      assert.equal(env.PATH, '/usr/bin');
      assert.equal(env.SAFE_VAR, 'hello');
      assert.equal(env.OXESPACE_KEEP, 'ok');
      assert.equal(env.OXESPACE_MCP_PORT, undefined);
      assert.equal(env.AI_MEMORY_DB, undefined);
      assert.equal(env.CUSTOM_APP_SECRET, undefined);
      assert.equal(env.LEGACY_HOST_FLAG, undefined);
      assert.equal(env.NODE_TEST_CONTEXT, undefined);
      assert.ok(stripped.includes('OXESPACE_MCP_PORT'));
      assert.ok(stripped.includes('AI_MEMORY_DB'));
      assert.ok(stripped.includes('CUSTOM_APP_SECRET'));
      assert.ok(stripped.includes('LEGACY_HOST_FLAG'));

      // envSanitize: false disables prefix stripping
      const disabled = envSanitize.sanitizeEnv(raw, { envSanitize: false });
      assert.equal(disabled.env.OXESPACE_MCP_PORT, '9999');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G03 + OXB-G15: worktree link-node-modules validates package-lock.json SHA-256 and package integrity before linking', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g03-src-'));
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g03-dst-'));
    try {
      const lockContent = JSON.stringify({
        name: 'demo',
        lockfileVersion: 3,
        packages: {
          '': { name: 'demo', dependencies: { ws: '^8.0.0', '@xterm/addon-serialize': '^0.12.0' } },
          'node_modules/ws': { version: '8.18.0' },
          'node_modules/@xterm/addon-serialize': { version: '0.12.0' },
        },
      }, null, 2);
      fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { ws: '^8.0.0' } }));
      fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { ws: '^8.0.0' } }));
      fs.writeFileSync(path.join(src, 'package-lock.json'), lockContent);
      fs.writeFileSync(path.join(dst, 'package-lock.json'), lockContent);
      fs.mkdirSync(path.join(src, 'node_modules', 'ws'), { recursive: true });

      // Missing @xterm/addon-serialize in source node_modules -> blocked by OXB-G15
      const missingRes = wtDeps.linkNodeModules(dst, { from: src });
      assert.equal(missingRes.ok, false);
      assert.equal(missingRes.linked, false);
      assert.ok(missingRes.missing_packages.includes('@xterm/addon-serialize'));

      // Add missing package -> link succeeds!
      fs.mkdirSync(path.join(src, 'node_modules', '@xterm', 'addon-serialize'), { recursive: true });
      const okRes = wtDeps.linkNodeModules(dst, { from: src });
      assert.equal(okRes.ok, true, JSON.stringify(okRes.errors));
      assert.equal(okRes.linked, true);
      assert.equal(fs.lstatSync(path.join(dst, 'node_modules')).isSymbolicLink(), true);

      // Divergent package-lock.json hash -> blocked by OXB-G15!
      fs.writeFileSync(path.join(dst, 'package-lock.json'), lockContent.replace('8.18.0', '8.19.0'));
      const mismatchRes = wtDeps.validateNodeModulesJunction(src, dst);
      assert.equal(mismatchRes.ok, false);
      assert.ok(mismatchRes.errors.some((e) => /SHA-256.*diverge/i.test(e)));
    } finally {
      try { fs.unlinkSync(path.join(dst, 'node_modules')); } catch { /* */ }
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(dst, { recursive: true, force: true });
    }
  });

  it('OXB-G12: gc-worktrees --merged defaults to dry-run, skips dirty/unmerged/main, and removes clean merged worktrees with --apply', () => {
    const mainRepo = mkGitRepo('oxe-g12-main-');
    const mergedWt = path.join(os.tmpdir(), `oxe-g12-merged-${Date.now()}`);
    const dirtyWt = path.join(os.tmpdir(), `oxe-g12-dirty-${Date.now()}`);
    const unmergedWt = path.join(os.tmpdir(), `oxe-g12-unmerged-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'feat/merged', mergedWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'feat/dirty', dirtyWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(dirtyWt, 'dirty.txt'), 'uncommitted\n');
      execFileSync('git', ['worktree', 'add', '-b', 'feat/unmerged', unmergedWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(unmergedWt, 'u.txt'), 'ahead\n');
      execFileSync('git', ['add', 'u.txt'], { cwd: unmergedWt, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'ahead'], { cwd: unmergedWt, stdio: 'ignore' });

      // Dry-run via CLI (default)
      const dryOut = JSON.parse(execFileSync(process.execPath, [BIN, 'gc-worktrees', '--merged', '--base', 'main', '--dir', mainRepo, '--json'], { encoding: 'utf8' }));
      assert.equal(dryOut.dry_run, true);
      assert.equal(dryOut.candidates.length, 1);
      assert.equal(dryOut.candidates[0].branch, 'feat/merged');
      assert.equal(dryOut.removed.length, 0);
      assert.equal(fs.existsSync(mergedWt), true);
      assert.ok(dryOut.skipped.some((s) => s.branch === 'feat/dirty' && s.reason === 'dirty'));
      assert.ok(dryOut.skipped.some((s) => s.branch === 'feat/unmerged' && s.reason === 'not_merged'));

      // Apply removes only clean merged worktree and prunes
      const appOut = wtGc.gcWorktrees(mainRepo, { base: 'main', mergedOnly: true, apply: true, deleteBranches: true });
      assert.equal(appOut.dry_run, false);
      assert.equal(appOut.removed.length, 1);
      assert.equal(appOut.pruned, true);
      assert.equal(fs.existsSync(mergedWt), false);
      assert.equal(fs.existsSync(dirtyWt), true);
      assert.equal(fs.existsSync(unmergedWt), true);
    } finally {
      for (const p of [mergedWt, dirtyWt, unmergedWt]) {
        try { execFileSync('git', ['worktree', 'remove', '--force', p], { cwd: mainRepo, stdio: 'ignore' }); } catch { /* */ }
        try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ }
      }
      fs.rmSync(mainRepo, { recursive: true, force: true });
    }
  });
});
