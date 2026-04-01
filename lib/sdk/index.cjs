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
 * Verificações alinhadas ao `oxe-cc doctor`, com resultado estruturado (CI / gateways).
 *
 * @param {{
 *   projectRoot: string,
 *   packageRoot?: string,
 *   nodeMajor?: number,
 *   includeWorkflowLint?: boolean,
 *   workflowLintOptions?: { maxBytesSoft?: number },
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

  /** Estado do projeto, SPEC/PLAN, fase, config. */
  health: {
    loadOxeConfigMerged: health.loadOxeConfigMerged,
    validateConfigShape: health.validateConfigShape,
    buildHealthReport: health.buildHealthReport,
    suggestNextStep: health.suggestNextStep,
    oxePaths: health.oxePaths,
    parseStatePhase: health.parseStatePhase,
    parseLastScanDate: health.parseLastScanDate,
    isStaleScan: health.isStaleScan,
    phaseCoherenceWarnings: health.phaseCoherenceWarnings,
    specSectionWarnings: health.specSectionWarnings,
    planWaveWarningsFixed: health.planWaveWarningsFixed,
    planTaskAceiteWarnings: health.planTaskAceiteWarnings,
    verifyGapsWithoutSummaryWarning: health.verifyGapsWithoutSummaryWarning,
    ALLOWED_CONFIG_KEYS: health.ALLOWED_CONFIG_KEYS,
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

  /** Um único objeto com verificações tipo `doctor` + relatório de saúde. */
  runDoctorChecks,
};
