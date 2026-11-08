'use strict';

/**
 * OXB-159: the executor's scratch space. Each task gets `.oxe/tmp/<task>/` (self-ignored by git), named in its prompt.
 * Scratch an attempt still writes in the repo root (`*.log`, `*.tsbuildinfo` by default, plus `executor.scratch_ignore`
 * from .oxe/config.json) does not count against the task's scope, and is removed when the attempt created it
 * (new and untracked — a file that existed or was dirty before the task is never touched).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_SCRATCH = ['*.log', '*.tsbuildinfo'];

/** A glob without `/` matches a file in the repo root only; with `/`, the path from the root (`**` crosses dirs). */
function scratchRegex(glob) {
  const g = String(glob).replace(/\\/g, '/').replace(/^\.?\//, '');
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i += 1; if (g[i + 1] === '/') i += 1; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`, 'i');
}

function scratchPatterns(projectRoot) {
  let extra = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8'));
    const list = cfg && cfg.executor && cfg.executor.scratch_ignore;
    if (Array.isArray(list)) extra = list.filter((x) => typeof x === 'string' && x.trim());
    if (cfg && cfg.executor && cfg.executor.scratch_ignore === false) return [];
  } catch { /* sem config */ }
  return [...DEFAULT_SCRATCH, ...extra];
}

function makeScratchMatcher(projectRoot) {
  const res = scratchPatterns(projectRoot).map(scratchRegex);
  return (p) => res.some((re) => re.test(String(p).replace(/\\/g, '/')));
}

/** `.oxe/tmp/<task>/`, created with a `.gitignore` that ignores the whole tmp tree. */
function ensureScratchDir(projectRoot, taskId) {
  const tmp = path.join(projectRoot, '.oxe', 'tmp');
  const dir = path.join(tmp, String(taskId).replace(/[^\w.-]/g, '_'));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const gi = path.join(tmp, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n', 'utf8');
  } catch { /* auxiliar */ }
  return dir;
}

function removeScratchDir(projectRoot, taskId) {
  try { fs.rmSync(path.join(projectRoot, '.oxe', 'tmp', String(taskId).replace(/[^\w.-]/g, '_')), { recursive: true, force: true }); } catch { /* */ }
}

/**
 * Splits the paths changed outside the scope into real violations and scratch; removes the scratch files the attempt
 * created (absent from the task's baseline snapshot and untracked).
 * @returns {{ outside: string[], scratch: string[], removed: string[] }}
 */
function splitScratch(projectRoot, paths, baseline, isScratch) {
  const outside = [];
  const scratch = [];
  for (const p of paths || []) (isScratch(p) ? scratch : outside).push(p);
  const removed = [];
  for (const p of scratch) {
    if (baseline && baseline.has(p)) continue; // existed dirty before the task
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', p], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (tracked.status === 0) continue;
    try { fs.rmSync(path.join(projectRoot, p), { force: true }); removed.push(p); } catch { /* */ }
  }
  return { outside, scratch, removed };
}

module.exports = { DEFAULT_SCRATCH, scratchRegex, scratchPatterns, makeScratchMatcher, ensureScratchDir, removeScratchDir, splitScratch };
