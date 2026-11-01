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
  return (suite && Array.isArray(suite.checks) ? suite.checks : []).filter((check) => {
    if (!check || check.regression_phase) return false;
    const executable = Boolean(check.command)
      || (Array.isArray(check.files_exist) && check.files_exist.length > 0)
      || (Array.isArray(check.exports_expected) && check.exports_expected.length > 0);
    return executable && passed.has(check.id);
  });
}

function writeRegression(programDir, phaseId, checks, meta = {}) {
  const file = path.join(programPaths(programDir).regressionDir, `${phaseId}.json`);
  writeJson(file, { schema_version: 1, phase: phaseId, frozen_at: new Date().toISOString(), ...meta, checks });
  return file;
}

/** Checks de regressão das fases fechadas antes de `phaseId`, com id `reg-<fase>-<check>`. */
function loadRegressionChecks(programDir, state, phaseId) {
  if (!state || !Array.isArray(state.phases)) return [];
  const index = phaseId ? state.phases.findIndex((phase) => phase.id === phaseId) : state.phases.length;
  const before = state.phases.slice(0, index < 0 ? state.phases.length : index).filter((phase) => phase.status === 'closed');
  const checks = [];
  for (const phase of before) {
    const frozen = readJson(path.join(programPaths(programDir).regressionDir, `${phase.id}.json`));
    for (const check of frozen && Array.isArray(frozen.checks) ? frozen.checks : []) {
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
    for (const file of task.filesExist || []) files.add(file);
    for (const entry of task.exportsExpected || []) files.add(entry.file);
  }
  return [...files];
}

/** Superfície pública real dos arquivos contratados (só JS/TS; outros ficam sem `exports`). */
function buildInterfaces(projectRoot, runtime, files) {
  const modules = [];
  for (const file of files) {
    const abs = path.resolve(projectRoot, file);
    if (!fs.existsSync(abs)) continue;
    const exports = runtime && typeof runtime.readModuleExports === 'function' ? runtime.readModuleExports(abs) : null;
    if (!exports || exports.length === 0) continue;
    modules.push({ file, exports });
  }
  return modules;
}

function writeInterfaces(programDir, phaseId, modules) {
  const file = path.join(programPaths(programDir).interfacesDir, `${phaseId}.json`);
  writeJson(file, { schema_version: 1, phase: phaseId, generated_at: new Date().toISOString(), modules });
  return file;
}

/** Interfaces das fases fechadas, para o contexto do nó (mais recente por arquivo vence). */
function loadClosedInterfaces(programDir, state) {
  const byFile = new Map();
  for (const phase of state && Array.isArray(state.phases) ? state.phases : []) {
    if (phase.status !== 'closed') continue;
    const doc = readJson(path.join(programPaths(programDir).interfacesDir, `${phase.id}.json`));
    for (const module of doc && Array.isArray(doc.modules) ? doc.modules : []) {
      if (module && module.file && Array.isArray(module.exports)) byFile.set(module.file, { ...module, phase: phase.id });
    }
  }
  return [...byFile.values()];
}

function git(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
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
  programPaths,
  readProgram,
  writeProgram,
  relativeRef,
  freezeRegressionChecks,
  writeRegression,
  loadRegressionChecks,
  contractedFiles,
  buildInterfaces,
  writeInterfaces,
  loadClosedInterfaces,
  commitPhase,
};
