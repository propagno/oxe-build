'use strict';

/**
 * OXB-163: machine-local files a fresh worktree does not have (gitignored, so `git worktree add` never brings them):
 * `mobile/android/local.properties` (sdk.dir), `.env.local`… F10's dry-verify failed every `:app:testDebugUnitTest`
 * line with "SDK location not found" until the file was created by hand.
 *
 * `.oxe/config.json`: `"worktree": { "copy_local": ["mobile/android/local.properties", ".env.local"] }`. Nothing is
 * copied by default (a local file can hold secrets — only what the project lists). Paths from the repo root; `*` and
 * `**` globs are allowed. A file is copied only when it exists in the source, is NOT tracked by git there, and the
 * destination does not have it (never overwritten).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratchRegex } = require('./oxe-scratch.cjs');

function copyLocalList(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8'));
    const list = cfg && cfg.worktree && cfg.worktree.copy_local;
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().replace(/\\/g, '/').replace(/^\.\//, '')) : [];
  } catch { return []; }
}

function expand(root, pattern) {
  if (!/[*?]/.test(pattern)) return [pattern];
  const re = scratchRegex(pattern);
  const out = [];
  let budget = 20000;
  const walk = (dir, rel, depth) => {
    if (depth > 8 || budget <= 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      budget -= 1;
      if (['node_modules', '.git', '.oxe', '.gradle', 'build', 'dist', 'out'].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r, depth + 1);
      else if (e.isFile() && re.test(r)) out.push(r);
    }
  };
  walk(root, '', 0);
  return out;
}

/**
 * Copies the listed machine-local files from `fromRoot` into `toRoot`.
 * @returns {{ copied: string[], skipped: Array<{ path: string, why: string }> }}
 */
function copyLocalFiles(fromRoot, toRoot, options = {}) {
  const list = options.list || copyLocalList(fromRoot);
  const copied = [];
  const skipped = [];
  for (const pattern of list) {
    for (const rel of expand(fromRoot, pattern)) {
      const src = path.join(fromRoot, rel);
      const dst = path.join(toRoot, rel);
      if (!fs.existsSync(src)) { skipped.push({ path: rel, why: 'não existe na origem' }); continue; }
      if (fs.existsSync(dst)) { skipped.push({ path: rel, why: 'já existe no destino' }); continue; }
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: fromRoot, encoding: 'utf8', windowsHide: true });
      if (tracked.status === 0) { skipped.push({ path: rel, why: 'versionado (já vem com a worktree)' }); continue; }
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied.push(rel);
      } catch (e) { skipped.push({ path: rel, why: String(e && e.message || e) }); }
    }
  }
  return { copied, skipped };
}

/** Environment errors a fresh worktree typically has (no machine-local config): never a plan problem. */
const LOCAL_ENV_ERROR_RE = /SDK location not found|ANDROID_HOME|ANDROID_SDK_ROOT|Define a valid SDK location|sdk\.dir/i;

module.exports = { copyLocalList, copyLocalFiles, LOCAL_ENV_ERROR_RE };
