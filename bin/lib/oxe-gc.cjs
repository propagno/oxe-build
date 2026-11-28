'use strict';

/**
 * 1.23.0 (OXB-230-21): Safe Garbage Collector for `.oxe/` (`oxe-cc gc`).
 * Cleans ephemeral `.oxe/.cache/` and legacy root temporaries (`precheck-ws/`, `rollback-ws/`,
 * `tmp/`, `precheck-*.json`, `OXE-EVENTS.jsonl`), prunes empty optional directories, and applies
 * safe retention policies on `.oxe/runs/` and `.oxe/evidence/` while ALWAYS preserving the active
 * run, active session and any NTFS junction targets (`node_modules`).
 * Default mode is `--dry-run` (zero deletions unless `apply: true`).
 * Pure Node.js stdlib — zero external dependencies.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OPTIONAL_EMPTY_DIRS = [
  'capabilities',
  'codebase',
  'context',
  'dashboard',
  'investigations',
  'memory',
  'workstreams',
  'rollback-ws',
  'precheck-ws',
  'tmp',
  '.cache',
];

const LEGACY_TEMP_DIRS = ['precheck-ws', 'rollback-ws', 'tmp'];
const LEGACY_TEMP_FILES = [
  'precheck-cache.json',
  'precheck-last.json',
  'precheck-auto-last.json',
  'OXE-EVENTS.jsonl',
];

function isSymlinkOrJunction(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Safely unmounts a symlink or Windows NTFS directory junction without touching its target.
 */
function unmountJunctionSafe(linkPath) {
  if (!isSymlinkOrJunction(linkPath)) return true;
  try {
    if (process.platform === 'win32') {
      try {
        fs.rmdirSync(linkPath);
      } catch {
        fs.unlinkSync(linkPath);
      }
    } else {
      fs.unlinkSync(linkPath);
    }
  } catch {
    /* check below */
  }
  return !isSymlinkOrJunction(linkPath);
}

function measurePathBytes(targetPath) {
  let total = 0;
  try {
    const lst = fs.lstatSync(targetPath);
    if (lst.isSymbolicLink()) return 0;
    if (!lst.isDirectory()) return lst.size;
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      total += measurePathBytes(path.join(targetPath, entry.name));
    }
  } catch {
    return 0;
  }
  return total;
}

function removeWorktreeDirSafe(projectRoot, wtPath) {
  const nm = path.join(wtPath, 'node_modules');
  if (isSymlinkOrJunction(nm)) {
    const unmounted = unmountJunctionSafe(nm);
    if (!unmounted) return { removed: false, reason: 'junction_still_mounted' };
  }
  spawnSync('git', ['worktree', 'remove', '--force', wtPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (fs.existsSync(wtPath)) {
    // Double-check no symlink/junction remains before recursive rm
    if (isSymlinkOrJunction(nm)) return { removed: false, reason: 'junction_still_mounted' };
    try {
      fs.rmSync(wtPath, { recursive: true, force: true });
    } catch (err) {
      return { removed: false, reason: err && err.message ? err.message : 'rm_failed' };
    }
  }
  return { removed: !fs.existsSync(wtPath) };
}

function collectProtectedRunIds(oxeDir) {
  const ids = new Set();
  const readJson = (f) => {
    try {
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    } catch {
      return null;
    }
  };
  const activeRun = readJson(path.join(oxeDir, 'ACTIVE-RUN.json'));
  if (activeRun && activeRun.run_id) ids.add(String(activeRun.run_id));
  const rootProg = readJson(path.join(oxeDir, 'program', 'PROGRAM.json'));
  if (rootProg && Array.isArray(rootProg.phases)) {
    for (const p of rootProg.phases) if (p && p.run_id && p.status !== 'closed') ids.add(String(p.run_id));
  }
  const sessionsDir = path.join(oxeDir, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      for (const s of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const prog = readJson(path.join(sessionsDir, s.name, 'program', 'PROGRAM.json'));
        if (prog && Array.isArray(prog.phases)) {
          for (const p of prog.phases) if (p && p.run_id && p.status !== 'closed') ids.add(String(p.run_id));
        }
      }
    } catch { /* ignore */ }
  }
  return ids;
}

function removeEmptySubdirs(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) removeEmptySubdirs(path.join(dirPath, entry.name));
    }
    if (fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
  } catch { /* ignore */ }
}

/**
 * Audits and optionally cleans `.oxe/` temporaries, empty optional dirs, and stale runs/evidence.
 */
function runOxeGc(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const oxeDir = path.join(rootAbs, '.oxe');
  const apply = Boolean(options.apply);
  const lightweight = Boolean(options.lightweight);
  const keepRuns = Number.isInteger(options.keepRuns) && options.keepRuns >= 0 ? options.keepRuns : 10;
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays)) && Number(options.maxAgeDays) >= 0
    ? Number(options.maxAgeDays)
    : 14;

  const categories = {
    cache: [],
    legacy_temps: [],
    empty_dirs: [],
    runs: [],
    evidence: [],
  };
  const items = [];
  const skipped = [];
  let reclaimableBytes = 0;
  let reclaimedBytes = 0;
  let removedCount = 0;
  let prunedWorktree = false;

  if (!fs.existsSync(oxeDir)) {
    return {
      oxeGcSchema: 1,
      ok: true,
      dry_run: !apply,
      projectRoot: rootAbs,
      reclaimable_bytes: 0,
      reclaimed_bytes: 0,
      removed_count: 0,
      items,
      categories,
      skipped,
    };
  }

  const recordCandidate = (category, absPath, kind, reason) => {
    const rel = path.relative(rootAbs, absPath).replace(/\\/g, '/');
    const bytes = measurePathBytes(absPath);
    reclaimableBytes += bytes;
    const item = { category, path: rel, kind, bytes, reason, removed: false };
    items.push(item);
    categories[category].push(item);
    return item;
  };

  // 1. `.oxe/.cache/` entries
  const cacheDir = path.join(oxeDir, '.cache');
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      const full = path.join(cacheDir, entry.name);
      const isWorktreeParent = entry.isDirectory() && (entry.name === 'precheck-ws' || entry.name === 'rollback-ws');
      if (isWorktreeParent) {
        for (const child of fs.readdirSync(full, { withFileTypes: true })) {
          const wt = path.join(full, child.name);
          const item = recordCandidate('cache', wt, 'worktree', 'temporary precheck/rollback worktree in .cache');
          if (apply) {
            const res = removeWorktreeDirSafe(rootAbs, wt);
            if (res.removed) {
              item.removed = true;
              removedCount += 1;
              reclaimedBytes += item.bytes;
              prunedWorktree = true;
            } else {
              skipped.push({ path: item.path, reason: res.reason });
            }
          }
        }
        if (apply) {
          try { if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch { /* ignore */ }
        }
      } else {
        const item = recordCandidate('cache', full, entry.isDirectory() ? 'dir' : 'file', 'disposable cache artifact');
        if (apply) {
          try {
            fs.rmSync(full, { recursive: true, force: true });
            item.removed = true;
            removedCount += 1;
            reclaimedBytes += item.bytes;
          } catch (err) {
            skipped.push({ path: item.path, reason: err.message });
          }
        }
      }
    }
  }

  // 2. Legacy root temporaries (`.oxe/precheck-ws`, `.oxe/rollback-ws`, `.oxe/tmp`, `precheck-*.json`, `OXE-EVENTS.jsonl`)
  for (const name of LEGACY_TEMP_DIRS) {
    const full = path.join(oxeDir, name);
    if (!fs.existsSync(full)) continue;
    if (name === 'precheck-ws' || name === 'rollback-ws') {
      const children = fs.readdirSync(full, { withFileTypes: true });
      for (const child of children) {
        const wt = path.join(full, child.name);
        const item = recordCandidate('legacy_temps', wt, 'worktree', `legacy temporary worktree under .oxe/${name}/`);
        if (apply) {
          const res = removeWorktreeDirSafe(rootAbs, wt);
          if (res.removed) {
            item.removed = true;
            removedCount += 1;
            reclaimedBytes += item.bytes;
            prunedWorktree = true;
          } else {
            skipped.push({ path: item.path, reason: res.reason });
          }
        }
      }
      if (apply) {
        try { if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch { /* ignore */ }
      }
    } else {
      const item = recordCandidate('legacy_temps', full, 'dir', `legacy temporary directory .oxe/${name}/`);
      if (apply) {
        try {
          fs.rmSync(full, { recursive: true, force: true });
          item.removed = true;
          removedCount += 1;
          reclaimedBytes += item.bytes;
        } catch (err) {
          skipped.push({ path: item.path, reason: err.message });
        }
      }
    }
  }
  for (const name of LEGACY_TEMP_FILES) {
    const full = path.join(oxeDir, name);
    if (!fs.existsSync(full)) continue;
    const item = recordCandidate('legacy_temps', full, 'file', 'legacy temporary/dead file in .oxe/ root');
    if (apply) {
      try {
        fs.unlinkSync(full);
        item.removed = true;
        removedCount += 1;
        reclaimedBytes += item.bytes;
      } catch (err) {
        skipped.push({ path: item.path, reason: err.message });
      }
    }
  }

  // 3. Stale runs & evidence (skipped in lightweight post-phase-close mode)
  if (!lightweight) {
    const protectedRunIds = collectProtectedRunIds(oxeDir);

    // 3a. `.oxe/runs/`
    const runsDir = path.join(oxeDir, 'runs');
    if (fs.existsSync(runsDir)) {
      const runFiles = fs.readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && /^oxe-run-.*\.json$/i.test(e.name))
        .map((e) => {
          const full = path.join(runsDir, e.name);
          const id = e.name.replace(/\.json$/i, '');
          let mtimeMs = 0;
          try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
          return { id, full, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      let kept = 0;
      for (const rf of runFiles) {
        if (protectedRunIds.has(rf.id)) continue;
        if (kept < keepRuns) {
          kept += 1;
          continue;
        }
        const item = recordCandidate('runs', rf.full, 'file', `exceeds keepRuns=${keepRuns}`);
        const subDir = path.join(runsDir, rf.id);
        const subItem = fs.existsSync(subDir)
          ? recordCandidate('runs', subDir, 'dir', `run artifacts directory exceeding keepRuns=${keepRuns}`)
          : null;
        if (apply) {
          try {
            fs.unlinkSync(rf.full);
            item.removed = true;
            removedCount += 1;
            reclaimedBytes += item.bytes;
          } catch (err) {
            skipped.push({ path: item.path, reason: err.message });
          }
          if (subItem) {
            try {
              fs.rmSync(subDir, { recursive: true, force: true });
              subItem.removed = true;
              removedCount += 1;
              reclaimedBytes += subItem.bytes;
            } catch (err) {
              skipped.push({ path: subItem.path, reason: err.message });
            }
          }
        }
      }
    }

    // 3b. `.oxe/evidence/`
    const evDir = path.join(oxeDir, 'evidence');
    const cutoffMs = Date.now() - (maxAgeDays * 86400 * 1000);
    if (fs.existsSync(evDir)) {
      const walkEvidence = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (protectedRunIds.has(entry.name)) continue;
            walkEvidence(full);
          } else {
            let mtimeMs = Date.now();
            try { mtimeMs = fs.statSync(full).mtimeMs; } catch { continue; }
            if (mtimeMs < cutoffMs) {
              const item = recordCandidate('evidence', full, 'file', `older than maxAgeDays=${maxAgeDays} in evidence/`);
              if (apply) {
                try {
                  fs.unlinkSync(full);
                  item.removed = true;
                  removedCount += 1;
                  reclaimedBytes += item.bytes;
                } catch (err) {
                  skipped.push({ path: item.path, reason: err.message });
                }
              }
            }
          }
        }
      };
      walkEvidence(evDir);
      if (apply) removeEmptySubdirs(evDir);
    }
  }

  // 4. Empty optional directories
  for (const name of OPTIONAL_EMPTY_DIRS) {
    const full = path.join(oxeDir, name);
    if (!fs.existsSync(full)) continue;
    try {
      const stat = fs.lstatSync(full);
      if (!stat.isDirectory()) continue;
      if (fs.readdirSync(full).length === 0) {
        const item = recordCandidate('empty_dirs', full, 'dir', 'empty optional directory');
        if (apply) {
          fs.rmdirSync(full);
          item.removed = true;
          removedCount += 1;
        }
      }
    } catch { /* ignore */ }
  }

  if (apply && prunedWorktree) {
    spawnSync('git', ['worktree', 'prune'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
  }

  return {
    oxeGcSchema: 1,
    ok: true,
    dry_run: !apply,
    projectRoot: rootAbs,
    keep_runs: keepRuns,
    max_age_days: maxAgeDays,
    reclaimable_bytes: reclaimableBytes,
    reclaimed_bytes: reclaimedBytes,
    removed_count: removedCount,
    items,
    categories,
    skipped,
  };
}

/**
 * Lightweight best-effort cleanup run after `phase close`: cleans disposable worktrees & empty dirs only.
 */
function cleanupLightweightAfterPhaseClose(projectRoot) {
  try {
    return runOxeGc(projectRoot, { apply: true, lightweight: true });
  } catch {
    return { ok: false, skipped: true };
  }
}

module.exports = {
  OPTIONAL_EMPTY_DIRS,
  unmountJunctionSafe,
  measurePathBytes,
  runOxeGc,
  cleanupLightweightAfterPhaseClose,
};
