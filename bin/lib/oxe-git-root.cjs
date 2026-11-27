'use strict';

/**
 * 1.22.2 (OXB-222-14): Safe project git root resolver & $HOME/.git hazard detector.
 * Prevents tools and tests running in non-git or temp directories under $HOME from silently
 * inheriting an accidental/empty `.git` folder in the user's home directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function normPath(p) {
  let resolved = path.resolve(String(p || ''));
  try {
    resolved = fs.realpathSync(resolved);
  } catch { /* keep path.resolve if missing */ }
  const clean = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? clean.toLowerCase() : clean;
}

function isPathInside(childNorm, parentNorm) {
  if (!childNorm || !parentNorm) return false;
  return childNorm === parentNorm || childNorm.startsWith(`${parentNorm}/`);
}

/**
 * Resolves the git top-level directory owned by `projectRoot`, or returns `null` when
 * `projectRoot` is not inside a real project git repo (rejecting inherited `$HOME/.git`
 * or ancestor git dirs outside `os.tmpdir()` when `projectRoot` is inside `os.tmpdir()`).
 *
 * @param {string} projectRoot
 * @param {{ spawn?: Function, homeDir?: string, tmpDir?: string }} [options]
 * @returns {string | null}
 */
function resolveProjectGitRoot(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(String(projectRoot || process.cwd()));
  if (!fs.existsSync(rootAbs)) return null;

  let res;
  try {
    res = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd: rootAbs,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    return null;
  }
  if (!res || res.status !== 0) return null;
  const topRaw = String(res.stdout || '').trim();
  if (!topRaw) return null;

  const rootNorm = normPath(rootAbs);
  const topNorm = normPath(topRaw);
  if (topNorm !== rootNorm && !fs.existsSync(path.join(rootAbs, '.git'))) {
    const homeNorm = normPath(options.homeDir || os.homedir());
    const tmpNorm = normPath(options.tmpDir || os.tmpdir());
    if (topNorm === homeNorm) return null;
    if (isPathInside(rootNorm, tmpNorm) && !isPathInside(topNorm, tmpNorm)) return null;
  }
  return path.resolve(topRaw);
}

/**
 * Detects whether the user's home directory contains an accidental `.git` directory/file
 * that could leak into non-git folders or temp directories under `$HOME`.
 *
 * @param {string} projectRoot
 * @param {{ homeDir?: string }} [options]
 * @returns {{ hazard: boolean, home_dir: string, home_git: string | null }}
 */
function detectHomeGitHazard(projectRoot, options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const homeGit = path.join(homeDir, '.git');
  const rootNorm = normPath(projectRoot || process.cwd());
  const homeNorm = normPath(homeDir);
  // If the project itself IS the home dir intentionally, do not warn as accidental hazard.
  if (rootNorm === homeNorm) {
    return { hazard: false, home_dir: homeDir, home_git: null };
  }
  const exists = fs.existsSync(homeGit);
  return {
    hazard: exists,
    home_dir: homeDir,
    home_git: exists ? homeGit : null,
  };
}

module.exports = {
  normPath,
  isPathInside,
  resolveProjectGitRoot,
  detectHomeGitHazard,
};
