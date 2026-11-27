'use strict';

/**
 * 1.22.2 (OXB-G12 + OXB-222-13): `oxe-cc gc-worktrees [--merged] [--base origin/main] [--apply|--dry-run]
 * [--delete-branches] [--include-nested] [--ignore-agent-settings]`
 * Safely cleans up merged, clean secondary git worktrees and runs `git worktree prune`.
 * Dry-run is the default; `--apply` executes removals.
 *
 * Safety invariants:
 *  - Never removes the main worktree, the current worktree, locked worktrees, or worktrees with real uncommitted changes.
 *  - Protects any candidate whose directory (or subdirectory, e.g. `node_modules`) is the target of an active
 *    NTFS junction or POSIX symlink from any kept worktree (transitive closure, `reason: 'junction_target_in_use'`).
 *  - Recursively unlinks shallow junctions/symlinks (depth <= 3) inside any worktree before removal so targets stay intact.
 *  - Exposes read-only `summarizeWorktreeHygiene` (used by `doctor --project` & `onboard`) and `runPostCloseWorktreeHygiene`
 *    (wired into `runtimeProgramClose` via `worktree.auto_gc`: `"warn"` | `"prune"` | `"apply"` | `false`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_SETTINGS_IGNORED_FILES = new Set([
  '.claude/settings.local.json',
]);

function runGit(cwd, args, spawn = spawnSync) {
  const r = spawn('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

function normPath(p) {
  let resolved = path.resolve(String(p || ''));
  try {
    resolved = fs.realpathSync(resolved);
  } catch { /* keep path.resolve when missing */ }
  const clean = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? clean.toLowerCase() : clean;
}

function isPathInside(childNorm, parentNorm) {
  if (!childNorm || !parentNorm) return false;
  return childNorm === parentNorm || childNorm.startsWith(`${parentNorm}/`);
}

function readMergedConfigQuiet(projectRoot) {
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const base = readJson(path.join(projectRoot, 'oxe.config.json'));
  const local = readJson(path.join(projectRoot, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object') ? local : ((base && typeof base === 'object') ? base : {});
}

function parseWorktreeList(porcelain) {
  const out = [];
  let cur = null;
  for (const rawLine of String(porcelain || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice(9).trim(), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
    } else if (cur) {
      if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === 'bare') cur.bare = true;
      else if (line === 'detached') cur.detached = true;
      else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
      else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function resolveBaseRef(root, requestedBase, spawn) {
  if (requestedBase) {
    const check = runGit(root, ['rev-parse', '--verify', '--quiet', `${requestedBase}^{commit}`], spawn);
    if (!check.ok) throw new Error(`ref base não encontrada: ${requestedBase}`);
    return requestedBase;
  }
  for (const cand of ['origin/main', 'main', 'origin/master', 'master']) {
    if (runGit(root, ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], spawn).ok) return cand;
  }
  throw new Error('nenhuma branch base (origin/main, main, origin/master, master) encontrada — passe --base <ref>');
}

/**
 * Collects all directory/file symlinks and NTFS junctions inside `wtPath` up to `maxDepth`,
 * without descending into `.git` or real `node_modules` directories.
 */
function collectJunctionReferences(wtPath, maxDepth = 3) {
  const refs = [];
  if (!wtPath || !fs.existsSync(wtPath)) return refs;
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      let lst;
      try {
        lst = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) {
        try {
          const rawTarget = fs.readlinkSync(full);
          const resolvedAbs = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(path.dirname(full), rawTarget);
          refs.push({ link: full, target: resolvedAbs, targetNorm: normPath(resolvedAbs) });
        } catch { /* ignore unreadable link */ }
      } else if (lst.isDirectory() && e.name !== 'node_modules') {
        walk(full, depth + 1);
      }
    }
  }
  walk(wtPath, 0);
  return refs;
}

/**
 * Unlinks all shallow symlinks and NTFS junctions inside `wtPath` (up to `maxDepth`)
 * before removing the worktree directory so target files in sibling/main repos are never touched.
 */
function safeUnlinkJunctions(wtPath, maxDepth = 3) {
  let count = 0;
  if (!wtPath || !fs.existsSync(wtPath)) return count;
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      let lst;
      try {
        lst = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) {
        try {
          fs.unlinkSync(full);
          count += 1;
        } catch {
          try {
            fs.rmdirSync(full);
            count += 1;
          } catch { /* ignore */ }
        }
      } else if (lst.isDirectory() && e.name !== 'node_modules') {
        walk(full, depth + 1);
      }
    }
  }
  walk(wtPath, 0);
  return count;
}

function hasRealNodeModules(wtPath) {
  if (!wtPath) return false;
  const nm = path.join(wtPath, 'node_modules');
  try {
    const st = fs.lstatSync(nm);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

function isNestedAgentWorktree(wtPath, mainPath) {
  const norm = normPath(wtPath);
  if (/\/(?:\.claude\/worktrees|\.worktrees)\//i.test(norm)) return true;
  if (mainPath) {
    const mainNorm = normPath(mainPath);
    if (norm !== mainNorm && norm.startsWith(`${mainNorm}/.`)) return true;
  }
  return false;
}

function parseDirtyPaths(porcelainStdout) {
  const paths = [];
  for (const rawLine of String(porcelainStdout || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = /^[ MADRCU?!]{2}\s+(.+)$/.exec(line);
    let p = m ? m[1].trim() : (line.length >= 3 ? line.slice(3).trim() : line.trim());
    if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      p = p.slice(1, -1);
    }
    if (p) paths.push(p.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return paths;
}

function isOnlyAgentSettingsDirty(porcelainStdout) {
  const dirtyPaths = parseDirtyPaths(porcelainStdout);
  if (!dirtyPaths.length) return false;
  return dirtyPaths.every((p) => AGENT_SETTINGS_IGNORED_FILES.has(p));
}

/**
 * On POSIX (Linux/macOS), `.gitignore` rules with a trailing slash (e.g. `node_modules/`, `e2e/out/`)
 * do not match symlinks to directories, so `git status --porcelain` reports them as untracked (`??`).
 * This helper checks if an untracked path is strictly a directory-symlink (or a directory containing
 * only such symlinks) whose directory form (`<rel>/`) IS ignored by git.
 */
function isIgnoredDirSymlinkTree(wtPath, relPath, spawn, depth = 0) {
  if (depth > 3) return false;
  const cleanRel = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!cleanRel) return false;
  const abs = path.join(wtPath, cleanRel);
  let lst;
  try { lst = fs.lstatSync(abs); } catch { return false; }
  if (lst.isSymbolicLink()) {
    return runGit(wtPath, ['check-ignore', '-q', `${cleanRel}/`], spawn).ok;
  }
  if (lst.isDirectory()) {
    let ents;
    try { ents = fs.readdirSync(abs); } catch { return false; }
    if (!ents.length || ents.length > 32) return false;
    return ents.every((name) => isIgnoredDirSymlinkTree(wtPath, `${cleanRel}/${name}`, spawn, depth + 1));
  }
  return false;
}

function filterIgnoredSymlinkStatus(wtPath, porcelainStdout, spawn) {
  const kept = [];
  for (const rawLine of String(porcelainStdout || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('?? ')) {
      let p = line.slice(3).trim();
      if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1);
      if (p && isIgnoredDirSymlinkTree(wtPath, p, spawn, 0)) continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Inspects and optionally removes merged clean git worktrees, protecting active junction targets.
 * @param {string} projectRoot
 * @param {{
 *   base?: string,
 *   mergedOnly?: boolean,
 *   apply?: boolean,
 *   deleteBranches?: boolean,
 *   includeNested?: boolean,
 *   ignoreAgentSettings?: boolean,
 *   spawn?: Function,
 * }} [options]
 */
function gcWorktrees(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot);
  const apply = Boolean(options.apply);
  const mergedOnly = options.mergedOnly !== false;
  const includeNested = Boolean(options.includeNested);
  const ignoreAgentSettings = Boolean(options.ignoreAgentSettings);
  const listRes = runGit(rootAbs, ['worktree', 'list', '--porcelain'], spawn);
  if (!listRes.ok) throw new Error(`git worktree list falhou: ${listRes.stderr.trim()}`);
  const entries = parseWorktreeList(listRes.stdout);
  if (!entries.length) {
    return { ok: true, dry_run: !apply, base: null, candidates: [], removed: [], deleted_branches: [], skipped: [], pruned: false };
  }
  const base = resolveBaseRef(rootAbs, options.base || null, spawn);
  const mainPath = entries[0].path;
  const mainNorm = normPath(mainPath);
  const cwdNorm = normPath(rootAbs);

  const provisionalCandidates = [];
  const skipped = [];
  const removed = [];
  const deletedBranches = [];

  for (let idx = 0; idx < entries.length; idx += 1) {
    const wt = entries[idx];
    const wtNorm = normPath(wt.path);
    const nestedAgent = idx > 0 && isNestedAgentWorktree(wt.path, mainPath);
    if (idx === 0 || wtNorm === mainNorm) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'main_worktree' });
      continue;
    }
    if (wtNorm === cwdNorm) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'current_worktree' });
      continue;
    }
    if (wt.locked) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'locked', nested_agent: nestedAgent });
      continue;
    }
    if (wt.prunable || !fs.existsSync(wt.path)) {
      provisionalCandidates.push({
        path: wt.path,
        branch: wt.branch,
        head: wt.head,
        merged: true,
        prunable: true,
        nested_agent: nestedAgent,
        has_real_node_modules: false,
      });
      continue;
    }
    // Check dirty working tree (ignoring POSIX symlinks whose `<path>/` form is gitignored)
    const stRes = runGit(wt.path, ['status', '--porcelain'], spawn);
    if (!stRes.ok) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'status_failed', nested_agent: nestedAgent });
      continue;
    }
    const filteredStatus = filterIgnoredSymlinkStatus(wt.path, stRes.stdout, spawn);
    const dirtyOut = filteredStatus.trim();
    let agentSettingsOnlyDirty = false;
    if (dirtyOut) {
      const canIgnoreSettings = ignoreAgentSettings && (!nestedAgent || includeNested) && isOnlyAgentSettingsDirty(filteredStatus);
      if (canIgnoreSettings) {
        agentSettingsOnlyDirty = true;
      } else {
        skipped.push({ path: wt.path, branch: wt.branch, reason: 'dirty', nested_agent: nestedAgent });
        continue;
      }
    }
    // Check if merged into base
    const refToCheck = wt.head || wt.branch;
    const ancRes = refToCheck ? runGit(rootAbs, ['merge-base', '--is-ancestor', refToCheck, base], spawn) : { ok: false };
    const isMerged = ancRes.ok;
    if (mergedOnly && !isMerged) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'not_merged', nested_agent: nestedAgent });
      continue;
    }
    if (nestedAgent && !includeNested && agentSettingsOnlyDirty) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'dirty', nested_agent: nestedAgent });
      continue;
    }
    provisionalCandidates.push({
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      merged: isMerged,
      prunable: false,
      nested_agent: nestedAgent,
      has_real_node_modules: hasRealNodeModules(wt.path),
      ...(agentSettingsOnlyDirty ? { agent_settings_only_dirty: true } : {}),
    });
  }

  // Transitive junction target protection: never remove any candidate whose directory (or subdir, e.g. node_modules)
  // is referenced by a symlink/junction inside a kept worktree.
  const keptMap = new Map();
  for (const s of skipped) {
    if (s.path && fs.existsSync(s.path)) {
      keptMap.set(normPath(s.path), { path: s.path, norm: normPath(s.path) });
    }
  }
  const refCache = new Map();
  const refsOf = (wtPath, wtNorm) => {
    if (!refCache.has(wtNorm)) refCache.set(wtNorm, collectJunctionReferences(wtPath, 3));
    return refCache.get(wtNorm);
  };

  let candidates = [...provisionalCandidates];
  let changed = true;
  while (changed) {
    changed = false;
    const nextCandidates = [];
    for (const c of candidates) {
      if (c.prunable || !fs.existsSync(c.path)) {
        nextCandidates.push(c);
        continue;
      }
      const cNorm = normPath(c.path);
      const dependents = [];
      for (const [kNorm, kEntry] of keptMap.entries()) {
        if (kNorm === cNorm) continue;
        const refs = refsOf(kEntry.path, kNorm);
        if (refs.some((r) => isPathInside(r.targetNorm, cNorm))) {
          dependents.push(kEntry.path);
        }
      }
      if (dependents.length) {
        skipped.push({
          path: c.path,
          branch: c.branch,
          reason: 'junction_target_in_use',
          dependents,
          nested_agent: Boolean(c.nested_agent),
        });
        keptMap.set(cNorm, { path: c.path, norm: cNorm });
        changed = true;
      } else {
        nextCandidates.push(c);
      }
    }
    candidates = nextCandidates;
  }

  let pruned = false;
  if (apply) {
    for (const c of candidates) {
      if (!c.prunable) {
        safeUnlinkJunctions(c.path, 3);
        const rmArgs = c.agent_settings_only_dirty
          ? ['worktree', 'remove', '--force', c.path]
          : ['worktree', 'remove', c.path];
        const rm = runGit(rootAbs, rmArgs, spawn);
        if (!rm.ok) {
          skipped.push({ path: c.path, branch: c.branch, reason: `remove_failed: ${rm.stderr.trim()}` });
          continue;
        }
      }
      removed.push(c);
      if (options.deleteBranches && c.branch && c.merged && !['main', 'master'].includes(c.branch)) {
        const del = runGit(rootAbs, ['branch', '-d', c.branch], spawn);
        if (del.ok) deletedBranches.push(c.branch);
      }
    }
    const pr = runGit(rootAbs, ['worktree', 'prune'], spawn);
    pruned = pr.ok;
  }

  return {
    ok: true,
    dry_run: !apply,
    base,
    candidates,
    removed,
    deleted_branches: deletedBranches,
    skipped,
    pruned,
  };
}

/**
 * Fast, strictly read-only, non-throwing worktree hygiene summary for `doctor --project`, `onboard`,
 * and `runtimeProgramClose` (`worktree.auto_gc: "warn"`).
 */
function summarizeWorktreeHygiene(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot);
  const cfg = readMergedConfigQuiet(rootAbs);
  const wtCfg = cfg && cfg.worktree && typeof cfg.worktree === 'object' ? cfg.worktree : {};
  const warnAbove = Number.isFinite(Number(options.warnAbove))
    ? Number(options.warnAbove)
    : (Number.isFinite(Number(wtCfg.warn_above)) ? Number(wtCfg.warn_above) : 5);

  const empty = {
    ok: true,
    git_repo: false,
    base: null,
    total: 0,
    secondary: 0,
    clean_merged: 0,
    prunable: 0,
    dirty: 0,
    not_merged: 0,
    protected_junction_targets: 0,
    nested_agent: 0,
    with_real_node_modules: 0,
    warn_above: warnAbove,
    needs_gc: false,
    protected_details: [],
  };

  const gitRootLib = require('./oxe-git-root.cjs');
  const gitRoot = gitRootLib.resolveProjectGitRoot(rootAbs, { spawn });
  if (!gitRoot) return empty;

  let listRes;
  try {
    listRes = runGit(rootAbs, ['worktree', 'list', '--porcelain'], spawn);
  } catch {
    return empty;
  }
  if (!listRes.ok) return empty;
  const entries = parseWorktreeList(listRes.stdout);
  if (entries.length <= 1) {
    return { ...empty, git_repo: true, total: entries.length };
  }

  const mainPath = entries[0].path;
  const secondaries = entries.slice(1);
  const nestedAgentCount = secondaries.filter((e) => isNestedAgentWorktree(e.path, mainPath)).length;
  const realNmCount = secondaries.filter((e) => !e.prunable && fs.existsSync(e.path) && hasRealNodeModules(e.path)).length;

  let gc = null;
  try {
    gc = gcWorktrees(rootAbs, {
      base: options.base || null,
      mergedOnly: true,
      apply: false,
      includeNested: true,
      ignoreAgentSettings: true,
      spawn,
    });
  } catch {
    const prunableOnly = secondaries.filter((e) => e.prunable || !fs.existsSync(e.path)).length;
    const needsGcFallback = secondaries.length > warnAbove || prunableOnly > 0 || nestedAgentCount > 0;
    return {
      ...empty,
      git_repo: true,
      total: entries.length,
      secondary: secondaries.length,
      prunable: prunableOnly,
      nested_agent: nestedAgentCount,
      with_real_node_modules: realNmCount,
      needs_gc: needsGcFallback,
    };
  }

  const cleanMerged = gc.candidates.filter((c) => !c.prunable).length;
  const prunable = gc.candidates.filter((c) => c.prunable).length;
  const protectedList = gc.skipped.filter((s) => s.reason === 'junction_target_in_use');
  const dirty = gc.skipped.filter((s) => s.reason === 'dirty').length;
  const notMerged = gc.skipped.filter((s) => s.reason === 'not_merged').length;
  const needsGc = (
    secondaries.length > warnAbove
    || prunable > 0
    || nestedAgentCount > 0
    || cleanMerged >= 3
    || (cleanMerged > 0 && realNmCount > 0)
  );

  return {
    ok: true,
    git_repo: true,
    base: gc.base,
    total: entries.length,
    secondary: secondaries.length,
    clean_merged: cleanMerged,
    prunable,
    dirty,
    not_merged: notMerged,
    protected_junction_targets: protectedList.length,
    nested_agent: nestedAgentCount,
    with_real_node_modules: realNmCount,
    warn_above: warnAbove,
    needs_gc: needsGc,
    protected_details: protectedList.map((p) => ({ path: p.path, dependents: p.dependents || [] })),
  };
}

/**
 * Post-close lifecycle hook for `runtimeProgramClose`, controlled by `worktree.auto_gc`:
 *  - `false` / `"off"` / `"none"`: disabled
 *  - `"warn"` (default): read-only hygiene summary (never deletes or mutates)
 *  - `"prune"`: runs `git worktree prune` (removes dead metadata only) + summary
 *  - `"apply"` / `true`: runs junction-safe `gcWorktrees({ mergedOnly: true, apply: true })`
 */
function runPostCloseWorktreeHygiene(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot);
  const cfg = readMergedConfigQuiet(rootAbs);
  const wtCfg = (options.worktree && typeof options.worktree === 'object')
    ? options.worktree
    : (cfg && cfg.worktree && typeof cfg.worktree === 'object' ? cfg.worktree : {});

  const rawMode = wtCfg.auto_gc !== undefined ? wtCfg.auto_gc : 'warn';
  if (rawMode === false || String(rawMode).toLowerCase() === 'off' || String(rawMode).toLowerCase() === 'none') {
    return { ok: true, mode: 'off', skipped: true, pruned: false, removed: [], summary: null };
  }
  const mode = rawMode === true ? 'apply' : String(rawMode).toLowerCase();

  if (mode === 'prune') {
    const pr = runGit(rootAbs, ['worktree', 'prune'], spawn);
    const summary = summarizeWorktreeHygiene(rootAbs, { base: options.base || null, warnAbove: wtCfg.warn_above, spawn });
    return { ok: true, mode: 'prune', skipped: false, pruned: pr.ok, removed: [], summary };
  }

  if (mode === 'apply') {
    const gc = gcWorktrees(rootAbs, {
      base: options.base || null,
      mergedOnly: true,
      apply: true,
      deleteBranches: Boolean(wtCfg.delete_branches),
      includeNested: Boolean(wtCfg.include_nested_agent),
      ignoreAgentSettings: Boolean(wtCfg.ignore_agent_settings),
      spawn,
    });
    const summary = summarizeWorktreeHygiene(rootAbs, { base: options.base || null, warnAbove: wtCfg.warn_above, spawn });
    return {
      ok: true,
      mode: 'apply',
      skipped: false,
      pruned: gc.pruned,
      removed: gc.removed,
      protected_junction_targets: gc.skipped.filter((s) => s.reason === 'junction_target_in_use').length,
      summary,
    };
  }

  const summary = summarizeWorktreeHygiene(rootAbs, { base: options.base || null, warnAbove: wtCfg.warn_above, spawn });
  return { ok: true, mode: 'warn', skipped: false, pruned: false, removed: [], summary };
}

module.exports = {
  parseWorktreeList,
  collectJunctionReferences,
  safeUnlinkJunctions,
  gcWorktrees,
  summarizeWorktreeHygiene,
  runPostCloseWorktreeHygiene,
};
