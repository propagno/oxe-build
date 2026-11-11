'use strict';

/**
 * OXB-101: regression over REAL programs. A snapshot is a frozen copy of a project's `.oxe/` core (SPEC, ROADMAP,
 * PLAN.json/MD, packs, config, program/, dossier/) — never runs/, caches, prompts or worktrees. Snapshots of a private
 * project stay OUTSIDE the oxe-build repository (they are the project's plans): `oxe-cc program snapshot --to <dir>
 * --name <f2>` writes `<dir>/<name>/.oxe/` and a baseline `expect.json`; `oxe-cc program regress --fixtures <dir>`
 * (before each RC) copies every snapshot to a temp dir and runs plan lint, the runtime compile, the dossier render and
 * a close dry-run, comparing with the baseline: a step that now crashes, or a count that moved (lint errors, compiled
 * nodes, close reasons), is a regression. `--update` rewrites the baselines after an intended change.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KEEP = ['SPEC.md', 'ROADMAP.md', 'PLAN.md', 'PLAN.json', 'IMPLEMENTATION-PACK.json', 'IMPLEMENTATION-PACK.md', 'FIXTURE-PACK.json', 'REFERENCE-ANCHORS.md', 'config.json', 'STATE.md', 'VISUAL-INPUTS.json', 'program', 'dossier', 'research', 'codebase', 'SYSTEM-DESIGN.md'];

function copyRec(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const n of fs.readdirSync(src)) copyRec(path.join(src, n), path.join(dst, n)); }
  else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
}

function snapshot(projectRoot, toDir, name) {
  if (!toDir || !name) throw new Error('use: oxe-cc program snapshot --to <pasta fora do repositório> --name <f2>');
  const target = path.resolve(toDir, name, '.oxe');
  const rel = path.relative(path.resolve(projectRoot), target);
  if (!rel.startsWith('..')) throw new Error('o snapshot de um programa fica FORA do repositório (são os planos do projeto): use --to <pasta externa>');
  const src = path.join(projectRoot, '.oxe');
  const copied = [];
  for (const n of KEEP) { const p = path.join(src, n); if (fs.existsSync(p)) { copyRec(p, path.join(target, n)); copied.push(n); } }
  return { dir: path.dirname(target), copied };
}

/** Runs the four steps over a copy of one snapshot; returns the measured shape. */
function measure(snapshotDir, op) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-regress-'));
  try {
    copyRec(path.join(snapshotDir, '.oxe'), path.join(work, '.oxe'));
    const git = (...a) => spawnSync('git', a, { cwd: work, encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(work, '.gitignore'), '.oxe/\n');
    git('init', '-q'); git('config', 'user.email', 'r@r'); git('config', 'user.name', 'r'); git('add', '-A'); git('commit', '-qm', 'snapshot', '--allow-empty');
    const step = (name, fn) => { try { return { step: name, ok: true, ...fn() }; } catch (err) { return { step: name, ok: false, error: String(err && err.message || err).split('\n')[0].slice(0, 300) }; } };
    const lint = step('plan lint', () => { const r = op.runtimePlanLint(work, null, { preflight: false }); return { errors: r.errors.length, warnings: r.warnings.length }; });
    const compile = step('compile', () => { const r = op.compileExecutionGraphFromArtifacts(work, null); const n = r && r.graph && r.graph.nodes; return { nodes: n ? (typeof n.size === 'number' ? n.size : Object.keys(n).length) : 0, validation_errors: (r && r.validationErrors || []).length }; });
    let program = null;
    try { program = require('./oxe-program.cjs').readProgram(path.join(work, '.oxe', 'program')); } catch { program = null; }
    const phase = program && (program.active_phase || ((program.phases || []).find((p) => p.status === 'closed') || {}).id);
    const dossier = step('dossier', () => { const r = op.runtimeDossier(work, null, { phase }); return { issues: (r && r.issues || []).length, pending: (r && r.pending || []).length }; });
    const close = step('close dry-run', () => {
      if (!program || !program.active_phase) return { skipped: 'sem fase ativa' };
      const r = op.runtimeProgramClose(work, null, { phase: program.active_phase, gates: false, commit: false, rollbackCheck: false, defects: false });
      return { closed: Boolean(r.closed), reasons: (r.gate && r.gate.reasons || []).length };
    });
    return { steps: [lint, compile, dossier, close] };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function compare(expect, got) {
  const out = [];
  for (const g of got.steps) {
    const e = (expect.steps || []).find((x) => x.step === g.step);
    if (!e) continue;
    if (e.ok && !g.ok) { out.push(`${g.step}: quebrou — ${g.error}`); continue; }
    for (const k of ['errors', 'nodes', 'issues', 'pending', 'reasons', 'closed']) if (e[k] !== undefined && g[k] !== undefined && e[k] !== g[k]) out.push(`${g.step}: ${k} ${e[k]} → ${g[k]}`);
  }
  return out;
}

function regress(fixturesDir, op, options = {}) {
  let names = [];
  try { names = fs.readdirSync(fixturesDir).filter((n) => fs.existsSync(path.join(fixturesDir, n, '.oxe'))); } catch { names = []; }
  if (!names.length) throw new Error(`nenhum snapshot em ${fixturesDir} (oxe-cc program snapshot --to ${fixturesDir} --name <f2>)`);
  const results = [];
  for (const n of names) {
    const dir = path.join(fixturesDir, n);
    const got = measure(dir, op);
    const expFile = path.join(dir, 'expect.json');
    let expect = null;
    try { expect = JSON.parse(fs.readFileSync(expFile, 'utf8')); } catch { expect = null; }
    if (!expect || options.update) { fs.writeFileSync(expFile, `${JSON.stringify(got, null, 2)}\n`); results.push({ name: n, baseline: options.update ? 'atualizada' : 'criada', regressions: [] }); continue; }
    results.push({ name: n, regressions: compare(expect, got), got });
  }
  return { results, ok: results.every((r) => !r.regressions.length) };
}

module.exports = { snapshot, measure, compare, regress, KEEP };
