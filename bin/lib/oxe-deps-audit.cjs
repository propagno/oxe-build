'use strict';

/**
 * OXB-127: audit the dependencies a task / phase changes. When the diff touches package.json or package-lock.json:
 *   (a) advisories: `npm audit --json --package-lock-only` on the base lockfile and on the new one; a high/critical that
 *       is NEW blocks (one already in the base does not);
 *   (b) every new package exists in the registry (`npm view <pkg> name`) and is not a near-miss of a popular name
 *       (edit distance 1); a non-existent name blocks;
 *   (c) native dependencies added / removed (lockfile `hasInstallScript`, `gypfile`) are listed, with the reminder to
 *       rebuild or test their presence.
 * Registry and audit go through injectable functions (tests use fakes; the real ones call npm).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const POPULAR = ['react', 'react-dom', 'lodash', 'express', 'axios', 'chalk', 'commander', 'typescript', 'vitest', 'jest', 'electron', 'zod', 'dayjs', 'moment', 'uuid', 'debug', 'yargs', 'webpack', 'vite', 'eslint', 'prettier', 'next', 'vue', 'svelte', 'rxjs', 'tslib', 'semver', 'glob', 'minimist', 'ws', 'node-fetch', 'dotenv', 'cross-env', 'request', 'colors', 'inquirer', 'ora', 'execa', 'fs-extra', 'rimraf', 'mkdirp', 'better-sqlite3', 'sqlite3', 'ssh2'];

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

function lev(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) for (let j = 1; j <= n; j += 1) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    // a swap of two neighbours is one typo (axois / axios)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

const depsOf = (pkg) => ({ ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}), ...((pkg && pkg.optionalDependencies) || {}) });
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

function nativeOf(lock) {
  const out = new Set();
  for (const [k, v] of Object.entries((lock && lock.packages) || {})) {
    if (!k || !v) continue;
    if (v.hasInstallScript || v.gypfile) out.add(k.replace(/^.*node_modules\//, ''));
  }
  return out;
}

function realRegistry(name) {
  const r = spawnSync('npm', ['view', name, 'name'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', timeout: 30000 });
  return r.status === 0 && String(r.stdout || '').trim() === name;
}

function realAudit(lockText) {
  if (!lockText) return {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-audit-'));
  try {
    const lock = parse(lockText) || {};
    const root = (lock.packages && lock.packages['']) || {};
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: root.name || 'x', version: root.version || '0.0.0', dependencies: root.dependencies || {}, devDependencies: root.devDependencies || {} }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), lockText);
    const r = spawnSync('npm', ['audit', '--json', '--package-lock-only'], { cwd: dir, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    const j = parse(r.stdout) || {};
    const out = {};
    for (const [name, v] of Object.entries(j.vulnerabilities || {})) {
      for (const via of v.via || []) if (via && typeof via === 'object') out[`${name}:${via.source || via.url || via.title}`] = { name, severity: via.severity || v.severity, id: via.source || via.url || null, title: via.title || null };
    }
    return out;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
}

/** @returns {{ ran: boolean, blocks: string[], new_packages, missing, lookalikes, new_advisories, native_added, native_removed }} */
function auditDeps(root, base, options = {}) {
  const changed = (git(root, ['diff', '--name-only', base, '--', 'package.json', 'package-lock.json']).stdout || '').split(/\r?\n/).filter(Boolean);
  const res = { ran: changed.length > 0, blocks: [], new_packages: [], missing: [], lookalikes: [], new_advisories: [], native_added: [], native_removed: [] };
  if (!res.ran) return res;
  const pkgBefore = parse(git(root, ['show', `${base}:package.json`]).stdout || '');
  let pkgNow = null;
  try { pkgNow = parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { pkgNow = null; }
  const before = depsOf(pkgBefore);
  const now = depsOf(pkgNow);
  res.new_packages = Object.keys(now).filter((n) => !(n in before));
  const registry = options.registry || realRegistry;
  for (const n of res.new_packages) {
    if (!registry(n)) { res.missing.push(n); res.blocks.push(`pacote ${n} não existe no registro`); continue; }
    const near = POPULAR.find((p) => p !== n && lev(p, n.replace(/^@[^/]+\//, '')) === 1);
    if (near) res.lookalikes.push({ name: n, like: near });
  }
  const lockBefore = git(root, ['show', `${base}:package-lock.json`]).stdout || '';
  let lockNow = '';
  try { lockNow = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'); } catch { lockNow = ''; }
  const audit = options.audit || realAudit;
  const advBefore = audit(lockBefore);
  const advNow = audit(lockNow);
  const blockOn = new Set(options.block || ['high', 'critical']);
  for (const [k, v] of Object.entries(advNow)) {
    if (k in advBefore) continue;
    res.new_advisories.push(v);
    if (blockOn.has(String(v.severity))) res.blocks.push(`advisory ${v.severity} nova em ${v.name}${v.id ? ` (${v.id})` : ''}${v.title ? `: ${v.title}` : ''}`);
  }
  const nb = nativeOf(parse(lockBefore));
  const nn = nativeOf(parse(lockNow));
  res.native_added = [...nn].filter((x) => !nb.has(x));
  res.native_removed = [...nb].filter((x) => !nn.has(x));
  return res;
}

function renderDeps(r) {
  if (!r.ran) return '# Dependências\n\nA fase não mexeu em package.json nem em package-lock.json.\n';
  const L = ['# Dependências', ''];
  L.push(`- Pacotes novos: ${r.new_packages.join(', ') || '—'}`);
  if (r.missing.length) L.push(`- **Inexistentes no registro:** ${r.missing.join(', ')}`);
  if (r.lookalikes.length) L.push(`- Parecidos com pacotes populares (confira): ${r.lookalikes.map((x) => `${x.name} ~ ${x.like}`).join(', ')}`);
  L.push(`- Advisories novas: ${r.new_advisories.map((a) => `${a.name} ${a.severity}${a.id ? ` (${a.id})` : ''}`).join(', ') || '—'}`);
  L.push(`- Nativas adicionadas: ${r.native_added.join(', ') || '—'} · removidas: ${r.native_removed.join(', ') || '—'}${r.native_added.length || r.native_removed.length ? ' — rode o rebuild (electron-rebuild/npm rebuild) e o teste de presença' : ''}`);
  if (r.blocks.length) L.push('', '## Bloqueia', '', ...r.blocks.map((b) => `- ${b}`));
  return `${L.join('\n')}\n`;
}

module.exports = { auditDeps, renderDeps, lev, nativeOf };
