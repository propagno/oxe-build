'use strict';

/**
 * 1.21 · The project's environment is part of the preflight (OXB-006). In the oxespace worktree, `npm ci` with the
 * machine's Node 22.17 / npm 10.9 rebuilt better-sqlite3 with node-gyp and silently dropped it; the dependencies
 * asked for Node `^22.22.2 || ^24.15`. The cause only showed up in the native verify, after paid attempts.
 *
 * Reads `engines` (node/npm), `.nvmrc` / `.node-version`, `packageManager`, the lockfile and free memory, compares
 * them with the machine, and reports problems (block the execute) and warnings. No dependencies: a small semver
 * range matcher covers the forms package.json uses (^ ~ >= > <= < = x-ranges, spaces as AND, || as OR).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseVersion(text) {
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/i.exec(String(text || '').trim().replace(/^v/i, ''));
  if (!m) return null;
  const part = (v) => (v == null || /^[x*]$/i.test(v) ? null : Number(v));
  return { major: Number(m[1]), minor: part(m[2]), patch: part(m[3]) };
}

function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Comparators of one range term (e.g. "^22.22.2" → [>=22.22.2, <23.0.0]). */
function comparators(term) {
  const t = term.trim();
  if (!t || t === '*' || /^x$/i.test(t)) return [];
  const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/.exec(t);
  if (!m) return null;
  const op = m[1] || '';
  const v = parseVersion(m[2]);
  if (!v) return null;
  const full = { major: v.major, minor: v.minor ?? 0, patch: v.patch ?? 0 };
  if (op === '^') {
    const upper = v.major > 0 ? { major: v.major + 1, minor: 0, patch: 0 }
      : (v.minor ?? 0) > 0 ? { major: 0, minor: (v.minor ?? 0) + 1, patch: 0 } : { major: 0, minor: 0, patch: (v.patch ?? 0) + 1 };
    return [['>=', full], ['<', upper]];
  }
  if (op === '~') {
    const upper = v.minor == null ? { major: v.major + 1, minor: 0, patch: 0 } : { major: v.major, minor: v.minor + 1, patch: 0 };
    return [['>=', full], ['<', upper]];
  }
  if (op === '' || op === '=') {
    if (v.minor == null) return [['>=', full], ['<', { major: v.major + 1, minor: 0, patch: 0 }]];
    if (v.patch == null) return [['>=', full], ['<', { major: v.major, minor: v.minor + 1, patch: 0 }]];
    return [['=', full]];
  }
  return [[op, full]];
}

function satisfies(version, range) {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  if (!v) return false;
  const full = { major: v.major, minor: v.minor ?? 0, patch: v.patch ?? 0 };
  return String(range || '*').split('||').some((raw) => {
    // "1.2 - 2.3" (hyphen range) → ">=1.2 <=2.3"; ">= 10" (space after the operator) → ">=10".
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(raw);
    const alt = hyphen ? `>=${hyphen[1]} <=${hyphen[2]}` : raw.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    const terms = alt.trim().split(/\s+/).filter(Boolean);
    const comps = [];
    for (const term of terms) {
      const c = comparators(term);
      if (c == null) return false;
      comps.push(...c);
    }
    return comps.every(([op, target]) => {
      const r = cmp(full, target);
      return op === '>=' ? r >= 0 : op === '>' ? r > 0 : op === '<=' ? r <= 0 : op === '<' ? r < 0 : r === 0;
    });
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readFirstLine(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
  } catch {
    return null;
  }
}

function npmVersion(spawn = spawnSync) {
  const res = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['-v'], { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' });
  return res && res.status === 0 ? String(res.stdout || '').trim() : null;
}

/**
 * @param {string} projectRoot
 * @param {{ node?: string, npm?: string|null, freeMb?: number, minFreeMb?: number, spawn?: Function }} [machine]
 */
function checkProjectEnvironment(projectRoot, machine = {}) {
  const problems = [];
  const warnings = [];
  const node = machine.node || process.versions.node;
  const pkg = readJson(path.join(projectRoot, 'package.json'));
  const engines = pkg && pkg.engines && typeof pkg.engines === 'object' ? pkg.engines : {};
  let npm = machine.npm;
  const needsNpm = Boolean(engines.npm) || Boolean(pkg && /^npm@/.test(String(pkg.packageManager || '')));
  if (npm === undefined && needsNpm) npm = npmVersion(machine.spawn);

  if (engines.node && !satisfies(node, engines.node)) {
    problems.push(`node ${node} fora de engines.node "${engines.node}" — use a versão pedida (nvm/volta) antes do execute; um npm ci nesta versão pode recompilar ou descartar dependências nativas`);
  }
  if (engines.npm && npm && !satisfies(npm, engines.npm)) problems.push(`npm ${npm} fora de engines.npm "${engines.npm}"`);
  const nvmrc = readFirstLine(path.join(projectRoot, '.nvmrc')) || readFirstLine(path.join(projectRoot, '.node-version'));
  if (nvmrc && /\d/.test(nvmrc)) {
    const want = parseVersion(nvmrc);
    const have = parseVersion(node);
    const exact = want && want.patch != null;
    const ok = want && have && (exact ? cmp(have, want) === 0 : have.major === want.major && (want.minor == null || have.minor === want.minor));
    if (!ok) (engines.node ? warnings : problems).push(`node ${node} difere do .nvmrc/.node-version (${nvmrc})`);
  }
  // The direct dependencies' own engines (package-lock v2/v3): the oxespace case had no engines in package.json, but
  // better-sqlite3 and friends asked for Node ^22.22.2 || ^24.15.
  const lockDoc = readJson(path.join(projectRoot, 'package-lock.json'));
  const direct = new Set(Object.keys({ ...(pkg && pkg.dependencies), ...(pkg && pkg.devDependencies), ...(pkg && pkg.optionalDependencies) }));
  const depConflicts = [];
  if (lockDoc && lockDoc.packages && typeof lockDoc.packages === 'object') {
    for (const [key, meta] of Object.entries(lockDoc.packages)) {
      const name = key.startsWith('node_modules/') ? key.slice('node_modules/'.length) : null;
      if (!name || name.includes('/node_modules/') || !direct.has(name)) continue;
      const range = meta && meta.engines && typeof meta.engines === 'object' ? meta.engines.node : (meta && typeof meta.engines === 'string' ? meta.engines : null);
      if (range && !satisfies(node, range)) depConflicts.push(`${name}@${meta.version || '?'} (node ${range})`);
    }
  }
  if (depConflicts.length) {
    problems.push(`node ${node} fora do engines de ${depConflicts.length} dependência(s) direta(s): ${depConflicts.slice(0, 5).join(', ')}${depConflicts.length > 5 ? '…' : ''} — o npm ci pode recompilar/descartar módulos nativos em silêncio`);
  }
  const pm = pkg && typeof pkg.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@(.+)$/.exec(pkg.packageManager) : null;
  if (pm) {
    const lock = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lockb' }[pm[1]];
    if (lock && !fs.existsSync(path.join(projectRoot, lock))) warnings.push(`packageManager ${pm[1]} sem ${lock}`);
    if (pm[1] === 'npm' && npm) {
      const want = parseVersion(pm[2]);
      const have = parseVersion(npm);
      if (want && have && want.major !== have.major) warnings.push(`npm ${npm} difere de packageManager ${pkg.packageManager}`);
    }
  }
  const freeMb = machine.freeMb != null ? machine.freeMb : Math.round(os.freemem() / (1024 * 1024));
  const minFreeMb = machine.minFreeMb != null ? machine.minFreeMb : Number(process.env.OXE_EXECUTOR_MIN_FREE_MB) || 0;
  if (minFreeMb && freeMb < minFreeMb) warnings.push(`memória livre ${freeMb} MB < ${minFreeMb} MB (OXE_EXECUTOR_MIN_FREE_MB): o executor vai pausar`);

  // OXB-042: what the runtime strips from every child process (names only, never values).
  let scrubbedEnv = [];
  try {
    const runtime = require('../../lib/runtime/index.js');
    if (typeof runtime.scrubbedEnvNames === 'function') scrubbedEnv = runtime.scrubbedEnvNames(machine.env || process.env);
  } catch {
    scrubbedEnv = [];
  }
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    scrubbed_env: scrubbedEnv,
    toolchain: { node, npm: npm || null, platform: process.platform, arch: process.arch, free_mb: freeMb },
    wanted: { engines, nvmrc: nvmrc || null, packageManager: (pkg && pkg.packageManager) || null },
  };
}

module.exports = { checkProjectEnvironment, satisfies, parseVersion };
