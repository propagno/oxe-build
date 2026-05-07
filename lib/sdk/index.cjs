'use strict';

/**
 * OXE SDK — API programática estável para integrações, CI e ferramentas.
 * Uso: `const oxe = require('oxe-cc')` ou `require('oxe-cc/lib/sdk/index.cjs')` conforme exports.
 */

const fs = require('fs');
const path = require('path');
const health = require('../../bin/lib/oxe-project-health.cjs');
const manifest = require('../../bin/lib/oxe-manifest.cjs');
const workflows = require('../../bin/lib/oxe-workflows.cjs');
const installResolve = require('../../bin/lib/oxe-install-resolve.cjs');
const agentInstall = require('../../bin/lib/oxe-agent-install.cjs');
const security = require('../../bin/lib/oxe-security.cjs');
const plugins = require('../../bin/lib/oxe-plugins.cjs');
const dashboard = require('../../bin/lib/oxe-dashboard.cjs');
const operational = require('../../bin/lib/oxe-operational.cjs');
const azure = require('../../bin/lib/oxe-azure.cjs');
const context = require('../../bin/lib/oxe-context-engine.cjs');
const runtimeSemantics = require('../../bin/lib/oxe-runtime-semantics.cjs');
const release = require('../../bin/lib/oxe-release.cjs');
const rationality = require('../../bin/lib/oxe-rationality.cjs');

const PACKAGE_ROOT = path.join(__dirname, '..', '..');

/** @returns {{ version: string, name: string }} */
function readPackageMeta(root = PACKAGE_ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return { version: String(j.version || '0.0.0'), name: String(j.name || 'oxe-cc') };
  } catch {
    return { version: '0.0.0', name: 'oxe-cc' };
  }
}

/** @param {string} packageRoot */
function readMinNode(packageRoot) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const eng = j.engines && j.engines.node;
    if (!eng || typeof eng !== 'string') return 18;
    const m = eng.match(/>=?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 18;
  } catch {
    return 18;
  }
}

/**
 * Faz parse de um PLAN.md e extrai tarefas estruturadas.
 *
 * @param {string} planMd - Conteúdo do PLAN.md (string).
 * @returns {{
 *   tasks: Array<{
 *     id: string,
 *     title: string,
 *     wave: number | null,
 *     dependsOn: string[],
 *     files: string[],
 *     verifyCommand: string | null,
 *     aceite: string[],
 *     decisions: string[],
 *     done: boolean,
 *     meta: Record<string, unknown> | null,
 *   }>,
 *   waves: Record<number, string[]>,
 *   totalTasks: number,
 * }}
 */
function parsePlan(planMd) {
  const parts = planMd.split(/^###\s+(T\d+)\s*[—-]\s*/m);
  /** @type {ReturnType<typeof parsePlan>['tasks']} */
  const tasks = [];
  /** @type {Record<number, string[]>} */
  const waves = {};

  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i].trim();
    const rest = (parts[i + 1] || '').split(/^###\s+T\d+/m)[0];
    const titleMatch = rest.match(/^([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const waveMatch = rest.match(/\*\*Onda:\*\*\s*(\d+)/i);
    const wave = waveMatch ? parseInt(waveMatch[1], 10) : null;

    const depsMatch = rest.match(/\*\*Depende\s+de:\*\*\s*([^\n]+)/i);
    const dependsOn = depsMatch
      ? depsMatch[1].split(/[,\s]+/).filter((s) => /^T\d+$/.test(s.trim()))
      : [];

    const filesMatch = rest.match(/\*\*Arquivos\s+prováveis:\*\*\s*([^\n]+)/i);
    const files = filesMatch
      ? filesMatch[1].match(/`([^`]+)`/g)?.map((s) => s.replace(/`/g, '')) || []
      : [];

    // Accept plain or bold-markdown form: "Verificação:", "**Verificação:**", "**Verify command:**", etc.
    // In "**Keyword:**" the asterisks come after the colon: keyword:\*{0,2}
    const verifyCmdMatch = rest.match(
      /\*{0,2}(?:Comando|Verify\s+command|Verificação|Verification):\*{0,2}\s*`([^`]+)`/is
    );
    const verifyCommand = verifyCmdMatch ? verifyCmdMatch[1].trim() : null;

    const aceiteMatch = rest.match(/\*\*Aceite\s+vinculado:\*\*\s*([^\n]+)/i);
    const aceite = aceiteMatch
      ? aceiteMatch[1].match(/A\d+/g) || []
      : [];

    const decisionsMatch = rest.match(/\*\*Decisão\s+vinculada:\*\*\s*([^\n]+)/i);
    const decisions = decisionsMatch
      ? decisionsMatch[1].match(/D-\d+/g) || []
      : [];

    // Parse do metadado JSON em comentário HTML <!-- oxe-task: {...} -->
    const metaMatch = rest.match(/<!--\s*oxe-task:\s*(\{[\s\S]*?\})\s*-->/);
    let meta = null;
    if (metaMatch) {
      try {
        meta = JSON.parse(metaMatch[1]);
      } catch {
        meta = null;
      }
    }

    const done = meta?.done === true;

    const task = { id, title, wave, dependsOn, files, verifyCommand, aceite, decisions, done, meta };
    tasks.push(task);

    if (wave != null) {
      if (!waves[wave]) waves[wave] = [];
      waves[wave].push(id);
    }
  }

  return { tasks, waves, totalTasks: tasks.length };
}

/**
 * Faz parse de um SPEC.md e extrai critérios de aceite.
 *
 * @param {string} specMd - Conteúdo do SPEC.md.
 * @returns {{
 *   objective: string | null,
 *   criteria: Array<{ id: string, criterion: string, howToVerify: string }>,
 *   requiredSections: string[],
 * }}
 */

/**
 * Parseia o arquivo lessons-metrics.json retornando o array de lições com métricas.
 * @param {string} metricsJson — conteúdo do arquivo lessons-metrics.json
 * @returns {Array<{ id: string, rule: string, type: string, applied_cycles: string[], outcomes: Array<{ cycle: string, verify_status: string, saved_hours?: number, failure_condition?: string }>, success_rate: number, status: string, deprecation_threshold: number }>}
 */
function parseLessonsMetrics(metricsJson) {
  try {
    const data = JSON.parse(String(metricsJson || '{}'));
    return Array.isArray(data.lessons) ? data.lessons : [];
  } catch {
    return [];
  }
}

/**
 * Atualiza a métrica de uma lição com um novo outcome e recalcula success_rate.
 * @param {ReturnType<typeof parseLessonsMetrics>} metrics
 * @param {string} lessonId
 * @param {{ cycle: string, verify_status: string, saved_hours?: number, failure_condition?: string }} outcome
 * @returns {ReturnType<typeof parseLessonsMetrics>}
 */
function updateLessonMetric(metrics, lessonId, outcome) {
  const arr = Array.isArray(metrics) ? metrics.slice() : [];
  const idx = arr.findIndex((l) => l.id === lessonId);
  if (idx === -1) return arr;

  const lesson = { ...arr[idx] };
  lesson.outcomes = [...(lesson.outcomes || []), outcome];
  if (!lesson.applied_cycles.includes(outcome.cycle)) {
    lesson.applied_cycles = [...lesson.applied_cycles, outcome.cycle];
  }

  const total = lesson.outcomes.length;
  const successes = lesson.outcomes.filter((o) => o.verify_status === 'complete').length;
  lesson.success_rate = total > 0 ? Math.round((successes / total) * 100) / 100 : 0;

  const threshold = typeof lesson.deprecation_threshold === 'number' ? lesson.deprecation_threshold : 0.5;
  if (lesson.success_rate < threshold && total >= 3) {
    lesson.status = 'deprecated';
  }

  arr[idx] = lesson;
  return arr;
}

/**
 * Marca como 'deprecated' todas as lições com success_rate abaixo do threshold e ≥ minObservations.
 * @param {ReturnType<typeof parseLessonsMetrics>} metrics
 * @param {number} [threshold=0.5]
 * @param {number} [minObservations=3]
 * @returns {ReturnType<typeof parseLessonsMetrics>}
 */
function deprecateLowEffectiveness(metrics, threshold = 0.5, minObservations = 3) {
  return (Array.isArray(metrics) ? metrics : []).map((lesson) => {
    const observations = (lesson.outcomes || []).length;
    const rate = typeof lesson.success_rate === 'number' ? lesson.success_rate : 1;
    if (lesson.status !== 'deprecated' && observations >= minObservations && rate < threshold) {
      return { ...lesson, status: 'deprecated' };
    }
    return lesson;
  });
}

function parseSpec(specMd) {
  // Objetivo
  const objMatch = specMd.match(/##\s*Objetivo\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im);
  const objective = objMatch ? objMatch[1].trim().split('\n')[0].trim() : null;

  // Tabela de critérios
  /** @type {Array<{ id: string, criterion: string, howToVerify: string }>} */
  const criteria = [];
  const criteriaIdx = specMd.search(/##\s*Crit.rios.*?aceite/im);
  if (criteriaIdx !== -1) {
    const afterSection = specMd.slice(criteriaIdx);
    const nextHeadingMatch = afterSection.slice(3).match(/\n#{1,3} /);
    const sectionText = nextHeadingMatch
      ? afterSection.slice(0, nextHeadingMatch.index + 3 + 1)
      : afterSection;
    const rows = sectionText.split('\n').filter((l) => l.trimStart().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && /^A\d+$/i.test(cells[0])) {
        criteria.push({
          id: cells[0],
          criterion: cells[1] || '',
          howToVerify: cells[2] || '',
        });
      }
    }
  }

  // Seções presentes (para validação spec_required_sections)
  const headings = [];
  for (const m of specMd.matchAll(/^##\s+(.+)/gm)) {
    headings.push(`## ${m[1].trim()}`);
  }

  return { objective, criteria, requiredSections: headings };
}

/**
 * Faz parse do STATE.md e extrai fase, data do scan e próximo passo.
 *
 * @param {string} stateMd - Conteúdo do STATE.md.
 * @returns {{
 *   phase: string | null,
 *   lastScanDate: string | null,
 *   nextStep: string | null,
 *   decisions: string[],
 *   activeWorkstreams: string[],
 *   activeMilestone: string | null,
 * }}
 */
function parseState(stateMd) {
  const phase = health.parseStatePhase(stateMd);

  const scanDate = health.parseLastScanDate(stateMd);
  const lastScanDate = scanDate ? scanDate.toISOString().split('T')[0] : null;

  const nextStepMatch = stateMd.match(/##\s*Próximo passo sugerido\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im);
  const nextStep = nextStepMatch ? nextStepMatch[1].trim().split('\n')[0].replace(/^[-*]\s*/, '').trim() : null;

  // Decisões persistentes (seção opcional)
  const decisionsMatch = stateMd.match(/##\s*Decisões persistentes\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im);
  const decisions = decisionsMatch
    ? decisionsMatch[1].match(/D-\d+[^)]*\)/g) || decisionsMatch[1].match(/D-\d+[^\n]*/g) || []
    : [];

  // Workstreams ativos (seção opcional)
  const wsMatch = stateMd.match(/##\s*Workstreams ativos\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im);
  const activeWorkstreams = wsMatch
    ? wsMatch[1].match(/`([^`]+)`/g)?.map((s) => s.replace(/`/g, '')) || []
    : [];

  // Milestone ativo
  const msMatch = stateMd.match(/##\s*Milestone ativo\s*\n+[^`]*`([^`]+)`/im);
  const activeMilestone = msMatch ? msMatch[1] : null;

  // Último retro
  const retroDate = health.parseLastRetroDate(stateMd);
  const lastRetroDate = retroDate ? retroDate.toISOString().split('T')[0] : null;

  // Blueprint de agentes (sessão)
  const runIdMatch = stateMd.match(/^\s*[-*]?\s*\*?\*?run_id:\*?\*?\s*(.+)/im);
  const runIdRaw = runIdMatch ? runIdMatch[1].trim().replace(/^[\(\-—]+|[\)\-—]+$/g, '').trim() : null;
  const runId = runIdRaw && runIdRaw !== '—' && runIdRaw !== '-' ? runIdRaw : null;

  const lifecycleMatch = stateMd.match(/^\s*[-*]?\s*\*?\*?lifecycle_status:\*?\*?\s*([^\s\n|`(]+)/im);
  const lifecycleStatusRaw = lifecycleMatch ? lifecycleMatch[1].trim() : null;
  const lifecycleStatus = lifecycleStatusRaw && lifecycleStatusRaw !== '—' && lifecycleStatusRaw !== '-' ? lifecycleStatusRaw : null;

  // Loop (sessão)
  const loopStatusMatch = stateMd.match(/^\s*[-*]?\s*\*?\*?loop_status:\*?\*?\s*([^\s\n|`(]+)/im);
  const loopStatusRaw = loopStatusMatch ? loopStatusMatch[1].trim() : null;
  const loopStatus = loopStatusRaw && loopStatusRaw !== '—' && loopStatusRaw !== '-' ? loopStatusRaw : null;

  return { phase, lastScanDate, lastRetroDate, nextStep, decisions, activeWorkstreams, activeMilestone, runId, lifecycleStatus, loopStatus };
}

/**
 * Valida fidelidade entre decisões do DISCUSS.md e tarefas do PLAN.md.
 * Retorna gaps onde decisões D-NN não têm tarefa vinculada.
 *
 * @param {string} discussMd - Conteúdo do DISCUSS.md.
 * @param {string} planMd - Conteúdo do PLAN.md.
 * @returns {{
 *   ok: boolean,
 *   gaps: Array<{ decisionId: string, decision: string }>,
 *   covered: Array<{ decisionId: string, taskIds: string[] }>,
 * }}
 */
function validateDecisionFidelity(discussMd, planMd) {
  // Extrair decisões da tabela D-NN
  const decisionRows = [];
  const decisoesIdx = discussMd.search(/##\s*Decis.es/im);
  if (decisoesIdx !== -1) {
    const afterSection = discussMd.slice(decisoesIdx);
    const nextHeadingMatch = afterSection.slice(3).match(/\n#{1,3} /);
    const sectionText = nextHeadingMatch
      ? afterSection.slice(0, nextHeadingMatch.index + 3 + 1)
      : afterSection;
    const rows = sectionText.split('\n').filter((l) => l.trimStart().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && /^D-\d+$/i.test(cells[0])) {
        decisionRows.push({ id: cells[0], text: cells[1] || '' });
      }
    }
  }

  if (!decisionRows.length) return { ok: true, gaps: [], covered: [] };

  const { tasks } = parsePlan(planMd);

  /** @type {ReturnType<typeof validateDecisionFidelity>['gaps']} */
  const gaps = [];
  /** @type {ReturnType<typeof validateDecisionFidelity>['covered']} */
  const covered = [];

  for (const dec of decisionRows) {
    // Ignorar decisões revertidas
    if (/revertida/i.test(dec.text)) continue;

    const tasksCovering = tasks.filter((t) => t.decisions.includes(dec.id));
    if (tasksCovering.length === 0) {
      gaps.push({ decisionId: dec.id, decision: dec.text });
    } else {
      covered.push({ decisionId: dec.id, taskIds: tasksCovering.map((t) => t.id) });
    }
  }

  return { ok: gaps.length === 0, gaps, covered };
}

/**
 * Verificações alinhadas ao `oxe-cc doctor`, com resultado estruturado (CI / gateways).
 *
 * @param {{
 *   projectRoot: string,
 *   packageRoot?: string,
 *   nodeMajor?: number,
 *   includeWorkflowLint?: boolean,
 *   workflowLintOptions?: { maxBytesSoft?: number },
 *   includeSecurity?: boolean,
 * }} args
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{ code: string, message: string, detail?: unknown }>,
 *   warnings: Array<{ code: string, message: string, detail?: unknown }>,
 *   node: { currentMajor: number, minimumMajor: number, ok: boolean },
 *   workflowDiff: ReturnType<typeof workflows.diffWorkflows> | null,
 *   projectWorkflowsDir: string | null,
 *   packageWorkflowsDir: string,
 *   config: ReturnType<typeof health.loadOxeConfigMerged>,
 *   validation: ReturnType<typeof health.validateConfigShape>,
 *   healthReport: ReturnType<typeof health.buildHealthReport>,
 *   workflowShape: ReturnType<typeof workflows.validateWorkflowShapes> | null,
 *   securityReport: { secretFiles: string[], pluginsValid: boolean } | null,
 * }}
 */
function runDoctorChecks(args) {
  const projectRoot = path.resolve(args.projectRoot);
  const packageRoot = path.resolve(args.packageRoot || PACKAGE_ROOT);
  const wfPkg = path.join(packageRoot, 'oxe', 'workflows');

  /** @type {Array<{ code: string, message: string, detail?: unknown }>} */
  const errors = [];
  /** @type {Array<{ code: string, message: string, detail?: unknown }>} */
  const warnings = [];

  const nodeMajor =
    args.nodeMajor != null
      ? args.nodeMajor
      : parseInt(String(process.versions.node).split('.')[0], 10);
  const minNode = readMinNode(packageRoot);
  const node = { currentMajor: nodeMajor, minimumMajor: minNode, ok: nodeMajor >= minNode };
  if (!node.ok) {
    errors.push({
      code: 'NODE_VERSION',
      message: `Node.js ${nodeMajor} abaixo do mínimo do pacote (${minNode})`,
      detail: { currentMajor: nodeMajor, minimumMajor: minNode },
    });
  }

  if (!fs.existsSync(wfPkg)) {
    errors.push({
      code: 'PACKAGE_WORKFLOWS_MISSING',
      message: `Pasta de workflows do pacote inexistente: ${wfPkg}`,
    });
  }

  const wfTgt = workflows.resolveWorkflowsDir(projectRoot);
  /** @type {ReturnType<typeof workflows.diffWorkflows> | null} */
  let workflowDiff = null;

  if (!wfTgt) {
    errors.push({
      code: 'PROJECT_WORKFLOWS_MISSING',
      message: 'Não existe .oxe/workflows nem oxe/workflows neste projeto',
    });
  } else if (fs.existsSync(wfPkg)) {
    workflowDiff = workflows.diffWorkflows(wfPkg, wfTgt);
    if (!workflowDiff.ok) {
      errors.push({
        code: 'WORKFLOW_DRIFT',
        message: `Faltam workflows em relação ao pacote: ${workflowDiff.missing.join(', ')}`,
        detail: { missing: workflowDiff.missing, extra: workflowDiff.extra },
      });
    } else if (workflowDiff.extra.length) {
      warnings.push({
        code: 'WORKFLOW_EXTRA',
        message: `Workflows extra no projeto (ok em forks): ${workflowDiff.extra.join(', ')}`,
        detail: { extra: workflowDiff.extra },
      });
    }
  }

  const config = health.loadOxeConfigMerged(projectRoot);
  const cfgPath = path.join(projectRoot, '.oxe', 'config.json');
  if (fs.existsSync(cfgPath)) {
    if (config.parseError) {
      errors.push({
        code: 'CONFIG_JSON_INVALID',
        message: `config.json inválido: ${config.parseError}`,
        detail: { path: cfgPath },
      });
    }
  }

  const validation = health.validateConfigShape(
    /** @type {Record<string, unknown>} */ (config.config)
  );
  for (const msg of validation.typeErrors) {
    warnings.push({ code: 'CONFIG_SHAPE', message: msg });
  }
  if (validation.unknownKeys.length) {
    warnings.push({
      code: 'CONFIG_UNKNOWN_KEYS',
      message: `Chaves desconhecidas: ${validation.unknownKeys.join(', ')}`,
      detail: { keys: validation.unknownKeys },
    });
  }

  const healthReport = health.buildHealthReport(projectRoot);

  /** @type {ReturnType<typeof workflows.validateWorkflowShapes> | null} */
  let workflowShape = null;
  const includeWorkflowLint = args.includeWorkflowLint !== false;
  if (includeWorkflowLint && wfTgt) {
    workflowShape = workflows.validateWorkflowShapes(wfTgt, args.workflowLintOptions || {});
    for (const w of workflowShape.warnings) {
      warnings.push(w);
    }
  }

  // Verificações de segurança (opcional, ativado por padrão)
  let securityReport = null;
  if (args.includeSecurity !== false) {
    const secretFiles = security.scanDirForSecretFiles(projectRoot, { maxDepth: 3 });
    if (secretFiles.length > 0) {
      warnings.push({
        code: 'SECURITY_SECRET_FILES',
        message: `Arquivos com nomes sensíveis detectados: ${secretFiles.join(', ')}`,
        detail: { files: secretFiles },
      });
    }

    // Verificar plugins se existirem
    const pluginsDir = path.join(projectRoot, '.oxe', 'plugins');
    let pluginsValid = true;
    if (fs.existsSync(pluginsDir)) {
      const pluginFiles = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.cjs'));
      for (const pf of pluginFiles) {
        const pluginPath = path.join(pluginsDir, pf);
        const safetyCheck = security.checkPathSafety(pluginPath, projectRoot);
        if (!safetyCheck.safe) {
          pluginsValid = false;
          warnings.push({
            code: 'SECURITY_PLUGIN_PATH',
            message: `Plugin com caminho inseguro: ${pf} — ${safetyCheck.reason}`,
          });
        }
      }
    }

    securityReport = { secretFiles, pluginsValid };
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    node,
    workflowDiff,
    projectWorkflowsDir: wfTgt,
    packageWorkflowsDir: wfPkg,
    config,
    validation,
    healthReport,
    workflowShape,
    securityReport,
  };
}

const meta = readPackageMeta();

module.exports = {
  /** Versão do pacote `oxe-cc` (lida de package.json na raiz do pacote instalado). */
  version: meta.version,
  name: meta.name,
  PACKAGE_ROOT,

  /** Metadados e leitura de package.json (extensível para monorepos). */
  readPackageMeta,
  readMinNode,

  /** Parsing de artefatos OXE (PLAN, SPEC, STATE, hypotheses, confidence, lessons). */
  parsePlan,
  parseSpec,
  parseHypotheses: context.parseHypotheses,
  parseConfidenceVector: context.parseConfidenceVector,
  parseExecutionPlanTasks: rationality.parsePlanTasks,
  parseState,
  validateDecisionFidelity,
  parseLessonsMetrics,
  updateLessonMetric,
  deprecateLowEffectiveness,

  /** Estado do projeto, SPEC/PLAN, fase, config. */
  health: {
    loadOxeConfigMerged: health.loadOxeConfigMerged,
    validateConfigShape: health.validateConfigShape,
    buildHealthReport: health.buildHealthReport,
    detectWorkspaceMode: health.detectWorkspaceMode,
    shouldSuppressExecutionWorkspaceGates: health.shouldSuppressExecutionWorkspaceGates,
    suggestNextStep: health.suggestNextStep,
    oxePaths: health.oxePaths,
    parseStatePhase: health.parseStatePhase,
    parseLastScanDate: health.parseLastScanDate,
    parseLastCompactDate: health.parseLastCompactDate,
    parseLastRetroDate: health.parseLastRetroDate,
    isStaleScan: health.isStaleScan,
    isStaleLessons: health.isStaleLessons,
    copilotWorkspacePaths: health.copilotWorkspacePaths,
    copilotLegacyPaths: health.copilotLegacyPaths,
    copilotIntegrationReport: health.copilotIntegrationReport,
    planAgentsWarnings: health.planAgentsWarnings,
    phaseCoherenceWarnings: health.phaseCoherenceWarnings,
    specSectionWarnings: health.specSectionWarnings,
    planWaveWarningsFixed: health.planWaveWarningsFixed,
    planTaskAceiteWarnings: health.planTaskAceiteWarnings,
    buildExecutionRationality: health.buildExecutionRationality,
    executionRationalityWarningsFromSummary: health.executionRationalityWarningsFromSummary,
    verifyGapsWithoutSummaryWarning: health.verifyGapsWithoutSummaryWarning,
    expandExecutionProfile: health.expandExecutionProfile,
    ALLOWED_CONFIG_KEYS: health.ALLOWED_CONFIG_KEYS,
    EXECUTION_PROFILES: health.EXECUTION_PROFILES,
    VERIFICATION_DEPTHS: health.VERIFICATION_DEPTHS,
    INSTALL_PROFILES: health.INSTALL_PROFILES,
    INSTALL_REPO_LAYOUTS: health.INSTALL_REPO_LAYOUTS,
    INSTALL_OBJECT_KEYS: health.INSTALL_OBJECT_KEYS,
    EXPECTED_CODEBASE_MAPS: health.EXPECTED_CODEBASE_MAPS,
  },

  /** Workflows canónicos no disco. */
  workflows: {
    resolveWorkflowsDir: workflows.resolveWorkflowsDir,
    listWorkflowMdFiles: workflows.listWorkflowMdFiles,
    diffWorkflows: workflows.diffWorkflows,
    validateWorkflowShapes: workflows.validateWorkflowShapes,
    DEFAULT_MAX_BYTES_SOFT: workflows.DEFAULT_MAX_BYTES_SOFT,
    SUCCESS_CRITERIA_EXCEPTIONS: workflows.SUCCESS_CRITERIA_EXCEPTIONS,
  },

  /** Resolução de opções de instalação a partir de `.oxe/config.json`. */
  install: {
    resolveOptionsFromConfig: installResolve.resolveInstallOptionsFromConfig,
  },

  /** Manifesto de ficheiros instalados em `~` (integridade / backup). */
  manifest: {
    loadFileManifest: manifest.loadFileManifest,
    writeFileManifest: manifest.writeFileManifest,
    sha256File: manifest.sha256File,
    collectFilesRecursive: manifest.collectFilesRecursive,
    MANIFEST_DIR: manifest.MANIFEST_DIR,
    PATCHES_DIR: manifest.PATCHES_DIR,
  },

  /** Texto / multi-agente (rewrites de caminho, frontmatter). */
  agents: {
    adjustWorkflowPathsForNestedLayout: agentInstall.adjustWorkflowPathsForNestedLayout,
    parseCursorCommandFrontmatter: agentInstall.parseCursorCommandFrontmatter,
  },

  /** Segurança: validação de caminhos e detecção de segredos. */
  security: {
    checkPathSafety: security.checkPathSafety,
    scanFileForSecrets: security.scanFileForSecrets,
    scanDirForSecretFiles: security.scanDirForSecretFiles,
    validatePlanPaths: security.validatePlanPaths,
    checkFilePermission: security.checkFilePermission,
    checkPermissions: security.checkPermissions,
    globToRegex: security.globToRegex,
    DEFAULT_SECRET_PATTERNS: security.DEFAULT_SECRET_PATTERNS,
    DEFAULT_SECRET_CONTENT_PATTERNS: security.DEFAULT_SECRET_CONTENT_PATTERNS,
    DEFAULT_DENIED_PATH_PATTERNS: security.DEFAULT_DENIED_PATH_PATTERNS,
  },

  /** Plugin system — hooks de ciclo de vida em `.oxe/plugins/*.cjs`. */
  plugins: {
    loadPlugins: plugins.loadPlugins,
    runHook: plugins.runHook,
    validatePlugins: plugins.validatePlugins,
    initPluginsDir: plugins.initPluginsDir,
    resolvePluginSources: plugins.resolvePluginSources,
    installNpmPlugin: plugins.installNpmPlugin,
  },

  /** Dashboard local: contexto consolidado e persistência de revisão do plano. */
  dashboard: {
    loadDashboardContext: dashboard.loadDashboardContext,
    savePlanReviewStatus: dashboard.savePlanReviewStatus,
    addPlanReviewComment: dashboard.addPlanReviewComment,
    updatePlanReviewCommentStatus: dashboard.updatePlanReviewCommentStatus,
  },

  /** Release readiness: manifest, smoke matrix e checks de consistência antes de publicar. */
  release: {
    REQUIRED_RUNTIMES: release.REQUIRED_RUNTIMES,
    WRAPPER_TARGETS: release.WRAPPER_TARGETS,
    releasePaths: release.releasePaths,
    collectWrapperHashes: release.collectWrapperHashes,
    loadRuntimeSmokeReport: release.loadRuntimeSmokeReport,
    loadRecoveryFixtureReport: release.loadRecoveryFixtureReport,
    loadMultiAgentSoakReport: release.loadMultiAgentSoakReport,
    buildReleaseManifest: release.buildReleaseManifest,
    inspectCanonicalSource: release.inspectCanonicalSource,
    evaluateReleaseManifest: release.evaluateReleaseManifest,
    inspectReleaseReadiness: release.inspectReleaseReadiness,
    checkReleaseConsistency: release.checkReleaseConsistency,
  },

  /** Runtime operacional: tracing, active run, catálogo de capabilities e memória em camadas. */
  operational: {
    operationalPaths: operational.operationalPaths,
    appendEvent: operational.appendEvent,
    readEvents: operational.readEvents,
    summarizeEvents: operational.summarizeEvents,
    writeRunState: operational.writeRunState,
    readRunState: operational.readRunState,
    buildOperationalGraph: operational.buildOperationalGraph,
    serializeCanonicalState: operational.serializeCanonicalState,
    hydrateCanonicalState: operational.hydrateCanonicalState,
    reduceCanonicalRunState: operational.reduceCanonicalRunState,
    compileExecutionGraphFromArtifacts: operational.compileExecutionGraphFromArtifacts,
    compileVerificationSuiteFromArtifacts: operational.compileVerificationSuiteFromArtifacts,
    projectRuntimeArtifacts: operational.projectRuntimeArtifacts,
    runRuntimeCiChecks: operational.runRuntimeCiChecks,
    buildRuntimePluginRegistry: operational.buildRuntimePluginRegistry,
    readRuntimeGates: operational.readRuntimeGates,
    resolveRuntimeGate: operational.resolveRuntimeGate,
    runRuntimeVerify: operational.runRuntimeVerify,
    runRuntimePromotion: operational.runRuntimePromotion,
    recoverRuntimeState: operational.recoverRuntimeState,
    applyRuntimeAction: operational.applyRuntimeAction,
    parseCapabilityManifest: operational.parseCapabilityManifest,
    readCapabilityCatalog: operational.readCapabilityCatalog,
    buildMemoryLayers: operational.buildMemoryLayers,
    replayEvents: operational.replayEvents,
    replayRuntimeState: operational.replayRuntimeState,
    readRuntimeMultiAgentStatus: operational.readRuntimeMultiAgentStatus,
    multiAgentStatus: operational.readRuntimeMultiAgentStatus,
  },

  /** Context Engine V2: seleção, compressão e inspeção determinística de artefatos. */
  context: {
    contextPaths: context.contextPaths,
    resolveArtifactCandidates: context.resolveArtifactCandidates,
    buildProjectSummary: context.buildProjectSummary,
    buildSessionSummary: context.buildSessionSummary,
    buildPhaseSummary: context.buildPhaseSummary,
    buildContextIndex: context.buildContextIndex,
    buildContextPack: context.buildContextPack,
    inspectContextPack: context.inspectContextPack,
    buildAllContextPacks: context.buildAllContextPacks,
    computeContextQuality: context.computeContextQuality,
    computePackFreshness: context.computePackFreshness,
    resolvePackFile: context.resolvePackFile,
    summarizeText: context.summarizeText,
    extractSemanticFragment: context.extractSemanticFragment,
    parseHypotheses: context.parseHypotheses,
    parseConfidenceVector: context.parseConfidenceVector,
  },

  /** Semântica canónica multi-runtime para workflows, wrappers e prompts gerados. */
  runtimeSemantics: {
    CONTRACT_VERSION: runtimeSemantics.CONTRACT_VERSION,
    CONTRACTS_PATH: runtimeSemantics.CONTRACTS_PATH,
    CONTRACTS_REGISTRY: runtimeSemantics.CONTRACTS_REGISTRY,
    REQUIRED_CONTRACT_FIELDS: runtimeSemantics.REQUIRED_CONTRACT_FIELDS,
    RUNTIME_METADATA_KEYS: runtimeSemantics.RUNTIME_METADATA_KEYS,
    validateWorkflowContractsRegistry: runtimeSemantics.validateWorkflowContractsRegistry,
    getWorkflowContract: runtimeSemantics.getWorkflowContract,
    getAllWorkflowContracts: runtimeSemantics.getAllWorkflowContracts,
    computeSemanticsHash: runtimeSemantics.computeSemanticsHash,
    getRuntimeMetadataForSlug: runtimeSemantics.getRuntimeMetadataForSlug,
    renderRuntimeMetadataLines: runtimeSemantics.renderRuntimeMetadataLines,
    buildReasoningContractBlock: runtimeSemantics.buildReasoningContractBlock,
    pickRuntimeMetadata: runtimeSemantics.pickRuntimeMetadata,
    splitFrontmatter: runtimeSemantics.splitFrontmatter,
    parseFrontmatterMap: runtimeSemantics.parseFrontmatterMap,
    slugFromPromptFilename: runtimeSemantics.slugFromPromptFilename,
    slugFromCommandFilename: runtimeSemantics.slugFromCommandFilename,
    auditWrapperText: runtimeSemantics.auditWrapperText,
    auditRuntimeTargets: runtimeSemantics.auditRuntimeTargets,
  },

  /** Provider Azure nativo via Azure CLI. */
  azure: {
    MIN_AZURE_CLI_MAJOR: azure.MIN_AZURE_CLI_MAJOR,
    AZURE_CAPABILITY_IDS: azure.AZURE_CAPABILITY_IDS,
    RESOURCE_GRAPH_QUERY: azure.RESOURCE_GRAPH_QUERY,
    DEFAULT_AZURE_PROFILE: azure.DEFAULT_AZURE_PROFILE,
    azurePaths: azure.azurePaths,
    ensureAzureArtifacts: azure.ensureAzureArtifacts,
    isAzureContextEnabled: azure.isAzureContextEnabled,
    detectAzureCli: azure.detectAzureCli,
    loadAzureProfile: azure.loadAzureProfile,
    loadAzureAuthStatus: azure.loadAzureAuthStatus,
    loadAzureInventory: azure.loadAzureInventory,
    listAzureOperations: azure.listAzureOperations,
    summarizeInventory: azure.summarizeInventory,
    searchAzureInventory: azure.searchAzureInventory,
    diffInventory: azure.diffInventory,
    statusAzure: azure.statusAzure,
    ensureAzureCapabilities: azure.ensureAzureCapabilities,
    getAzureContext: azure.getAzureContext,
    loginAzure: azure.loginAzure,
    setAzureSubscription: azure.setAzureSubscription,
    syncAzureInventory: azure.syncAzureInventory,
    executeAzureRead: azure.executeAzureRead,
    planAzureOperation: azure.planAzureOperation,
    applyAzureOperation: azure.applyAzureOperation,
    azureDoctor: azure.azureDoctor,
    redactObject: azure.redactObject,
  },

  /** Um único objeto com verificações tipo `doctor` + relatório de saúde. */
  runDoctorChecks,
};


// Re-exports from @oxe/runtime (R1 — Runtime Foundation)
// The compiled runtime lives at lib/runtime/ alongside this file.
try {
  const runtime = require('../runtime/index.js');
  Object.assign(module.exports, runtime);
} catch {
  // Runtime not built yet — safe to skip during development
}
