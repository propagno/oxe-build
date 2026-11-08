'use strict';

/**
 * 1.21.2 (OXB-050): `runtime execute --parallel-mutating` — the mutating tasks of a wave with disjoint scopes run at
 * the same time, each in its own git worktree, and are integrated one at a time into the program checkout.
 *
 * `.oxe/config.json`:
 *   "parallel": { "max": 2, "min_free_mb": 1536 },      // agents at once; free memory to start another one
 *   "deps_strategy": "link" | "copy-from" | "ci" | "none",
 *   "deps_link_from": ".",                              // link/copy-from source: a checkout with a validated node_modules
 *   "deps_protected": ["C:/Users/me/src/oxespace"]      // never used as a source (e.g. the person's main checkout)
 *
 * Safety (TECH LEAD constraints):
 *   - link source is explicit (`deps_link_from`) and never a protected path;
 *   - in `link` mode a task that changes package.json / package-lock.json or installs in its verify is refused before
 *     any paid turn (one task's install would write into every worktree's node_modules);
 *   - links are always removed before a worktree is removed (dispose, and a sweep of stale leases at start);
 *   - concurrency: `parallel.max` (default 2) and `parallel.min_free_mb` (or OXE_EXECUTOR_MIN_FREE_MB).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEP_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']);
const INSTALL_RE = /\b(npm|pnpm|yarn|bun)\s+(ci|install|i|add)\b/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function parallelConfig(projectRoot, options = {}) {
  const config = readJson(path.join(projectRoot, '.oxe', 'config.json')) || {};
  const p = config.parallel && typeof config.parallel === 'object' ? config.parallel : {};
  const envMin = Number(process.env.OXE_EXECUTOR_MIN_FREE_MB) || 0;
  return {
    maxParallel: Math.max(1, Number(options.maxParallel) || Number(p.max) || 2),
    minFreeMb: Number(p.min_free_mb) || envMin || 0,
    deps: {
      strategy: typeof config.deps_strategy === 'string' ? config.deps_strategy : null,
      from: typeof config.deps_link_from === 'string' && config.deps_link_from.trim() ? path.resolve(projectRoot, config.deps_link_from.trim()) : null,
      protected: (Array.isArray(config.deps_protected) ? config.deps_protected : []).map((p2) => path.resolve(projectRoot, String(p2))),
    },
  };
}

const samePath = (a, b) => {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const ra = real(a).replace(/\\/g, '/').toLowerCase();
  const rb = real(b).replace(/\\/g, '/').toLowerCase();
  return ra === rb || ra.startsWith(`${rb}/`);
};

/** Glob/prefix scope match for a relative path. */
function inScope(file, scope) {
  const f = String(file).replace(/\\/g, '/');
  for (const raw of scope || []) {
    const s = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!s) continue;
    if (/[*?[{]/.test(s)) {
      const re = new RegExp(`^${s.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')}$`);
      if (re.test(f)) return true;
    } else if (f === s || f.startsWith(`${s.replace(/\/+$/, '')}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Errors that refuse the parallel run before any paid turn.
 * @param {{ nodes: Array<{id:string, mutation_scope:string[], verify?:{command?:string}}>, checkpointCommits: boolean, dirty: string[] }} input
 */
function parallelPreconditions(projectRoot, cfg, input) {
  const errors = [];
  if (!input.checkpointCommits) errors.push('--parallel-mutating exige --checkpoint-commits: cada worktree nasce do HEAD, então o trabalho das tarefas e ondas anteriores precisa estar commitado');
  if (input.dirty.length) errors.push(`working tree com mudanças fora de .oxe/ (${input.dirty.slice(0, 5).join(', ')}) — as worktrees não as veriam; faça commit ou stash antes`);
  const strategy = cfg.deps.strategy;
  if (!strategy) errors.push('configure "deps_strategy" no .oxe/config.json para as worktrees: link | copy-from | ci | none (com link/copy-from, também "deps_link_from")');
  else if (!['link', 'copy-from', 'ci', 'none'].includes(strategy)) errors.push(`deps_strategy desconhecido: ${strategy} (use link | copy-from | ci | none)`);
  if (strategy === 'link' || strategy === 'copy-from') {
    if (!cfg.deps.from) errors.push(`deps_strategy ${strategy} exige "deps_link_from" explícito (a checkout cujo node_modules validado será usado; ex.: ".")`);
    else {
      if (!fs.existsSync(path.join(cfg.deps.from, 'node_modules'))) errors.push(`deps_link_from ${cfg.deps.from} não tem node_modules`);
      const hit = cfg.deps.protected.find((p) => samePath(cfg.deps.from, p) || samePath(p, cfg.deps.from));
      if (hit) errors.push(`deps_link_from ${cfg.deps.from} é um caminho protegido (deps_protected: ${hit}) — use a checkout do programa, nunca a principal`);
    }
  }
  if (strategy === 'link') {
    for (const node of input.nodes) {
      const touchesDeps = (node.mutation_scope || []).some((f) => DEP_FILES.has(path.posix.basename(String(f).replace(/\\/g, '/'))));
      const installs = INSTALL_RE.test(String((node.verify && node.verify.command) || ''));
      if (touchesDeps || installs) {
        errors.push(`${node.id}: ${touchesDeps ? 'muda package.json/lockfile' : 'instala dependências no verify'} — no deps_strategy link o node_modules é compartilhado; use deps_strategy copy-from ou ci para esta execução (ou rode a tarefa sem --parallel-mutating)`);
      }
    }
  }
  return errors;
}

function childEnv() {
  try {
    const runtime = require('../../lib/runtime/index.js');
    if (typeof runtime.childProcessEnv === 'function') return runtime.childProcessEnv(process.env);
  } catch { /* fallback */ }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Prepares a fresh worktree's dependencies. Throws (the lease is disposed) when the result is not usable. */
function prepareDeps(cfg, root) {
  const strategy = cfg.deps.strategy;
  if (!strategy || strategy === 'none') return;
  const target = path.join(root, 'node_modules');
  if (strategy === 'link') {
    // A directory junction on Windows, a dir symlink elsewhere; removed by unlinkExternalLinks before any dispose.
    fs.symlinkSync(path.join(cfg.deps.from, 'node_modules'), target, process.platform === 'win32' ? 'junction' : 'dir');
    return;
  }
  if (strategy === 'copy-from') {
    fs.cpSync(path.join(cfg.deps.from, 'node_modules'), target, { recursive: true, verbatimSymlinks: true });
    return;
  }
  if (strategy === 'ci') {
    const res = spawnSync('npm ci --no-audit --no-fund', { cwd: root, shell: true, encoding: 'utf8', windowsHide: true, env: childEnv(), timeout: 900_000, maxBuffer: 8 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`deps_strategy ci: npm ci falhou na worktree: ${String(res.stderr || res.stdout || '').trim().split(/\r?\n/).slice(-3).join(' · ')}`);
    // OXB-039: present after the install, and the project's native check.
    const env = require('./oxe-project-env.cjs');
    const lock = readJson(path.join(root, 'package-lock.json'));
    const missing = lock ? env.missingLockfilePackages(root, lock) : [];
    if (missing.length) throw new Error(`deps_strategy ci: pacotes do lockfile ausentes após o npm ci: ${missing.slice(0, 5).join(', ')}`);
  }
}

/**
 * Builds the scheduler's ParallelMutatingOptions.
 * @param {{ workingTreeChanges: (root:string)=>Array<{path:string,status:string}>, emit?: Function }} helpers
 */
function createParallelOptions(runtime, projectRoot, cfg, helpers) {
  const manager = new runtime.GitWorktreeManager(projectRoot, { prepare: (root) => prepareDeps(cfg, root) });
  return {
    maxParallel: cfg.maxParallel,
    minFreeMb: cfg.minFreeMb || undefined,
    freeMb: () => Math.round(os.freemem() / (1024 * 1024)),
    manager,
    integrate: (node, lease) => {
      const changes = helpers.workingTreeChanges(lease.root_path)
        .filter((c) => c.path && !c.path.startsWith('.oxe/') && c.path !== 'node_modules' && !c.path.startsWith('node_modules/'));
      const files = [];
      const outside = [];
      for (const change of changes) (inScope(change.path, node.mutation_scope) ? files : outside).push(change);
      if (cfg.deps.strategy === 'link' && files.some((c) => DEP_FILES.has(path.posix.basename(c.path)))) {
        return { ok: false, files: [], outside: outside.map((c) => c.path), error: 'a tarefa mudou package.json/lockfile com node_modules compartilhado (deps_strategy link)' };
      }
      for (const change of files) {
        const src = path.join(lease.root_path, change.path);
        const dst = path.join(projectRoot, change.path);
        if (change.status === 'D' || !fs.existsSync(src)) {
          fs.rmSync(dst, { force: true });
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
      }
      return { ok: true, files: files.map((c) => c.path), outside: outside.map((c) => c.path) };
    },
    discard: (files) => {
      for (const file of files) {
        const inHead = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`], { cwd: projectRoot, windowsHide: true }).status === 0;
        if (inHead) spawnSync('git', ['checkout', 'HEAD', '--', file], { cwd: projectRoot, windowsHide: true });
        else fs.rmSync(path.join(projectRoot, file), { force: true });
      }
    },
  };
}

module.exports = { parallelConfig, parallelPreconditions, createParallelOptions, prepareDeps, inScope, DEP_FILES };
