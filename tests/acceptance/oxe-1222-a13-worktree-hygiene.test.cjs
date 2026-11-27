'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const wtGc = require('../../bin/lib/oxe-worktree-gc.cjs');
const projectEnv = require('../../bin/lib/oxe-project-env.cjs');
const onboard = require('../../bin/lib/oxe-onboard.cjs');
const oxeOp = require('../../bin/lib/oxe-operational.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-1222-a13-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\nout/\ne2e/out/\n.claude/worktrees/\n.oxe/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# worktree hygiene test\n');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{"allow":[]}\n');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-f', '.claude/settings.local.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function makeDirLink(targetDir, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function unlinkShallow(dir, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    let lst;
    try { lst = fs.lstatSync(full); } catch { continue; }
    if (lst.isSymbolicLink()) {
      try { fs.unlinkSync(full); } catch { /* ignore */ }
    } else if (lst.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') {
      unlinkShallow(full, depth + 1);
    }
  }
}

function cleanupDirs(mainRepo, extraDirs = []) {
  for (const d of extraDirs) {
    unlinkShallow(d);
    try { execFileSync('git', ['worktree', 'remove', '--force', d], { cwd: mainRepo, stdio: 'ignore' }); } catch { /* ignore */ }
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  unlinkShallow(mainRepo);
  try { fs.rmSync(mainRepo, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('A13 — Higiene operacional segura de worktrees (OXB-222-13)', () => {
  it('OXB-222-13: gcWorktrees protects junction targets used by active/kept worktrees and unlinks shallow junctions before removal', () => {
    const mainRepo = mkGitRepo('oxe-a13-junc-');
    const providerWt = path.join(os.tmpdir(), `oxe-a13-provider-${Date.now()}`);
    const activeWt = path.join(os.tmpdir(), `oxe-a13-active-${Date.now()}`);
    const safeWt = path.join(os.tmpdir(), `oxe-a13-safe-${Date.now()}`);
    try {
      // Main repo real node_modules and out dir
      fs.mkdirSync(path.join(mainRepo, 'node_modules', 'main-pkg'), { recursive: true });
      fs.writeFileSync(path.join(mainRepo, 'node_modules', 'main-pkg', 'index.js'), 'module.exports = 1;\n');
      fs.mkdirSync(path.join(mainRepo, 'out'), { recursive: true });
      fs.writeFileSync(path.join(mainRepo, 'out', 'bundle.js'), '// keep\n');

      // 1) providerWt: clean & merged into main, holds real node_modules
      execFileSync('git', ['worktree', 'add', '-b', 'feat/provider', providerWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.mkdirSync(path.join(providerWt, 'node_modules', 'shared-pkg'), { recursive: true });
      fs.writeFileSync(path.join(providerWt, 'node_modules', 'shared-pkg', 'index.js'), 'module.exports = 42;\n');

      // 2) activeWt: NOT merged (ahead of main), links its node_modules -> providerWt/node_modules
      execFileSync('git', ['worktree', 'add', '-b', 'feat/active', activeWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(activeWt, 'feature.txt'), 'wip\n');
      execFileSync('git', ['add', 'feature.txt'], { cwd: activeWt, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'feat: active work'], { cwd: activeWt, stdio: 'ignore' });
      makeDirLink(path.join(providerWt, 'node_modules'), path.join(activeWt, 'node_modules'));

      // 3) safeWt: clean & merged, has both top-level node_modules junction and nested e2e/out junction -> mainRepo
      execFileSync('git', ['worktree', 'add', '-b', 'feat/safe', safeWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      makeDirLink(path.join(mainRepo, 'node_modules'), path.join(safeWt, 'node_modules'));
      makeDirLink(path.join(mainRepo, 'out'), path.join(safeWt, 'e2e', 'out'));

      // Dry-run: providerWt MUST be protected as junction_target_in_use; only safeWt is candidate
      const dry = wtGc.gcWorktrees(mainRepo, { base: 'main', mergedOnly: true, apply: false });
      assert.equal(dry.ok, true);
      assert.equal(dry.candidates.length, 1, `expected only safeWt candidate, got: ${JSON.stringify(dry.candidates)}`);
      assert.equal(dry.candidates[0].branch, 'feat/safe');
      assert.equal(dry.candidates[0].has_real_node_modules, false);

      const protectedEntry = dry.skipped.find((s) => s.branch === 'feat/provider');
      assert.ok(protectedEntry, `providerWt must be skipped, got: ${JSON.stringify(dry.skipped)}`);
      assert.equal(protectedEntry.reason, 'junction_target_in_use');
      assert.ok(Array.isArray(protectedEntry.dependents) && protectedEntry.dependents.length >= 1);

      // Apply: removes safeWt cleanly without damaging mainRepo/node_modules or mainRepo/out, and preserves providerWt
      const app = wtGc.gcWorktrees(mainRepo, { base: 'main', mergedOnly: true, apply: true });
      assert.equal(app.removed.length, 1);
      assert.equal(app.removed[0].branch, 'feat/safe');
      assert.equal(fs.existsSync(safeWt), false);
      assert.equal(fs.existsSync(providerWt), true, 'providerWt must remain intact because activeWt depends on its node_modules');
      assert.equal(fs.existsSync(path.join(activeWt, 'node_modules', 'shared-pkg', 'index.js')), true);
      assert.equal(fs.existsSync(path.join(mainRepo, 'node_modules', 'main-pkg', 'index.js')), true);
      assert.equal(fs.existsSync(path.join(mainRepo, 'out', 'bundle.js')), true);
    } finally {
      cleanupDirs(mainRepo, [activeWt, safeWt, providerWt]);
    }
  });

  it('OXB-222-13: gcWorktrees handles nested agent worktrees (--include-nested) and .claude/settings.local.json (--ignore-agent-settings) safely', () => {
    const mainRepo = mkGitRepo('oxe-a13-nested-');
    const nestedSettingsOnly = path.join(mainRepo, '.claude', 'worktrees', 'agent-old');
    const nestedCodeDirty = path.join(mainRepo, '.claude', 'worktrees', 'agent-code');
    try {
      fs.mkdirSync(path.dirname(nestedSettingsOnly), { recursive: true });
      execFileSync('git', ['worktree', 'add', '-b', 'claude/agent-old', nestedSettingsOnly, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(nestedSettingsOnly, '.claude', 'settings.local.json'), '{"allow":["Read"]}\n');
      fs.mkdirSync(path.join(nestedSettingsOnly, 'node_modules', 'heavy-pkg'), { recursive: true });
      fs.writeFileSync(path.join(nestedSettingsOnly, 'node_modules', 'heavy-pkg', 'index.js'), 'x');

      execFileSync('git', ['worktree', 'add', '-b', 'claude/agent-code', nestedCodeDirty, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(nestedCodeDirty, '.claude', 'settings.local.json'), '{"allow":["Read"]}\n');
      fs.writeFileSync(path.join(nestedCodeDirty, 'README.md'), '# real uncommitted edit\n');

      // Default mode (conservative): both dirty worktrees are skipped
      const conservative = wtGc.gcWorktrees(mainRepo, { base: 'main', mergedOnly: true, apply: false });
      assert.equal(conservative.candidates.length, 0);
      assert.ok(conservative.skipped.some((s) => s.branch === 'claude/agent-old' && s.reason === 'dirty'));

      // With includeNested + ignoreAgentSettings: ONLY agent-old (settings-only dirty) becomes candidate; agent-code stays skipped!
      const dry = wtGc.gcWorktrees(mainRepo, {
        base: 'main',
        mergedOnly: true,
        includeNested: true,
        ignoreAgentSettings: true,
        apply: false,
      });
      assert.equal(dry.candidates.length, 1, `expected only agent-old, got: ${JSON.stringify(dry.candidates)}`);
      assert.equal(dry.candidates[0].branch, 'claude/agent-old');
      assert.equal(dry.candidates[0].nested_agent, true);
      assert.equal(dry.candidates[0].has_real_node_modules, true);
      assert.ok(dry.skipped.some((s) => s.branch === 'claude/agent-code' && s.reason === 'dirty'));

      // Apply removes agent-old and keeps agent-code intact
      const app = wtGc.gcWorktrees(mainRepo, {
        base: 'main',
        mergedOnly: true,
        includeNested: true,
        ignoreAgentSettings: true,
        apply: true,
      });
      assert.equal(app.removed.length, 1);
      assert.equal(fs.existsSync(nestedSettingsOnly), false);
      assert.equal(fs.existsSync(nestedCodeDirty), true);
    } finally {
      cleanupDirs(mainRepo, [nestedSettingsOnly, nestedCodeDirty]);
    }
  });

  it('OXB-222-13: summarizeWorktreeHygiene, doctor --project and buildOnboardingPack report worktree hygiene warnings without blocking', () => {
    const mainRepo = mkGitRepo('oxe-a13-doc-');
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a13-nongit-'));
    const wts = [1, 2, 3].map((n) => path.join(os.tmpdir(), `oxe-a13-doc-wt${n}-${Date.now()}`));
    try {
      fs.mkdirSync(path.join(mainRepo, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'config.json'), JSON.stringify({
        profile: 'lean',
        worktree: { warn_above: 2 },
      }, null, 2));
      for (let i = 0; i < wts.length; i += 1) {
        execFileSync('git', ['worktree', 'add', '-b', `feat/doc-${i}`, wts[i], 'main'], { cwd: mainRepo, stdio: 'ignore' });
      }
      fs.mkdirSync(path.join(wts[0], 'node_modules', 'pkg'), { recursive: true });

      assert.equal(typeof wtGc.summarizeWorktreeHygiene, 'function');
      const sum = wtGc.summarizeWorktreeHygiene(mainRepo, { base: 'main', warnAbove: 2 });
      assert.equal(sum.ok, true);
      assert.equal(sum.git_repo, true);
      assert.equal(sum.secondary, 3);
      assert.equal(sum.clean_merged, 3);
      assert.equal(sum.with_real_node_modules, 1);
      assert.equal(sum.needs_gc, true);

      const envRes = projectEnv.checkProjectEnvironment(mainRepo, { nativeCheck: false });
      assert.equal(envRes.ok, true, 'worktree hygiene warning must be non-blocking');
      assert.ok(envRes.worktrees && envRes.worktrees.needs_gc === true);
      assert.ok(envRes.warnings.some((w) => /gc-worktrees/i.test(w)), `expected gc-worktrees warning, got: ${JSON.stringify(envRes.warnings)}`);

      const pack = onboard.buildOnboardingPack(mainRepo, { env: {} });
      assert.ok(pack.environment.worktrees && pack.environment.worktrees.needs_gc === true);
      assert.ok(pack.gaps.some((g) => /worktree|gc-worktrees/i.test(g)), `expected worktree gap in onboard, got: ${JSON.stringify(pack.gaps)}`);

      // Opt-out via worktree.hygiene: false silences doctor warning
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'config.json'), JSON.stringify({
        profile: 'lean',
        worktree: { hygiene: false },
      }, null, 2));
      const silenced = projectEnv.checkProjectEnvironment(mainRepo, { nativeCheck: false });
      assert.equal(silenced.warnings.some((w) => /gc-worktrees/i.test(w)), false);

      // Non-git directory never throws
      const nonGitSum = wtGc.summarizeWorktreeHygiene(nonGit);
      assert.equal(nonGitSum.ok, true);
      assert.equal(nonGitSum.git_repo, false);
      assert.equal(nonGitSum.needs_gc, false);
    } finally {
      cleanupDirs(mainRepo, wts);
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it('OXB-222-13: runPostCloseWorktreeHygiene honors worktree.auto_gc (false, warn, prune, apply) and is wired into runtimeProgramClose', () => {
    const mainRepo = mkGitRepo('oxe-a13-close-');
    const cleanWt = path.join(os.tmpdir(), `oxe-a13-close-clean-${Date.now()}`);
    const providerWt = path.join(os.tmpdir(), `oxe-a13-close-prov-${Date.now()}`);
    const activeWt = path.join(os.tmpdir(), `oxe-a13-close-act-${Date.now()}`);
    const deadWt = path.join(os.tmpdir(), `oxe-a13-close-dead-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'feat/clean', cleanWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'feat/prov', providerWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.mkdirSync(path.join(providerWt, 'node_modules', 'dep'), { recursive: true });
      execFileSync('git', ['worktree', 'add', '-b', 'feat/act', activeWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(activeWt, 'wip.txt'), 'wip\n');
      execFileSync('git', ['add', 'wip.txt'], { cwd: activeWt, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'wip'], { cwd: activeWt, stdio: 'ignore' });
      makeDirLink(path.join(providerWt, 'node_modules'), path.join(activeWt, 'node_modules'));
      execFileSync('git', ['worktree', 'add', '-b', 'feat/dead', deadWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.rmSync(deadWt, { recursive: true, force: true });

      assert.equal(typeof wtGc.runPostCloseWorktreeHygiene, 'function');
      assert.equal(typeof oxeOp.runtimeWorktreeHygiene, 'function');

      // 1) auto_gc: false
      const offRes = wtGc.runPostCloseWorktreeHygiene(mainRepo, { worktree: { auto_gc: false } });
      assert.equal(offRes.mode, 'off');
      assert.equal(offRes.skipped, true);

      // 2) auto_gc: 'warn' (default) — read-only, removes nothing
      const warnRes = wtGc.runPostCloseWorktreeHygiene(mainRepo, { base: 'main' });
      assert.equal(warnRes.mode, 'warn');
      assert.equal(warnRes.removed.length, 0);
      assert.equal(warnRes.pruned, false);
      assert.equal(fs.existsSync(cleanWt), true);
      assert.ok(warnRes.summary && warnRes.summary.prunable >= 1);

      // 3) auto_gc: 'prune' — prunes dead metadata without deleting existing cleanWt
      const pruneRes = wtGc.runPostCloseWorktreeHygiene(mainRepo, { worktree: { auto_gc: 'prune' }, base: 'main' });
      assert.equal(pruneRes.mode, 'prune');
      assert.equal(pruneRes.pruned, true);
      assert.equal(pruneRes.removed.length, 0);
      assert.equal(fs.existsSync(cleanWt), true);

      // 4) auto_gc: 'apply' — removes cleanWt, preserves providerWt (junction_target_in_use) and activeWt
      const applyRes = wtGc.runPostCloseWorktreeHygiene(mainRepo, { worktree: { auto_gc: 'apply' }, base: 'main' });
      assert.equal(applyRes.mode, 'apply');
      assert.equal(applyRes.pruned, true);
      assert.equal(applyRes.removed.length, 1);
      assert.equal(applyRes.removed[0].branch, 'feat/clean');
      assert.equal(fs.existsSync(cleanWt), false);
      assert.equal(fs.existsSync(providerWt), true);
      assert.equal(fs.existsSync(activeWt), true);

      // Verify runtimeProgramClose source invokes runPostCloseWorktreeHygiene and attaches worktree_hygiene
      const opSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'lib', 'oxe-operational.cjs'), 'utf8');
      assert.match(opSrc, /runPostCloseWorktreeHygiene/);
      assert.match(opSrc, /worktree_hygiene/);
    } finally {
      cleanupDirs(mainRepo, [activeWt, cleanWt, providerWt, deadWt]);
    }
  });

  it('OXB-222-13: CLI oxe-cc gc-worktrees --include-nested --ignore-agent-settings --json and doctor --project --json expose hygiene fields', () => {
    const mainRepo = mkGitRepo('oxe-a13-cli-');
    const nestedWt = path.join(mainRepo, '.claude', 'worktrees', 'agent-cli');
    try {
      fs.mkdirSync(path.join(mainRepo, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(mainRepo, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean', worktree: { warn_above: 0 } }));
      fs.mkdirSync(path.dirname(nestedWt), { recursive: true });
      execFileSync('git', ['worktree', 'add', '-b', 'claude/agent-cli', nestedWt, 'main'], { cwd: mainRepo, stdio: 'ignore' });
      fs.writeFileSync(path.join(nestedWt, '.claude', 'settings.local.json'), '{"allow":["Bash"]}\n');
      fs.mkdirSync(path.join(nestedWt, 'node_modules', 'x'), { recursive: true });

      const gcJson = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'gc-worktrees', '--merged', '--base', 'main', '--include-nested', '--ignore-agent-settings', '--dir', mainRepo, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(gcJson.oxeGcWorktreesSchema, 1);
      assert.equal(gcJson.dry_run, true);
      assert.equal(gcJson.candidates.length, 1);
      assert.equal(gcJson.candidates[0].nested_agent, true);
      assert.equal(gcJson.candidates[0].has_real_node_modules, true);

      const docJson = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'doctor', '--project', '--dir', mainRepo, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(docJson.ok, true);
      assert.ok(docJson.worktrees && docJson.worktrees.nested_agent === 1);
      assert.equal(docJson.worktrees.needs_gc, true);
      assert.ok(docJson.warnings.some((w) => /gc-worktrees/i.test(w)));
    } finally {
      cleanupDirs(mainRepo, [nestedWt]);
    }
  });
});
