'use strict';

/**
 * 1.23.0 (OXB-G06): `oxe-cc sync [--base origin/main] [--apply|--dry-run] [--verify "<cmd>"]`
 * Detects purely sequential resource collisions between the current branch and base:
 *   1. Numbered migrations (e.g. SQLite `106_foo.sql` / `0106_foo.ts`) -> deterministic auto-bump to `max + 1`
 *   2. Declared numeric ratchets (`lint.ratchets` / `sync.ratchets`) -> deterministic recalculation to real count
 * Dry-run is the default; `--apply` applies renames/updates and optionally runs `--verify`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envSanitize = require('./oxe-env-sanitize.cjs');

const DEFAULT_MIGRATION_DIRS = ['migrations', 'db/migrations', 'src/db/migrations', 'src/main/db/migrations', 'electron/db/migrations'];
const MIGRATION_NUM_RE = /^(\d+)([_-].+)$/;

function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMergedConfig(root) {
  const base = readJsonQuiet(path.join(root, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(root, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
}

function runGit(cwd, args, spawn = spawnSync) {
  const r = spawn('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

function resolveBase(root, requested, spawn) {
  if (requested) return requested;
  for (const cand of ['origin/main', 'main', 'origin/master', 'master']) {
    if (runGit(root, ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], spawn).ok) return cand;
  }
  throw new Error('nenhuma branch base encontrada — passe --base <ref>');
}

function detectMigrationDirs(root, cfg) {
  const syncCfg = cfg.sync && typeof cfg.sync === 'object' ? cfg.sync : {};
  const configured = [];
  if (Array.isArray(syncCfg.migrations)) {
    for (const m of syncCfg.migrations) {
      if (typeof m === 'string') configured.push(m);
      else if (m && typeof m.dir === 'string') configured.push(m.dir);
    }
  } else if (syncCfg.migrations && typeof syncCfg.migrations.dir === 'string') {
    configured.push(syncCfg.migrations.dir);
  }
  const cands = configured.length ? configured : DEFAULT_MIGRATION_DIRS;
  return cands.map((d) => d.replace(/\\/g, '/').replace(/\/+$/, '')).filter((d) => fs.existsSync(path.join(root, d)));
}

/**
 * Inspects numbered migrations in `migDir` comparing `<base>` tree vs current branch additions.
 */
function planMigrationBumps(root, base, migDir, spawn = spawnSync) {
  // Files present in base
  const baseLs = runGit(root, ['ls-tree', '-r', '--name-only', base, '--', migDir], spawn);
  const baseFiles = baseLs.ok ? baseLs.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const baseByNum = new Map();
  let maxNum = 0;
  let padWidth = 0;
  for (const rel of baseFiles) {
    const bn = path.posix.basename(rel);
    const m = MIGRATION_NUM_RE.exec(bn);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > maxNum) maxNum = n;
    if (m[1].length > padWidth) padWidth = m[1].length;
    baseByNum.set(n, rel);
  }

  // Files added on current branch vs merge-base(base, HEAD) + untracked files in migDir
  const mb = runGit(root, ['merge-base', base, 'HEAD'], spawn);
  const mbSha = mb.ok ? mb.stdout.trim() : base;
  const addedRes = runGit(root, ['diff', '--name-only', '--diff-filter=A', mbSha, 'HEAD', '--', migDir], spawn);
  const branchAdded = new Set(addedRes.ok ? addedRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);
  // Also include local working-tree additions not yet committed
  try {
    for (const name of fs.readdirSync(path.join(root, migDir))) {
      const rel = `${migDir}/${name}`;
      if (!baseFiles.includes(rel)) {
        const m = MIGRATION_NUM_RE.exec(name);
        if (m) branchAdded.add(rel);
      }
    }
  } catch { /* ignore */ }

  // Also track max number across branch additions
  for (const rel of branchAdded) {
    const m = MIGRATION_NUM_RE.exec(path.posix.basename(rel));
    if (m) {
      const n = Number(m[1]);
      if (n > maxNum) maxNum = n;
      if (m[1].length > padWidth) padWidth = m[1].length;
    }
  }

  const bumps = [];
  const sortedAdded = [...branchAdded].sort();
  for (const rel of sortedAdded) {
    const bn = path.posix.basename(rel);
    const m = MIGRATION_NUM_RE.exec(bn);
    if (!m) continue;
    const num = Number(m[1]);
    const collidingBase = baseByNum.get(num);
    if (!collidingBase || collidingBase === rel) continue;
    maxNum += 1;
    const nextDigits = padWidth > String(maxNum).length && m[1].startsWith('0')
      ? String(maxNum).padStart(padWidth, '0')
      : String(maxNum);
    const nextRel = `${migDir}/${nextDigits}${m[2]}`;
    bumps.push({
      dir: migDir,
      from: rel,
      to: nextRel,
      old_number: num,
      new_number: maxNum,
      collided_with: collidingBase,
    });
  }
  return bumps;
}

/**
 * Inspects declared ratchets (`lint.ratchets` + `sync.ratchets`) and proposes cap recalculations.
 */
function planRatchetSync(root, cfg) {
  const ratchetsLib = require('./oxe-ratchets.cjs');
  const syncCfg = cfg.sync && typeof cfg.sync === 'object' ? cfg.sync : {};
  const mergedCfg = {
    ...cfg,
    lint: {
      ...(cfg.lint || {}),
      ratchets: [
        ...((cfg.lint && Array.isArray(cfg.lint.ratchets)) ? cfg.lint.ratchets : []),
        ...(Array.isArray(syncCfg.ratchets) ? syncCfg.ratchets : []),
      ],
    },
  };
  const ratchets = ratchetsLib.ratchetsOf(mergedCfg);
  const updates = [];
  for (const r of ratchets) {
    const abs = path.join(root, r.file);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const cap = ratchetsLib.capOf(text, r);
    if (!cap) continue;
    const realCount = ratchetsLib.countOf(root, r);
    if (cap.value === realCount) continue;
    updates.push({
      file: r.file.replace(/\\/g, '/'),
      line: cap.line,
      from: cap.value,
      to: realCount,
      index: cap.index,
      length: cap.length,
    });
  }
  return updates;
}

/**
 * OXB-G06: Detects and optionally applies deterministic auto-bumps for sequential migrations & ratchets.
 */
function syncSequentialResources(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot);
  const spawn = options.spawn || spawnSync;
  const apply = Boolean(options.apply);
  const cfg = options.config || readMergedConfig(rootAbs);
  const base = resolveBase(rootAbs, options.base || null, spawn);

  const migDirs = detectMigrationDirs(rootAbs, cfg);
  const migrationBumps = [];
  for (const d of migDirs) {
    migrationBumps.push(...planMigrationBumps(rootAbs, base, d, spawn));
  }
  const ratchetUpdates = planRatchetSync(rootAbs, cfg);

  const appliedMigrations = [];
  const appliedRatchets = [];

  if (apply) {
    for (const b of migrationBumps) {
      const fromAbs = path.join(rootAbs, b.from);
      const toAbs = path.join(rootAbs, b.to);
      if (!fs.existsSync(fromAbs)) continue;
      // Update internal numeric version tag if the file declares `version: <old>` or `MIGRATION_<old>`
      try {
        const content = fs.readFileSync(fromAbs, 'utf8');
        const patched = content.replace(
          new RegExp(`(\\b(?:version|migration(?:_?version|_?id)?)\\s*[:=]\\s*)${b.old_number}\\b`, 'gi'),
          `$1${b.new_number}`
        );
        if (patched !== content) fs.writeFileSync(fromAbs, patched, 'utf8');
      } catch { /* binary/unreadable */ }
      const mv = runGit(rootAbs, ['mv', b.from, b.to], spawn);
      if (!mv.ok) fs.renameSync(fromAbs, toAbs);
      appliedMigrations.push(b);
    }
    // Re-plan ratchets right before applying (in case migration rename changed anything)
    const freshRatchets = planRatchetSync(rootAbs, cfg);
    for (const u of freshRatchets) {
      const abs = path.join(rootAbs, u.file);
      const text = fs.readFileSync(abs, 'utf8');
      const next = text.slice(0, u.index) + String(u.to) + text.slice(u.index + u.length);
      fs.writeFileSync(abs, next, 'utf8');
      appliedRatchets.push({ file: u.file, line: u.line, from: u.from, to: u.to });
    }
  }

  let verify = null;
  if (apply && options.verify) {
    const isWin = process.platform === 'win32';
    const { env } = envSanitize.sanitizeEnv(process.env, cfg);
    const vr = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', options.verify] : ['-c', options.verify], {
      cwd: rootAbs,
      env,
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: isWin,
      timeout: 300_000,
    });
    verify = { command: options.verify, ok: vr.status === 0, exit: vr.status };
  }

  return {
    ok: !verify || verify.ok,
    dry_run: !apply,
    base,
    migration_bumps: migrationBumps,
    ratchet_updates: ratchetUpdates.map(({ file, line, from, to }) => ({ file, line, from, to })),
    applied_migrations: appliedMigrations,
    applied_ratchets: appliedRatchets,
    verify,
  };
}

module.exports = {
  planMigrationBumps,
  planRatchetSync,
  syncSequentialResources,
};
