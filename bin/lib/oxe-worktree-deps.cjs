'use strict';

/**
 * 1.23.0 (OXB-G03 + OXB-G15): Safe `node_modules` junction/symlink provisioning for parallel worktrees
 * with SHA-256 `package-lock.json` hash validation and package integrity verification.
 *
 * Config in `oxe.config.json` or `.oxe/config.json`:
 *   "worktree": {
 *     "linkNodeModules": true | { "enabled": true, "from": "..", "validateLockfile": true, "validatePackages": true, "protected": [] }
 *   }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];

function sha256Normalized(filePath) {
  const buf = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(buf, 'utf8').digest('hex');
}

function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMergedConfig(projectRoot) {
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
}

function resolveMainWorktree(dir, spawn = spawnSync) {
  try {
    const r = spawn('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const common = String(r.stdout || '').trim();
      if (common) {
        const absCommon = path.resolve(dir, common);
        if (path.basename(absCommon).toLowerCase() === '.git') return path.dirname(absCommon);
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Extracts required top-level dependency package names from `package-lock.json` (lockfile v2/v3) or `package.json`,
 * and reports any packages missing inside `<sourceDir>/node_modules`.
 */
function findMissingPackages(sourceDir, targetDir) {
  const nmDir = path.join(sourceDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return { missing: ['<node_modules ausente>'], checked: 0 };
  const lockPath = path.join(targetDir, 'package-lock.json');
  const pkgPath = path.join(targetDir, 'package.json');
  const required = new Set();

  const lock = readJsonQuiet(lockPath);
  if (lock && lock.packages && typeof lock.packages === 'object') {
    for (const [k, meta] of Object.entries(lock.packages)) {
      if (!k || k === '') continue;
      if (meta && meta.optional) continue;
      // Only validate top-level node_modules/<pkg> entries to stay fast (<50ms) and catch missing direct/hoisted packages
      const m = /^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/.exec(k);
      if (m) required.add(m[1]);
    }
  }
  const pkg = readJsonQuiet(pkgPath);
  if (pkg && typeof pkg === 'object') {
    for (const section of ['dependencies', 'devDependencies']) {
      if (pkg[section] && typeof pkg[section] === 'object') {
        for (const name of Object.keys(pkg[section])) required.add(name);
      }
    }
  }
  const missing = [];
  for (const name of required) {
    const pkgDir = path.join(nmDir, ...name.split('/'));
    if (!fs.existsSync(pkgDir)) missing.push(name);
  }
  missing.sort();
  return { missing, checked: required.size };
}

/**
 * OXB-G15: Validates lockfile SHA-256 parity and package integrity between source worktree and target worktree.
 */
function validateNodeModulesJunction(sourceDir, targetDir, options = {}) {
  const srcAbs = path.resolve(sourceDir);
  const dstAbs = path.resolve(targetDir);
  const errors = [];
  const warnings = [];
  const srcNm = path.join(srcAbs, 'node_modules');
  if (!fs.existsSync(srcNm)) {
    errors.push(`node_modules ausente na origem (${srcAbs}) — rode \`npm ci\` na origem antes de linkar`);
  }
  let lockfile = null;
  let sourceHash = null;
  let targetHash = null;
  if (options.validateLockfile !== false) {
    for (const name of LOCKFILES) {
      const dstLock = path.join(dstAbs, name);
      if (!fs.existsSync(dstLock)) continue;
      lockfile = name;
      targetHash = sha256Normalized(dstLock);
      const srcLock = path.join(srcAbs, name);
      if (!fs.existsSync(srcLock)) {
        errors.push(`lockfile ${name} existe no destino (${dstAbs}), mas está ausente na origem (${srcAbs})`);
      } else {
        sourceHash = sha256Normalized(srcLock);
        if (sourceHash !== targetHash) {
          errors.push(`hash SHA-256 de ${name} diverge entre origem (${sourceHash.slice(0, 12)}) e destino (${targetHash.slice(0, 12)}) — atualize o node_modules de origem com \`npm ci\` ou use um cache compatível`);
        }
      }
      break;
    }
  }
  let missingPackages = [];
  let checkedPackages = 0;
  if (!errors.length && options.validatePackages !== false && fs.existsSync(srcNm)) {
    const res = findMissingPackages(srcAbs, dstAbs);
    missingPackages = res.missing;
    checkedPackages = res.checked;
    if (missingPackages.length) {
      errors.push(`${missingPackages.length} pacote(s) declarado(s) no lockfile/package.json ausente(s) em ${srcNm}: ${missingPackages.slice(0, 8).join(', ')}${missingPackages.length > 8 ? ` (+${missingPackages.length - 8})` : ''} — rode \`npm ci\` na origem`);
    }
  }
  return {
    ok: errors.length === 0,
    source: srcAbs,
    target: dstAbs,
    lockfile,
    source_sha256: sourceHash,
    target_sha256: targetHash,
    checked_packages: checkedPackages,
    missing_packages: missingPackages,
    errors,
    warnings,
  };
}

/**
 * Resolves `worktree.linkNodeModules` configuration for a project root.
 */
function worktreeLinkConfig(projectRoot) {
  const cfg = readMergedConfig(projectRoot);
  const wt = cfg.worktree && typeof cfg.worktree === 'object' ? cfg.worktree : {};
  const raw = wt.linkNodeModules;
  const enabled = raw === true || (raw && typeof raw === 'object' && raw.enabled !== false);
  const fromRaw = (raw && typeof raw === 'object' && typeof raw.from === 'string' && raw.from.trim())
    ? raw.from.trim()
    : (typeof cfg.deps_link_from === 'string' && cfg.deps_link_from.trim() ? cfg.deps_link_from.trim() : null);
  const protectedPaths = [
    ...(Array.isArray(cfg.deps_protected) ? cfg.deps_protected : []),
    ...((raw && typeof raw === 'object' && Array.isArray(raw.protected)) ? raw.protected : []),
  ].map((p) => path.resolve(projectRoot, String(p)));
  return {
    enabled,
    from: fromRaw ? path.resolve(projectRoot, fromRaw) : null,
    validateLockfile: !(raw && typeof raw === 'object' && raw.validateLockfile === false),
    validatePackages: !(raw && typeof raw === 'object' && raw.validatePackages === false),
    protected: protectedPaths,
  };
}

function samePathOrInside(a, b) {
  const norm = (p) => {
    try { return fs.realpathSync(p).replace(/\\/g, '/').toLowerCase(); } catch { return path.resolve(p).replace(/\\/g, '/').toLowerCase(); }
  };
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.startsWith(`${nb}/`);
}

/**
 * OXB-G03 + OXB-G15: Validates lockfile & packages and creates a directory junction (Windows) or symlink (POSIX)
 * for `<targetDir>/node_modules` pointing to `<sourceDir>/node_modules`.
 */
function linkNodeModules(targetDir, options = {}) {
  const dstAbs = path.resolve(targetDir);
  const wtCfg = worktreeLinkConfig(dstAbs);
  const srcAbs = options.from
    ? path.resolve(dstAbs, options.from)
    : (wtCfg.from || resolveMainWorktree(dstAbs, options.spawn || spawnSync));
  if (!srcAbs) {
    return { ok: false, linked: false, errors: ['origem do node_modules não encontrada: passe --from <pasta> ou configure worktree.linkNodeModules.from'] };
  }
  if (samePathOrInside(dstAbs, srcAbs) && path.resolve(dstAbs).toLowerCase() === path.resolve(srcAbs).toLowerCase()) {
    return { ok: true, linked: false, skipped: 'same_directory', source: srcAbs, target: dstAbs, errors: [] };
  }
  const hitProtected = wtCfg.protected.find((p) => samePathOrInside(srcAbs, p) || samePathOrInside(p, srcAbs));
  if (hitProtected && !options.force) {
    return { ok: false, linked: false, source: srcAbs, target: dstAbs, errors: [`origem protegida (deps_protected: ${hitProtected})`] };
  }
  const validation = validateNodeModulesJunction(srcAbs, dstAbs, {
    validateLockfile: options.validateLockfile != null ? options.validateLockfile : wtCfg.validateLockfile,
    validatePackages: options.validatePackages != null ? options.validatePackages : wtCfg.validatePackages,
  });
  if (!validation.ok && !options.force) {
    return { ...validation, linked: false };
  }
  if (options.checkOnly) {
    return { ...validation, linked: false, check_only: true };
  }
  const dstNm = path.join(dstAbs, 'node_modules');
  const srcNm = path.join(srcAbs, 'node_modules');
  try {
    const stat = fs.lstatSync(dstNm);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(dstNm);
    } else if (!options.force) {
      return {
        ...validation,
        ok: false,
        linked: false,
        errors: [`${dstNm} já existe como diretório real (não link) — remova-o ou passe --force`],
      };
    } else {
      fs.rmSync(dstNm, { recursive: true, force: true });
    }
  } catch { /* absent */ }
  fs.symlinkSync(srcNm, dstNm, process.platform === 'win32' ? 'junction' : 'dir');
  return {
    ...validation,
    ok: true,
    linked: true,
    link_type: process.platform === 'win32' ? 'junction' : 'dir',
    link_path: dstNm,
  };
}

module.exports = {
  sha256Normalized,
  findMissingPackages,
  validateNodeModulesJunction,
  worktreeLinkConfig,
  linkNodeModules,
};
