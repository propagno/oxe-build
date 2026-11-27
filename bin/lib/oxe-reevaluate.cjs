'use strict';

/**
 * 1.22.2 (OXB-222-18): Continuous solution re-evaluation (`oxe-cc reevaluate [--against <ref>]`).
 * Compares commits landed on the base branch since `phase.base_commit` (or merge-base) against
 * pending tasks in `PLAN.json` / `IMPLEMENTATION-PACK.json` and classifies each task into:
 *  - `no_impact`: disjoint files and sequential resources
 *  - `mechanical_sync`: migration/ratchet/version-pin collision solvable by `oxe-cc sync --apply`
 *  - `contract_drift`: upstream changed files/contracts touched by the task -> focused CR recommended
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectGitRoot } = require('./oxe-git-root.cjs');

const MIGRATION_FILE_RE = /(?:^|\/)(?:migrations|db\/migrations)\/\d+[^/]*$/i;

function runGit(cwd, args, spawn = spawnSync) {
  const r = spawn('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r && r.status === 0, stdout: String((r && r.stdout) || ''), stderr: String((r && r.stderr) || '') };
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function normRel(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function resolveBase(root, requested, spawn) {
  if (requested) {
    const chk = runGit(root, ['rev-parse', '--verify', '--quiet', `${requested}^{commit}`], spawn);
    if (!chk.ok) throw new Error(`ref base não encontrada: ${requested}`);
    return requested;
  }
  for (const cand of ['origin/main', 'main', 'origin/master', 'master']) {
    if (runGit(root, ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], spawn).ok) return cand;
  }
  throw new Error('nenhuma branch base encontrada — informe --against <ref>');
}

function isSequentialResourcePath(relPath, config = {}) {
  const p = normRel(relPath);
  if (MIGRATION_FILE_RE.test(p)) return true;
  const syncCfg = config.sync && typeof config.sync === 'object' ? config.sync : {};
  const pins = Array.isArray(syncCfg.version_pins) ? syncCfg.version_pins : [];
  if (pins.some((pin) => pin && normRel(pin.file) === p)) return true;
  const ratchets = config.lint && Array.isArray(config.lint.ratchets) ? config.lint.ratchets : [];
  if (ratchets.some((r) => r && normRel(r.file) === p)) return true;
  return false;
}

function migrationDirOf(relPath) {
  const p = normRel(relPath);
  if (!MIGRATION_FILE_RE.test(p)) return null;
  return path.posix.dirname(p);
}

/**
 * Evaluates upstream drift on `base` against pending plan tasks in `projectRoot`.
 */
function reevaluateAgainstBase(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const gitRoot = resolveProjectGitRoot(rootAbs, { spawn });
  if (!gitRoot) {
    return {
      ok: false,
      error: 'repositório git não encontrado para reevaluate',
      base: null,
      since: null,
      upstream_commits_count: 0,
      upstream_changed_files: [],
      overall_status: 'error',
      tasks: [],
      summary: { no_impact: 0, mechanical_sync: 0, contract_drift: 0 },
    };
  }

  const base = resolveBase(rootAbs, options.against || options.base || null, spawn);
  const cfg = {
    ...(readJsonQuiet(path.join(rootAbs, 'oxe.config.json')) || {}),
    ...(readJsonQuiet(path.join(rootAbs, '.oxe', 'config.json')) || {}),
  };

  // Resolve `since` commit: explicit `--since`, active phase `base_commit`, or merge-base(HEAD, base)
  let since = options.since || null;
  if (!since) {
    const mb = runGit(rootAbs, ['merge-base', 'HEAD', base], spawn);
    if (mb.ok && mb.stdout.trim()) since = mb.stdout.trim();
  }
  if (!since) throw new Error(`não foi possível determinar commit base comum com ${base} — informe --since <sha>`);

  const logRes = runGit(rootAbs, ['log', '--oneline', `${since}..${base}`], spawn);
  const commits = logRes.ok ? logRes.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const diffRes = runGit(rootAbs, ['diff', '--name-only', `${since}..${base}`], spawn);
  const upstreamChanged = diffRes.ok
    ? [...new Set(diffRes.stdout.split(/\r?\n/).map(normRel).filter(Boolean))].sort()
    : [];
  const upstreamSet = new Set(upstreamChanged);
  const upstreamMigrationDirs = new Set(upstreamChanged.map(migrationDirOf).filter(Boolean));

  const planDoc = readJsonQuiet(path.join(rootAbs, '.oxe', 'PLAN.json')) || { tasks: [], acceptance_tests: [] };
  const pendingTasks = (Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter((t) => t && !t.done);
  const evaluated = [];

  for (const t of pendingTasks) {
    const taskFiles = [
      ...(Array.isArray(t.files) ? t.files : []),
      ...(Array.isArray(t.read_only) ? t.read_only : []),
      ...(Array.isArray(t.reads) ? t.reads : []),
    ].map(normRel).filter(Boolean);

    const directOverlaps = [];
    const mechanicalReasons = [];
    for (const tf of taskFiles) {
      const exactOrDirHit = upstreamChanged.filter((uf) => uf === tf || uf.startsWith(`${tf}/`) || tf.startsWith(`${uf}/`));
      if (exactOrDirHit.length) {
        if (exactOrDirHit.every((uf) => isSequentialResourcePath(uf, cfg))) {
          mechanicalReasons.push(...exactOrDirHit.map((uf) => `recurso sequencial tocado na base: ${uf}`));
        } else {
          directOverlaps.push(...exactOrDirHit.filter((uf) => !isSequentialResourcePath(uf, cfg)));
        }
      }
      const mDir = migrationDirOf(tf);
      if (mDir && upstreamMigrationDirs.has(mDir)) {
        mechanicalReasons.push(`nova migração na base em ${mDir}/ (possível colisão de número com ${tf})`);
      }
    }

    // Also check if frozen acceptance test files for task's criteria were touched upstream
    const critSet = new Set(Array.isArray(t.acceptance) ? t.acceptance : []);
    for (const at of Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : []) {
      if (!at || !critSet.has(at.criterion)) continue;
      for (const af of Array.isArray(at.files) ? at.files : []) {
        const nf = normRel(af);
        if (upstreamSet.has(nf)) directOverlaps.push(nf);
      }
    }

    const uniqDirect = [...new Set(directOverlaps)];
    const uniqMech = [...new Set(mechanicalReasons)];
    let classification = 'no_impact';
    let recommendedAction = 'seguir execução normal';

    if (uniqDirect.length) {
      classification = 'contract_drift';
      recommendedAction = `oxe-cc runtime feedback --class constraint --tasks ${t.id} --summary "Upstream ${base} alterou ${uniqDirect.slice(0, 3).join(', ')}"`;
    } else if (uniqMech.length) {
      classification = 'mechanical_sync';
      recommendedAction = `oxe-cc sync --base ${base} --apply`;
    }

    evaluated.push({
      id: t.id,
      title: t.title || '',
      classification,
      overlapping_files: uniqDirect,
      mechanical_reasons: uniqMech,
      affected_criteria: Array.isArray(t.acceptance) ? t.acceptance : [],
      recommended_action: recommendedAction,
    });
  }

  const summary = {
    no_impact: evaluated.filter((x) => x.classification === 'no_impact').length,
    mechanical_sync: evaluated.filter((x) => x.classification === 'mechanical_sync').length,
    contract_drift: evaluated.filter((x) => x.classification === 'contract_drift').length,
  };
  const overallStatus = summary.contract_drift > 0
    ? 'replan_recommended'
    : summary.mechanical_sync > 0
      ? 'mechanical_sync_needed'
      : 'clean';

  return {
    ok: true,
    base,
    since,
    upstream_commits_count: commits.length,
    upstream_commits_sample: commits.slice(0, 10),
    upstream_changed_files: upstreamChanged,
    overall_status: overallStatus,
    tasks: evaluated,
    summary,
  };
}

module.exports = {
  reevaluateAgainstBase,
  isSequentialResourcePath,
};
