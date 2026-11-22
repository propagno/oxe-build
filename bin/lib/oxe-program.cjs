'use strict';

/**
 * OXE 1.19 — Programa por fases: persistência e artefatos do programa.
 *
 * `.oxe/[sessão/]program/`
 *   PROGRAM.json                 estado das fases (modelo em packages/runtime/src/program)
 *   regression/<fase>.json       checks executáveis congelados no fechamento da fase
 *   interfaces/<fase>.json       exports reais dos arquivos contratados da fase
 *
 * Funções puras sobre caminhos; o runtime compilado é injetado por quem chama.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function programPaths(programDir) {
  return {
    dir: programDir,
    program: path.join(programDir, 'PROGRAM.json'),
    regressionDir: path.join(programDir, 'regression'),
    interfacesDir: path.join(programDir, 'interfaces'),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readProgram(programDir) {
  const state = readJson(programPaths(programDir).program);
  return state && Array.isArray(state.phases) ? state : null;
}

function writeProgram(programDir, state) {
  writeJson(programPaths(programDir).program, state);
  return state;
}

function relativeRef(projectRoot, file) {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

/**
 * Checks executáveis que passaram na fase: viram regressão das fases seguintes.
 * Manuais e pulados ficam de fora (não provam nada); contratos de pack entram (arquivos e exports).
 */
function freezeRegressionChecks(checkResults, suite) {
  const passed = new Set(
    (Array.isArray(checkResults) ? checkResults : [])
      .filter((result) => result && result.status === 'pass')
      .map((result) => result.check_id),
  );
  const frozen = (suite && Array.isArray(suite.checks) ? suite.checks : []).filter((check) => {
    if (!check || check.regression_phase) return false;
    const executable = Boolean(check.command)
      || (Array.isArray(check.files_exist) && check.files_exist.length > 0)
      || (Array.isArray(check.exports_expected) && check.exports_expected.length > 0);
    return executable && passed.has(check.id);
  });
  // Bench B42: a whole-suite command (`npm test`) frozen as regression also runs the NEXT phase's frozen tests, still
  // red before its execute — F1 showed up "regressed" as soon as F2's tests were committed. A whole-suite check whose
  // criterion has a scoped check frozen too is dropped (the scoped one is the regression); the rest is marked.
  const refOf = (c) => String(c.acceptance_ref || '').toUpperCase();
  const scopedRefs = new Set(frozen.filter((c) => c.command && !isWholeSuiteCommand(c.command) && refOf(c)).map(refOf));
  return frozen
    .filter((c) => !(c.command && isWholeSuiteCommand(c.command) && refOf(c) && scopedRefs.has(refOf(c))))
    .map((c) => (c.command && isWholeSuiteCommand(c.command) ? { ...c, whole_suite: true } : c));
}

/** `npm test`, `node --test` with no path, `npx vitest run` with no file: runs every test of the repo. */
function isWholeSuiteCommand(command) {
  const cmd = String(command || '').trim().replace(/\s+/g, ' ');
  return /^(?:npm|pnpm|yarn)(?: run)? test(?: --)?$/.test(cmd)
    || /^node --test(?: --[\w-]+(?:=\S+)?)*$/.test(cmd)
    || /^npx (?:vitest(?: run)?|jest)(?: --[\w-]+(?:=\S+)?)*$/.test(cmd);
}

function isSafePhaseId(phaseId) {
  const s = typeof phaseId === 'string' ? phaseId.trim() : '';
  return Boolean(s && !/[/\\]/.test(s) && s !== '.' && s !== '..' && !s.includes('..'));
}

function writeRegression(programDir, phaseId, checks, meta = {}) {
  if (!isSafePhaseId(phaseId)) throw new Error(`phaseId inválido: ${phaseId}`);
  const file = path.join(programPaths(programDir).regressionDir, `${phaseId}.json`);
  writeJson(file, { schema_version: 1, phase: phaseId, frozen_at: new Date().toISOString(), ...meta, checks });
  return file;
}

/** Checks de regressão das fases fechadas antes de `phaseId`, com id `reg-<fase>-<check>`. */
function loadRegressionChecks(programDir, state, phaseId) {
  if (!state || !Array.isArray(state.phases)) return [];
  // OXB-033: with phase dependencies a later phase can close first; every closed phase other than this one is
  // regression (in the serial default only earlier phases are closed, so nothing changes).
  const before = state.phases.filter((phase) => phase && phase.status === 'closed' && phase.id !== phaseId && isSafePhaseId(phase.id));
  const checks = [];
  for (const phase of before) {
    const frozen = readJson(path.join(programPaths(programDir).regressionDir, `${phase.id}.json`));
    const raw = frozen && Array.isArray(frozen.checks) ? frozen.checks : [];
    // bench B42: regression frozen before the fix — the same whole-suite dedupe on read
    const refOf = (c) => String(c.acceptance_ref || '').toUpperCase();
    const scoped = new Set(raw.filter((c) => c.command && !isWholeSuiteCommand(c.command) && refOf(c)).map(refOf));
    for (const check of raw.filter((c) => !(c.command && isWholeSuiteCommand(c.command) && refOf(c) && scoped.has(refOf(c))))) {
      checks.push({
        ...check,
        id: `reg-${phase.id.toLowerCase()}-${check.id}`,
        regression_phase: phase.id,
        description: `[regressão ${phase.id}] ${check.description || check.id}`,
      });
    }
  }
  return checks;
}

/** Arquivos e símbolos contratados pelo pack (exact_paths + symbols) das tarefas do plano. */
function contractedFiles(parsedPlan) {
  const files = new Set();
  for (const task of parsedPlan && Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : []) {
    if (!task || typeof task !== 'object') continue;
    for (const file of task.filesExist || []) {
      if (typeof file === 'string' && file.trim()) files.add(file.trim().replace(/\\/g, '/'));
    }
    for (const entry of task.exportsExpected || []) {
      if (entry && typeof entry.file === 'string' && entry.file.trim()) files.add(entry.file.trim().replace(/\\/g, '/'));
    }
  }
  return [...files];
}

/** Superfície pública real dos arquivos contratados (só JS/TS; outros ficam sem `exports`). */
function buildInterfaces(projectRoot, runtime, files) {
  const rootAbs = path.resolve(projectRoot);
  const modules = [];
  for (const file of files || []) {
    if (typeof file !== 'string' || !file.trim()) continue;
    const abs = path.resolve(rootAbs, file);
    const rel = path.relative(rootAbs, abs);
    if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) continue;
    let isFile = false;
    try { isFile = fs.statSync(abs).isFile(); } catch { isFile = false; }
    if (!isFile) continue;
    const exports = runtime && typeof runtime.readModuleExports === 'function' ? runtime.readModuleExports(abs) : null;
    if (!exports || exports.length === 0) continue;
    modules.push({ file, exports });
  }
  return modules;
}

function writeInterfaces(programDir, phaseId, modules) {
  if (!isSafePhaseId(phaseId)) throw new Error(`phaseId inválido: ${phaseId}`);
  const file = path.join(programPaths(programDir).interfacesDir, `${phaseId}.json`);
  writeJson(file, { schema_version: 1, phase: phaseId, generated_at: new Date().toISOString(), modules });
  return file;
}

/** Interfaces das fases fechadas, para o contexto do nó (mais recente por arquivo vence). */
function loadClosedInterfaces(programDir, state) {
  const byFile = new Map();
  for (const phase of state && Array.isArray(state.phases) ? state.phases : []) {
    if (!phase || phase.status !== 'closed' || !isSafePhaseId(phase.id)) continue;
    const doc = readJson(path.join(programPaths(programDir).interfacesDir, `${phase.id}.json`));
    for (const module of doc && Array.isArray(doc.modules) ? doc.modules : []) {
      if (module && module.file && Array.isArray(module.exports)) byFile.set(module.file, { ...module, phase: phase.id });
    }
  }
  return [...byFile.values()];
}

/**
 * 1.21 (coesão entre fases): the handoff "O que a próxima fase deve saber" each closed phase wrote in its dossier
 * (`<dossierRoot>/<phase>/plan.md`), so the next phases' executors read it instead of rediscovering it.
 * @returns {{ phase: string, text: string }[]}
 */
function loadClosedHandoffs(dossierRoot, state) {
  const dossier = require('./oxe-dossier.cjs');
  const out = [];
  for (const phase of state && Array.isArray(state.phases) ? state.phases : []) {
    if (!phase || phase.status !== 'closed' || !isSafePhaseId(phase.id)) continue;
    let text = '';
    try {
      text = fs.readFileSync(path.join(dossierRoot, phase.id, 'plan.md'), 'utf8');
    } catch {
      continue;
    }
    const human = dossier.humanPart(text);
    if (!dossier.handoffFilled(human)) continue;
    const body = dossier.section(human, 'O que a próxima fase deve saber');
    if (body && body.trim()) out.push({ phase: phase.id, text: body.trim() });
  }
  return out;
}

function git(projectRoot, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

/**
 * Commit local da fase (sem push). Sem repositório git ou sem mudanças, devolve o HEAD atual
 * (ou null) e diz por quê — nunca grava um commit antigo como se fosse o da fase.
 */
function commitPhase(projectRoot, message) {
  if (!git(projectRoot, ['rev-parse', '--is-inside-work-tree']).ok) {
    return { commit: null, committed: false, reason: 'sem repositório git' };
  }
  const add = git(projectRoot, ['add', '-A']);
  if (!add.ok) return { commit: null, committed: false, reason: `git add falhou: ${add.stderr}` };
  const staged = git(projectRoot, ['diff', '--cached', '--quiet']);
  if (staged.ok) {
    const head = git(projectRoot, ['rev-parse', 'HEAD']);
    return { commit: head.ok ? head.stdout : null, committed: false, reason: 'nenhuma mudança para commitar' };
  }
  const commit = git(projectRoot, ['commit', '-m', message]);
  if (!commit.ok) return { commit: null, committed: false, reason: `git commit falhou: ${commit.stderr || commit.stdout}` };
  const head = git(projectRoot, ['rev-parse', 'HEAD']);
  return { commit: head.ok ? head.stdout : null, committed: true, reason: null };
}

module.exports = {
  loadClosedHandoffs,
  programPaths,
  readProgram,
  writeProgram,
  relativeRef,
  freezeRegressionChecks,
  isWholeSuiteCommand,
  writeRegression,
  loadRegressionChecks,
  contractedFiles,
  buildInterfaces,
  writeInterfaces,
  loadClosedInterfaces,
  commitPhase,
};
