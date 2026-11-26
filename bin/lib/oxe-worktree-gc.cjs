'use strict';

/**
 * 1.23.0 (OXB-G12): `oxe-cc gc-worktrees [--merged] [--base origin/main] [--apply|--dry-run] [--delete-branches]`
 * Safely cleans up merged, clean secondary git worktrees and runs `git worktree prune`.
 * Dry-run is the default; `--apply` executes removals. Never removes the main worktree, the current
 * worktree, or any worktree with uncommitted changes. Unlinks node_modules junctions before removal.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runGit(cwd, args, spawn = spawnSync) {
  const r = spawn('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

function normPath(p) {
  const abs = path.resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
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

function safeUnlinkNodeModules(wtPath) {
  const nm = path.join(wtPath, 'node_modules');
  try {
    const st = fs.lstatSync(nm);
    if (st.isSymbolicLink()) fs.unlinkSync(nm);
  } catch { /* absent or not a link */ }
}

/**
 * Inspects and optionally removes merged clean git worktrees.
 * @param {string} projectRoot
 * @param {{ base?: string, mergedOnly?: boolean, apply?: boolean, deleteBranches?: boolean, spawn?: Function }} [options]
 */
function gcWorktrees(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot);
  const apply = Boolean(options.apply);
  const mergedOnly = options.mergedOnly !== false;
  const listRes = runGit(rootAbs, ['worktree', 'list', '--porcelain'], spawn);
  if (!listRes.ok) throw new Error(`git worktree list falhou: ${listRes.stderr.trim()}`);
  const entries = parseWorktreeList(listRes.stdout);
  if (!entries.length) {
    return { ok: true, dry_run: !apply, base: null, candidates: [], removed: [], skipped: [], pruned: false };
  }
  const base = resolveBaseRef(rootAbs, options.base || null, spawn);
  const mainNorm = normPath(entries[0].path);
  const cwdNorm = normPath(rootAbs);

  const candidates = [];
  const skipped = [];
  const removed = [];
  const deletedBranches = [];

  for (let idx = 0; idx < entries.length; idx += 1) {
    const wt = entries[idx];
    const wtNorm = normPath(wt.path);
    if (idx === 0 || wtNorm === mainNorm) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'main_worktree' });
      continue;
    }
    if (wtNorm === cwdNorm) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'current_worktree' });
      continue;
    }
    if (wt.locked) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'locked' });
      continue;
    }
    if (wt.prunable || !fs.existsSync(wt.path)) {
      candidates.push({ path: wt.path, branch: wt.branch, head: wt.head, merged: true, prunable: true });
      continue;
    }
    // Check dirty working tree
    const stRes = runGit(wt.path, ['status', '--porcelain'], spawn);
    if (!stRes.ok) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'status_failed' });
      continue;
    }
    if (stRes.stdout.trim()) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'dirty' });
      continue;
    }
    // Check if merged into base
    const refToCheck = wt.head || wt.branch;
    const ancRes = refToCheck ? runGit(rootAbs, ['merge-base', '--is-ancestor', refToCheck, base], spawn) : { ok: false };
    const isMerged = ancRes.ok;
    if (mergedOnly && !isMerged) {
      skipped.push({ path: wt.path, branch: wt.branch, reason: 'not_merged' });
      continue;
    }
    candidates.push({ path: wt.path, branch: wt.branch, head: wt.head, merged: isMerged, prunable: false });
  }

  let pruned = false;
  if (apply) {
    for (const c of candidates) {
      if (!c.prunable) {
        safeUnlinkNodeModules(c.path);
        const rm = runGit(rootAbs, ['worktree', 'remove', c.path], spawn);
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

module.exports = {
  parseWorktreeList,
  gcWorktrees,
};
