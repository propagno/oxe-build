'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const operational = require('./oxe-operational.cjs');
const azure = require('./oxe-azure.cjs');

/** @type {string[]} */
const ALLOWED_CONFIG_KEYS = [
  'discuss_before_plan',
  'after_verify_suggest_pr',
  'after_verify_draft_commit',
  'after_verify_suggest_uat',
  'default_verify_command',
  'scan_max_age_days',
  'compact_max_age_days',
  'lessons_max_age_days',
  'scan_focus_globs',
  'scan_ignore_globs',
  'spec_required_sections',
  'plan_max_tasks_per_wave',
  'profile',
  'verification_depth',
  'plan_confidence_threshold',
  'security_in_verify',
  'install',
  'plugins',
  'workstreams',
  'milestones',
  'scale_adaptive',
  'permissions',
  'azure',
];

/**
 * Profiles de execução OXE que controlam rigor do workflow.
 * Expansão de keys: profile 'strict' liga discuss_before_plan, verification_depth thorough, etc.
 */
const EXECUTION_PROFILES = ['strict', 'balanced', 'fast', 'legacy'];

/**
 * Profundidade de verificação.
 */
const VERIFICATION_DEPTHS = ['standard', 'thorough', 'quick'];

/** Perfis de integração lidos de `.oxe/config.json` → `install.profile` (CLI explícita prevalece). */
const INSTALL_PROFILES = ['recommended', 'cursor', 'copilot', 'core', 'cli', 'all_agents'];

/** Layout do repositório: `nested` = só `.oxe/`; `classic` = `oxe/` na raiz + `.oxe/`. */
const INSTALL_REPO_LAYOUTS = ['nested', 'classic'];

/** @type {string[]} */
const INSTALL_OBJECT_KEYS = ['profile', 'repo_layout', 'vscode', 'include_commands_dir', 'include_agents_md'];

const EXPECTED_CODEBASE_MAPS = [
  'OVERVIEW.md',
  'STACK.md',
  'STRUCTURE.md',
  'TESTING.md',
  'INTEGRATIONS.md',
  'CONVENTIONS.md',
  'CONCERNS.md',
];

/**
 * @param {string} targetProject
 */
/**
 * Expande um profile de execução nas suas keys individuais.
 * Keys explícitas no config prevalecem sobre o profile.
 * @param {string} profile
 * @returns {Record<string, unknown>}
 */
function expandExecutionProfile(profile) {
  const profiles = {
    strict: {
      discuss_before_plan: true,
      verification_depth: 'thorough',
      after_verify_suggest_uat: true,
      after_verify_suggest_pr: true,
      after_verify_draft_commit: true,
      scan_max_age_days: 14,
      compact_max_age_days: 30,
    },
    balanced: {
      discuss_before_plan: false,
      verification_depth: 'standard',
      after_verify_suggest_uat: false,
      after_verify_suggest_pr: true,
      after_verify_draft_commit: true,
      scan_max_age_days: 0,
      compact_max_age_days: 0,
    },
    fast: {
      discuss_before_plan: false,
      verification_depth: 'quick',
      after_verify_suggest_uat: false,
      after_verify_suggest_pr: false,
      after_verify_draft_commit: true,
      scan_max_age_days: 0,
      compact_max_age_days: 0,
    },
    legacy: {
      discuss_before_plan: true,
      verification_depth: 'thorough',
      after_verify_suggest_uat: true,
      after_verify_suggest_pr: false,
      after_verify_draft_commit: false,
      scan_max_age_days: 0,
      compact_max_age_days: 0,
    },
  };
  return profiles[profile] || {};
}

/**
 * Lê um JSON config de um caminho; retorna null se não existir ou falhar.
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function _readJsonConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * Carrega e mescla config em 3 níveis: system < user < project (project tem maior prioridade).
 * Retorna { config, path, parseError, sources }.
 * @param {string} targetProject
 */
function loadOxeConfigMerged(targetProject) {
  const defaults = {
    discuss_before_plan: false,
    after_verify_suggest_pr: true,
    after_verify_draft_commit: true,
    after_verify_suggest_uat: false,
    verification_depth: 'standard',
    plan_confidence_threshold: 70,
    default_verify_command: '',
    scan_max_age_days: 0,
    compact_max_age_days: 0,
    scan_focus_globs: [],
    scan_ignore_globs: [],
    spec_required_sections: [],
    plan_max_tasks_per_wave: 0,
    azure: {
      enabled: false,
      default_resource_group: '',
      preferred_locations: [],
      inventory_max_age_hours: 24,
      resource_graph_auto_install: true,
      vpn_required: false,
    },
  };

  const sources = { system: null, user: null, project: null };

  // Nível system: OXE_SYSTEM_CONFIG env var → fallback OS-specific
  const systemPath = process.env.OXE_SYSTEM_CONFIG
    || (process.platform === 'win32'
      ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'oxe', 'config.json')
      : '/etc/oxe/config.json');
  const systemCfg = _readJsonConfig(systemPath);
  if (systemCfg) sources.system = systemPath;

  // Nível user: ~/.oxe/config.json
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const userPath = home ? path.join(home, '.oxe', 'config.json') : null;
  const userCfg = userPath ? _readJsonConfig(userPath) : null;
  if (userCfg) sources.user = userPath;

  // Nível project: .oxe/config.json (comportamento existente)
  const projectPath = path.join(targetProject, '.oxe', 'config.json');
  let projectCfg = null;
  let projectParseError = null;
  if (fs.existsSync(projectPath)) {
    try {
      const raw = fs.readFileSync(projectPath, 'utf8');
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object' || Array.isArray(j)) {
        projectParseError = 'não é um objeto';
      } else {
        projectCfg = j;
      }
    } catch (e) {
      projectParseError = String(e.message || e);
    }
  }
  if (projectCfg) sources.project = projectPath;

  // Merge: system < user < project (project vence)
  const merged = { ...defaults };
  for (const layer of [systemCfg, userCfg, projectCfg]) {
    if (!layer) continue;
    // Expandir profile se presente nesta camada
    if (typeof layer.profile === 'string') {
      Object.assign(merged, expandExecutionProfile(layer.profile));
    }
    // Azure: merge aninhado para não sobrescrever campos não especificados
    if (layer.azure && typeof layer.azure === 'object' && !Array.isArray(layer.azure)) {
      merged.azure = { .../** @type {any} */ (merged.azure), ...layer.azure };
      const layerWithoutAzure = { ...layer };
      delete layerWithoutAzure.azure;
      Object.assign(merged, layerWithoutAzure);
    } else {
      Object.assign(merged, layer);
    }
  }

  const primaryPath = sources.project || sources.user || sources.system || null;
  return { config: merged, path: primaryPath, parseError: projectParseError, sources };
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {{ unknownKeys: string[], typeErrors: string[] }}
 */
function validateConfigShape(cfg) {
  const unknownKeys = Object.keys(cfg).filter((k) => !ALLOWED_CONFIG_KEYS.includes(k));
  const typeErrors = [];
  if (cfg.install != null) {
    if (typeof cfg.install !== 'object' || Array.isArray(cfg.install)) {
      typeErrors.push('install deve ser um objeto');
    } else {
      const inst = /** @type {Record<string, unknown>} */ (cfg.install);
      for (const k of Object.keys(inst)) {
        if (!INSTALL_OBJECT_KEYS.includes(k)) {
          typeErrors.push(`install: chave desconhecida "${k}"`);
        }
      }
      if (inst.profile != null) {
        if (typeof inst.profile !== 'string') {
          typeErrors.push('install.profile deve ser string');
        } else if (!INSTALL_PROFILES.includes(inst.profile)) {
          typeErrors.push(
            `install.profile deve ser um de: ${INSTALL_PROFILES.join(', ')}`
          );
        }
      }
      if (inst.repo_layout != null) {
        if (typeof inst.repo_layout !== 'string') {
          typeErrors.push('install.repo_layout deve ser string');
        } else if (!INSTALL_REPO_LAYOUTS.includes(inst.repo_layout)) {
          typeErrors.push(
            `install.repo_layout deve ser "nested" ou "classic"`
          );
        }
      }
      if (inst.vscode != null && typeof inst.vscode !== 'boolean') {
        typeErrors.push('install.vscode deve ser boolean');
      }
      if (inst.include_commands_dir != null && typeof inst.include_commands_dir !== 'boolean') {
        typeErrors.push('install.include_commands_dir deve ser boolean');
      }
      if (inst.include_agents_md != null && typeof inst.include_agents_md !== 'boolean') {
        typeErrors.push('install.include_agents_md deve ser boolean');
      }
    }
  }
  if (cfg.scan_max_age_days != null && typeof cfg.scan_max_age_days !== 'number') {
    typeErrors.push('scan_max_age_days deve ser número (use 0 para desligar aviso de scan antigo)');
  }
  if (cfg.compact_max_age_days != null && typeof cfg.compact_max_age_days !== 'number') {
    typeErrors.push('compact_max_age_days deve ser número (use 0 para desligar aviso de compact antigo)');
  }
  if (cfg.plan_max_tasks_per_wave != null && typeof cfg.plan_max_tasks_per_wave !== 'number') {
    typeErrors.push('plan_max_tasks_per_wave deve ser número (use 0 para desligar)');
  }
  if (cfg.scan_focus_globs != null && !Array.isArray(cfg.scan_focus_globs)) {
    typeErrors.push('scan_focus_globs deve ser array de strings');
  }
  if (cfg.scan_ignore_globs != null && !Array.isArray(cfg.scan_ignore_globs)) {
    typeErrors.push('scan_ignore_globs deve ser array de strings');
  }
  if (cfg.spec_required_sections != null && !Array.isArray(cfg.spec_required_sections)) {
    typeErrors.push('spec_required_sections deve ser array de strings (cabeçalhos ## …)');
  }
  if (cfg.profile != null) {
    if (typeof cfg.profile !== 'string') {
      typeErrors.push('profile deve ser string');
    } else if (!EXECUTION_PROFILES.includes(cfg.profile)) {
      typeErrors.push(`profile deve ser um de: ${EXECUTION_PROFILES.join(', ')}`);
    }
  }
  if (cfg.verification_depth != null) {
    if (typeof cfg.verification_depth !== 'string') {
      typeErrors.push('verification_depth deve ser string');
    } else if (!VERIFICATION_DEPTHS.includes(cfg.verification_depth)) {
      typeErrors.push(`verification_depth deve ser um de: ${VERIFICATION_DEPTHS.join(', ')}`);
    }
  }
  if (cfg.plan_confidence_threshold != null && typeof cfg.plan_confidence_threshold !== 'number') {
    typeErrors.push('plan_confidence_threshold deve ser número (percentual de 0 a 100)');
  }
  if (cfg.after_verify_suggest_uat != null && typeof cfg.after_verify_suggest_uat !== 'boolean') {
    typeErrors.push('after_verify_suggest_uat deve ser boolean');
  }
  if (cfg.scale_adaptive != null && typeof cfg.scale_adaptive !== 'boolean') {
    typeErrors.push('scale_adaptive deve ser boolean');
  }
  if (cfg.azure != null) {
    if (typeof cfg.azure !== 'object' || Array.isArray(cfg.azure)) {
      typeErrors.push('azure deve ser um objeto');
    } else {
      const azureCfg = /** @type {Record<string, unknown>} */ (cfg.azure);
      const allowedAzureKeys = [
        'enabled',
        'default_resource_group',
        'preferred_locations',
        'inventory_max_age_hours',
        'resource_graph_auto_install',
        'vpn_required',
      ];
      for (const key of Object.keys(azureCfg)) {
        if (!allowedAzureKeys.includes(key)) {
          typeErrors.push(`azure: chave desconhecida "${key}"`);
        }
      }
      if (azureCfg.enabled != null && typeof azureCfg.enabled !== 'boolean') {
        typeErrors.push('azure.enabled deve ser boolean');
      }
      if (azureCfg.default_resource_group != null && typeof azureCfg.default_resource_group !== 'string') {
        typeErrors.push('azure.default_resource_group deve ser string');
      }
      if (azureCfg.preferred_locations != null && !Array.isArray(azureCfg.preferred_locations)) {
        typeErrors.push('azure.preferred_locations deve ser array de strings');
      }
      if (azureCfg.inventory_max_age_hours != null && typeof azureCfg.inventory_max_age_hours !== 'number') {
        typeErrors.push('azure.inventory_max_age_hours deve ser número');
      }
      if (azureCfg.resource_graph_auto_install != null && typeof azureCfg.resource_graph_auto_install !== 'boolean') {
        typeErrors.push('azure.resource_graph_auto_install deve ser boolean');
      }
      if (azureCfg.vpn_required != null && typeof azureCfg.vpn_required !== 'boolean') {
        typeErrors.push('azure.vpn_required deve ser boolean');
      }
    }
  }
  if (cfg.permissions != null) {
    if (!Array.isArray(cfg.permissions)) {
      typeErrors.push('permissions deve ser array de regras { pattern, action, scope? }');
    } else {
      const VALID_PERM_ACTIONS = ['allow', 'deny', 'ask'];
      const VALID_PERM_SCOPES = ['execute', 'apply', 'all'];
      for (let i = 0; i < cfg.permissions.length; i++) {
        const r = cfg.permissions[i];
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          typeErrors.push(`permissions[${i}] deve ser objeto`);
          continue;
        }
        if (typeof r.pattern !== 'string' || r.pattern.length === 0) {
          typeErrors.push(`permissions[${i}].pattern deve ser string não-vazia`);
        }
        if (!VALID_PERM_ACTIONS.includes(r.action)) {
          typeErrors.push(`permissions[${i}].action deve ser um de: ${VALID_PERM_ACTIONS.join(', ')}`);
        }
        if (r.scope != null && !VALID_PERM_SCOPES.includes(r.scope)) {
          typeErrors.push(`permissions[${i}].scope deve ser um de: ${VALID_PERM_SCOPES.join(', ')}`);
        }
      }
    }
  }
  if (cfg.plugins != null) {
    if (!Array.isArray(cfg.plugins)) {
      typeErrors.push('plugins deve ser array');
    } else {
      for (let i = 0; i < cfg.plugins.length; i++) {
        const p = cfg.plugins[i];
        if (typeof p === 'string') continue; // aceitar strings legado
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          typeErrors.push(`plugins[${i}] deve ser string ou objeto { source: string }`);
        } else if (typeof p.source !== 'string' || p.source.length === 0) {
          typeErrors.push(`plugins[${i}].source deve ser string não-vazia`);
        }
      }
    }
  }
  return { unknownKeys, typeErrors };
}

/**
 * @param {string} stateText
 * @returns {string | null}
 */
function parseStatePhase(stateText) {
  const m = stateText.match(/##\s*Fase atual\s*\n+\s*`([^`]+)`/im);
  return m ? m[1].trim().split(/\s/)[0] : null;
}

/**
 * @param {string} stateText
 * @returns {Date | null}
 */
function parseLastScanDate(stateText) {
  const sec = stateText.match(/##\s*Último scan\s*([\s\S]*?)(?=\n## |\n#[^\#]|$)/im);
  if (!sec) return null;
  const dm = sec[1].match(/\*\*Data:\*\*\s*(.+)/i);
  if (!dm) return null;
  let raw = dm[1].trim();
  if (/^\([^)]*\)$/.test(raw) || /placeholder|legível|ISO/i.test(raw)) return null;
  if (raw.startsWith('(')) return null;
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) return new Date(iso);
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const d = new Date(parseInt(br[3], 10), parseInt(br[2], 10) - 1, parseInt(br[1], 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Data do último `/oxe-compact` em STATE.md (secção **Último compact**).
 * @param {string} stateText
 * @returns {Date | null}
 */
function parseLastCompactDate(stateText) {
  const sec = stateText.match(/##\s*Último compact[^\n]*\s*([\s\S]*?)(?=\n## |\n#[^\#]|$)/im);
  if (!sec) return null;
  const dm = sec[1].match(/\*\*Data:\*\*\s*(.+)/i);
  if (!dm) return null;
  let raw = dm[1].trim();
  if (/^\([^)]*\)$/.test(raw) || /placeholder|legível|YYYY-MM-DD/i.test(raw)) return null;
  if (raw.startsWith('(')) return null;
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) return new Date(iso);
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const d = new Date(parseInt(br[3], 10), parseInt(br[2], 10) - 1, parseInt(br[1], 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Data do último `/oxe-retro` em STATE.md (campo `last_retro: YYYY-MM-DD`).
 * @param {string} stateText
 * @returns {Date | null}
 */
function parseLastRetroDate(stateText) {
  const m = stateText.match(/\blast_retro\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const iso = Date.parse(m[1]);
  return Number.isNaN(iso) ? null : new Date(iso);
}

/**
 * @param {string} stateText
 * @returns {string | null}
 */
function parseActiveSession(stateText) {
  if (!stateText) return null;
  const m = stateText.match(/\*\*active_session:\*\*\s*`?([^\n`]+?)`?\s*(?:\n|$)/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw === '—' || /^none$/i.test(raw)) return null;
  return raw.replace(/\\/g, '/');
}

/**
 * @param {string} stateText
 * @returns {string | null}
 */
function parsePlanReviewStatus(stateText) {
  if (!stateText) return null;
  const m = stateText.match(/\*\*plan_review_status:\*\*\s*`?([^\n`]+?)`?\s*(?:\n|$)/i);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw === '—' || /^none$/i.test(raw)) return null;
  return raw;
}

/**
 * @param {Date | null} scanDate
 * @param {number} maxAgeDays 0 = desligado
 */
function isStaleScan(scanDate, maxAgeDays) {
  if (!scanDate || !maxAgeDays || maxAgeDays <= 0) return { stale: false, days: null };
  const days = (Date.now() - scanDate.getTime()) / 86400000;
  return { stale: days > maxAgeDays, days: Math.floor(days) };
}

/**
 * Alias semântico para verificar se LESSONS.md está desatualizado.
 * Reutiliza a lógica de isStaleScan.
 * @param {Date | null} retroDate
 * @param {number} maxAgeDays 0 = desligado
 */
function isStaleLessons(retroDate, maxAgeDays) {
  return isStaleScan(retroDate, maxAgeDays);
}

/**
 * @param {string} target
 */
function oxePaths(target) {
  const oxe = path.join(target, '.oxe');
  return {
    oxe,
    installDir: path.join(oxe, 'install'),
    contextDir: path.join(oxe, 'context'),
    contextIndex: path.join(oxe, 'context', 'index.json'),
    contextPacksDir: path.join(oxe, 'context', 'packs'),
    contextSummariesDir: path.join(oxe, 'context', 'summaries'),
    state: path.join(oxe, 'STATE.md'),
    runtime: path.join(oxe, 'EXECUTION-RUNTIME.md'),
    checkpoints: path.join(oxe, 'CHECKPOINTS.md'),
    capabilitiesIndex: path.join(oxe, 'CAPABILITIES.md'),
    capabilitiesDir: path.join(oxe, 'capabilities'),
    investigationsIndex: path.join(oxe, 'INVESTIGATIONS.md'),
    investigationsDir: path.join(oxe, 'investigations'),
    dashboardDir: path.join(oxe, 'dashboard'),
    sessionsIndex: path.join(oxe, 'SESSIONS.md'),
    globalDir: path.join(oxe, 'global'),
    globalLessons: path.join(oxe, 'global', 'LESSONS.md'),
    globalMilestones: path.join(oxe, 'global', 'MILESTONES.md'),
    globalMilestonesDir: path.join(oxe, 'global', 'milestones'),
    sessionsDir: path.join(oxe, 'sessions'),
    planReview: path.join(oxe, 'PLAN-REVIEW.md'),
    planReviewComments: path.join(oxe, 'plan-review-comments.json'),
    activeRun: path.join(oxe, 'ACTIVE-RUN.json'),
    runsDir: path.join(oxe, 'runs'),
    events: path.join(oxe, 'OXE-EVENTS.ndjson'),
    copilotManifest: path.join(oxe, 'install', 'copilot-vscode.json'),
    runtimeSemanticsManifest: path.join(oxe, 'install', 'runtime-semantics.json'),
    spec: path.join(oxe, 'SPEC.md'),
    plan: path.join(oxe, 'PLAN.md'),
    quick: path.join(oxe, 'QUICK.md'),
    verify: path.join(oxe, 'VERIFY.md'),
    discuss: path.join(oxe, 'DISCUSS.md'),
    summary: path.join(oxe, 'SUMMARY.md'),
    codebase: path.join(oxe, 'codebase'),
    lessons: path.join(oxe, 'LESSONS.md'),
    planAgents: path.join(oxe, 'plan-agents.json'),
  };
}

/**
 * @param {string} target
 * @param {string | null} activeSession
 */
function scopedOxePaths(target, activeSession) {
  const base = oxePaths(target);
  if (!activeSession) return { ...base, activeSession: null, scopedRoot: base.oxe };
  const sessionRoot = path.join(base.oxe, ...activeSession.split('/'));
  return {
    ...base,
    activeSession,
    scopedRoot: sessionRoot,
    sessionRoot,
    sessionManifest: path.join(sessionRoot, 'SESSION.md'),
    planReview: path.join(sessionRoot, 'plan', 'PLAN-REVIEW.md'),
    planReviewComments: path.join(sessionRoot, 'plan', 'plan-review-comments.json'),
    runtime: path.join(sessionRoot, 'execution', 'EXECUTION-RUNTIME.md'),
    checkpoints: path.join(sessionRoot, 'execution', 'CHECKPOINTS.md'),
    activeRun: path.join(sessionRoot, 'execution', 'ACTIVE-RUN.json'),
    runsDir: path.join(sessionRoot, 'execution', 'runs'),
    events: path.join(sessionRoot, 'execution', 'OXE-EVENTS.ndjson'),
    investigationsIndex: path.join(sessionRoot, 'research', 'INVESTIGATIONS.md'),
    investigationsDir: path.join(sessionRoot, 'research', 'investigations'),
    spec: path.join(sessionRoot, 'spec', 'SPEC.md'),
    discuss: path.join(sessionRoot, 'spec', 'DISCUSS.md'),
    plan: path.join(sessionRoot, 'plan', 'PLAN.md'),
    quick: path.join(sessionRoot, 'plan', 'QUICK.md'),
    verify: path.join(sessionRoot, 'verification', 'VERIFY.md'),
    summary: path.join(sessionRoot, 'verification', 'SUMMARY.md'),
    executionState: path.join(sessionRoot, 'execution', 'STATE.md'),
  };
}

/**
 * @param {string} target
 */
function copilotWorkspacePaths(target) {
  return {
    root: path.join(target, '.github'),
    promptsDir: path.join(target, '.github', 'prompts'),
    instructions: path.join(target, '.github', 'copilot-instructions.md'),
    manifest: path.join(target, '.oxe', 'install', 'copilot-vscode.json'),
  };
}

function copilotLegacyHome() {
  if (process.env.COPILOT_CONFIG_DIR) return path.resolve(process.env.COPILOT_CONFIG_DIR);
  if (process.env.COPILOT_HOME) return path.resolve(process.env.COPILOT_HOME);
  return path.join(os.homedir(), '.copilot');
}

function copilotLegacyPaths() {
  const root = copilotLegacyHome();
  return {
    root,
    promptsDir: path.join(root, 'prompts'),
    instructions: path.join(root, 'copilot-instructions.md'),
  };
}

/**
 * @param {string} filePath
 */
function readJsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, data: null, error: null };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listOxePromptFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^oxe-.*\.prompt\.md$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function hasOxeInstructionBlock(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  return text.includes('<!-- oxe-cc:install-begin -->') && text.includes('<!-- oxe-cc:install-end -->');
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function hasOtherManagedInstructionBlocks(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  const withoutOxe = text
    .replace(/<!-- oxe-cc:install-begin -->[\s\S]*?<!-- oxe-cc:install-end -->/g, '')
    .trim();
  if (!withoutOxe) return false;
  return /<!--[^>]*(managed|configuration|install-begin|install-end)[^>]*-->/i.test(withoutOxe);
}

/**
 * @param {string} filePath
 * @param {string} target
 * @returns {string[]}
 */
function promptWorkflowPathWarnings(filePath, target) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const hasClassicRef = /(^|[`"'(\s])oxe\/workflows\//i.test(text);
  const hasNestedRef = /(^|[`"'(\s])\.oxe\/workflows\//i.test(text);
  const classicExists = fs.existsSync(path.join(target, 'oxe', 'workflows'));
  const nestedExists = fs.existsSync(path.join(target, '.oxe', 'workflows'));
  /** @type {string[]} */
  const warnings = [];
  if (nestedExists && !classicExists && hasClassicRef && !hasNestedRef) {
    warnings.push(`${path.basename(filePath)} aponta para oxe/workflows/, mas este projeto usa .oxe/workflows/`);
  }
  if (classicExists && !nestedExists && hasNestedRef && !hasClassicRef) {
    warnings.push(`${path.basename(filePath)} aponta para .oxe/workflows/, mas este projeto usa oxe/workflows/`);
  }
  return warnings;
}

/**
 * @param {string} target
 */
function copilotIntegrationReport(target) {
  const workspace = copilotWorkspacePaths(target);
  const legacy = copilotLegacyPaths();
  const workspacePromptFiles = listOxePromptFiles(workspace.promptsDir);
  const legacyPromptFiles = listOxePromptFiles(legacy.promptsDir);
  const workspaceHasInstructions = fs.existsSync(workspace.instructions);
  const workspaceHasOxeBlock = hasOxeInstructionBlock(workspace.instructions);
  const legacyHasInstructions = fs.existsSync(legacy.instructions);
  const legacyHasOxeBlock = hasOxeInstructionBlock(legacy.instructions);
  const legacyHasOtherManagedBlocks = hasOtherManagedInstructionBlocks(legacy.instructions);
  const manifestRaw = readJsonFileSafe(workspace.manifest);
  const manifest = manifestRaw.ok ? manifestRaw.data : null;
  const promptPathWarnings = [];
  for (const filePath of workspacePromptFiles) {
    for (const warning of promptWorkflowPathWarnings(filePath, target)) promptPathWarnings.push(warning);
  }
  for (const warning of promptWorkflowPathWarnings(workspace.instructions, target)) promptPathWarnings.push(warning);

  /** @type {string[]} */
  const warnings = [];
  const workspaceDetected =
    workspacePromptFiles.length > 0 || workspaceHasInstructions || fs.existsSync(workspace.manifest);
  const legacyDetected = legacyPromptFiles.length > 0 || legacyHasOxeBlock;

  if (workspacePromptFiles.length > 0 && !workspaceHasInstructions) {
    warnings.push('Prompts OXE do Copilot VS Code existem no workspace, mas .github/copilot-instructions.md está ausente');
  } else if (workspaceHasInstructions && !workspaceHasOxeBlock) {
    warnings.push('.github/copilot-instructions.md existe, mas não contém o bloco OXE');
  }
  if (workspaceHasInstructions && workspacePromptFiles.length === 0 && !legacyDetected) {
    warnings.push('.github/copilot-instructions.md existe, mas .github/prompts/ não contém prompt files OXE');
  }
  if (!workspaceDetected && legacyDetected) {
    warnings.push('Prompts OXE do Copilot VS Code foram encontrados apenas no legado global ~/.copilot/; sincronize .github/ no workspace');
  }
  if (legacyPromptFiles.length > 0) {
    warnings.push('Instalação legado do Copilot VS Code detectada em ~/.copilot/prompts/; trate como resíduo ou execute uninstall --copilot-legacy-clean');
  }
  if (legacyHasOxeBlock) {
    warnings.push('Bloco OXE legado detectado em ~/.copilot/copilot-instructions.md');
  }
  if (legacyHasOtherManagedBlocks) {
    warnings.push('copilot-instructions global contém blocos geridos por outro framework; isso pode contaminar respostas do Copilot');
  }
  if (!manifestRaw.ok && fs.existsSync(workspace.manifest)) {
    warnings.push(`Manifesto Copilot VS Code inválido: ${manifestRaw.error}`);
  } else if (!fs.existsSync(workspace.manifest) && workspacePromptFiles.length > 0) {
    warnings.push('Manifesto .oxe/install/copilot-vscode.json ausente para a integração Copilot VS Code');
  } else if (manifest && Array.isArray(manifest.prompt_files)) {
    const actualPromptNames = workspacePromptFiles.map((filePath) => path.basename(filePath)).sort();
    const expectedPromptNames = manifest.prompt_files.map((value) => String(value)).sort();
    for (const name of expectedPromptNames) {
      if (!actualPromptNames.includes(name)) {
        warnings.push(`Manifesto Copilot VS Code referencia ${name}, mas o arquivo não existe em .github/prompts/`);
      }
    }
  }
  for (const warning of promptPathWarnings) warnings.push(warning);

  let status = 'not_installed';
  if (
    workspacePromptFiles.length > 0 &&
    workspaceHasInstructions &&
    workspaceHasOxeBlock &&
    promptPathWarnings.length === 0
  ) {
    status = warnings.length ? 'warning' : 'healthy';
  } else if (workspaceDetected || legacyDetected) {
    status =
      promptPathWarnings.length > 0 || (workspacePromptFiles.length > 0 && (!workspaceHasInstructions || !workspaceHasOxeBlock))
        ? 'broken'
        : 'warning';
  }

  return {
    status,
    detected: workspaceDetected || legacyDetected,
    target: 'workspace',
    promptSource:
      workspacePromptFiles.length > 0 ? 'workspace' : legacyDetected ? 'legacy_global' : 'missing',
    workspace: {
      root: workspace.root,
      promptsDir: workspace.promptsDir,
      instructions: workspace.instructions,
      manifest: workspace.manifest,
      promptFiles: workspacePromptFiles,
      hasInstructions: workspaceHasInstructions,
      hasOxeBlock: workspaceHasOxeBlock,
    },
    legacy: {
      root: legacy.root,
      promptsDir: legacy.promptsDir,
      instructions: legacy.instructions,
      promptFiles: legacyPromptFiles,
      hasInstructions: legacyHasInstructions,
      hasOxeBlock: legacyHasOxeBlock,
      hasOtherManagedBlocks: legacyHasOtherManagedBlocks,
      detected: legacyDetected,
    },
    manifest,
    warnings,
  };
}

/**
 * Valida o arquivo plan-agents.json (se existir) e retorna avisos.
 * @param {string} target
 * @returns {string[]}
 */
function planAgentsWarnings(target) {
  const p = oxePaths(target);
  if (!fs.existsSync(p.planAgents)) return [];
  /** @type {string[]} */
  const warns = [];
  let json;
  try {
    json = JSON.parse(fs.readFileSync(p.planAgents, 'utf8'));
  } catch {
    warns.push('plan-agents.json existe mas não é JSON válido');
    return warns;
  }
  const schema = json.oxePlanAgentsSchema;
  if (schema === 1) {
    warns.push('plan-agents.json usa schema 1 (legado) — regere com /oxe-plan-agent para schema 3');
  }
  if (Array.isArray(json.agents)) {
    const VALID_HINTS = new Set(['fast', 'balanced', 'powerful']);
    for (const agent of json.agents) {
      if (agent.model_hint && !VALID_HINTS.has(agent.model_hint)) {
        warns.push(
          `plan-agents.json agente "${agent.id || '?'}": model_hint "${agent.model_hint}" inválido — use fast | balanced | powerful`
        );
      }
    }
  }
  return warns;
}

/**
 * @param {string} phase
 * @param {ReturnType<typeof oxePaths>} p
 */
function phaseCoherenceWarnings(phase, p) {
  /** @type {string[]} */
  const w = [];
  if (!phase) return w;
  const has = (/** @type {string} */ f) => fs.existsSync(f);
  const mapsComplete = EXPECTED_CODEBASE_MAPS.every((f) => has(path.join(p.codebase, f)));

  if (phase === 'scan_complete' && !mapsComplete) {
    w.push(`Fase \`${phase}\` no STATE, mas faltam mapas em .oxe/codebase/ — rode /oxe-scan`);
  }
  if ((phase === 'spec_ready' || phase === 'discuss_complete' || phase === 'plan_ready') && !has(p.spec)) {
    w.push(`Fase \`${phase}\` no STATE, mas .oxe/SPEC.md não existe`);
  }
  if (phase === 'discuss_complete' && !has(p.discuss)) {
    w.push(`Fase \`${phase}\` no STATE, mas .oxe/DISCUSS.md não existe`);
  }
  if (phase === 'plan_ready' && !has(p.plan) && !has(p.quick)) {
    w.push(`Fase \`${phase}\` no STATE, mas não há .oxe/PLAN.md nem QUICK.md`);
  }
  if (phase === 'quick_active' && !has(p.quick)) {
    w.push(`Fase \`${phase}\` no STATE, mas .oxe/QUICK.md não existe`);
  }
  if ((phase === 'executing' || phase === 'verify_complete' || phase === 'verify_failed') && !has(p.plan) && !has(p.quick)) {
    w.push(`Fase \`${phase}\` no STATE, mas não há PLAN.md nem QUICK.md`);
  }
  if ((phase === 'verify_complete' || phase === 'verify_failed') && !has(p.verify)) {
    w.push(`Fase \`${phase}\` no STATE, mas .oxe/VERIFY.md não existe`);
  }
  return w;
}

/**
 * @param {string} verifyPath
 * @param {string} summaryPath
 */
function verifyGapsWithoutSummaryWarning(verifyPath, summaryPath) {
  if (!fs.existsSync(verifyPath)) return null;
  const t = fs.readFileSync(verifyPath, 'utf8');
  const m = t.match(/##+\s*Gaps\s*\n([\s\S]*?)(?=\n##+\s|\n#[^\#]|$)/im);
  if (!m) return null;
  const body = m[1].trim();
  if (body.length < 12) return null;
  if (fs.existsSync(summaryPath)) return null;
  return 'VERIFY.md tem seção Gaps com conteúdo, mas .oxe/SUMMARY.md não existe — crie a partir de oxe/templates/SUMMARY.template.md para replanejamento com contexto';
}

/**
 * @param {string} specPath
 * @param {string[]} requiredHeadings lines like "## Critérios de aceite" or "Critérios de aceite"
 */
function specSectionWarnings(specPath, requiredHeadings) {
  if (!requiredHeadings.length || !fs.existsSync(specPath)) return [];
  const text = fs.readFileSync(specPath, 'utf8');
  /** @type {string[]} */
  const out = [];
  for (const h of requiredHeadings) {
    const needle = h.trim().startsWith('##') ? h.trim() : `## ${h.trim()}`;
    if (!text.includes(needle)) {
      out.push(`SPEC.md deve conter a seção "${needle}" (config spec_required_sections)`);
    }
  }
  return out;
}

/**
 * Avisos quando uma tarefa `### Tn` em PLAN.md não tem linha **Aceite vinculado:** no seu bloco.
 * @param {string} planPath
 * @returns {string[]}
 */
function planTaskAceiteWarnings(planPath) {
  if (!fs.existsSync(planPath)) return [];
  const raw = fs.readFileSync(planPath, 'utf8');
  const parts = raw.split(/^###\s+(T\d+)\s+/m);
  if (parts.length < 3) return [];
  /** @type {string[]} */
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const taskId = parts[i];
    const body = parts[i + 1] || '';
    if (!/\*\*Aceite\s+vinculado:\*\*/i.test(body)) {
      out.push(
        `PLAN.md: tarefa ${taskId} sem linha **Aceite vinculado:** — ligue cada Tn aos critérios A* da SPEC (ou declare gap explícito no plano)`
      );
    }
  }
  return out;
}

function planWaveWarningsFixed(planPath, maxPerWave) {
  if (!maxPerWave || maxPerWave <= 0 || !fs.existsSync(planPath)) return [];
  const raw = fs.readFileSync(planPath, 'utf8');
  const lines = raw.split('\n');
  /** @type {Record<string, number>} */
  const perWave = {};
  let currentWave = '0';
  for (const line of lines) {
    const wm = line.match(/\*\*Onda:\*\*\s*(\d+)/i);
    if (wm) currentWave = wm[1];
    if (/^###\s+T\d+/i.test(line.trim())) {
      perWave[currentWave] = (perWave[currentWave] || 0) + 1;
    }
  }
  /** @type {string[]} */
  const w = [];
  for (const [wN, count] of Object.entries(perWave)) {
    if (count > maxPerWave) {
      w.push(`PLAN.md: onda ${wN} tem ${count} tarefas (máximo configurado: ${maxPerWave} — considere dividir ondas)`);
    }
  }
  return w;
}

/**
 * @param {string} planPath
 * @returns {{
 *   hasSection: boolean,
 *   bestPlan: string | null,
 *   confidence: number | null,
 *   warnings: string[],
 * }}
 */
function parsePlanSelfEvaluation(planPath) {
  const empty = { hasSection: false, bestPlan: null, confidence: null, warnings: [] };
  if (!fs.existsSync(planPath)) return empty;
  const raw = fs.readFileSync(planPath, 'utf8');
  const m = raw.match(/##\s*Autoavaliação do Plano\s*([\s\S]*?)(?=\n## |\n#[^\#]|$)/i);
  if (!m) {
    return {
      ...empty,
      warnings: ['PLAN.md sem a seção obrigatória "## Autoavaliação do Plano"'],
    };
  }
  const body = m[1];
  const best = body.match(/\*\*Melhor plano atual:\*\*\s*(sim|não|nao)/i);
  const confidence = body.match(/\*\*Confiança:\*\*\s*(\d{1,3})\s*%/i);
  /** @type {string[]} */
  const warnings = [];
  const rubricLabels = [
    'Completude dos requisitos',
    'Dependências conhecidas',
    'Risco técnico',
    'Impacto no código existente',
    'Clareza da validação / testes',
    'Lacunas externas / decisões pendentes',
  ];
  if (!best) warnings.push('PLAN.md: autoavaliação sem "Melhor plano atual: sim|não"');
  if (!confidence) warnings.push('PLAN.md: autoavaliação sem "Confiança: NN%"');
  if (!/\*\*Principais incertezas:\*\*/i.test(body)) warnings.push('PLAN.md: autoavaliação sem "Principais incertezas"');
  if (!/\*\*Alternativas descartadas:\*\*/i.test(body)) warnings.push('PLAN.md: autoavaliação sem "Alternativas descartadas"');
  if (!/\*\*Condição para replanejar:\*\*/i.test(body)) warnings.push('PLAN.md: autoavaliação sem "Condição para replanejar"');
  for (const label of rubricLabels) {
    if (!body.includes(label)) warnings.push(`PLAN.md: rubrica sem "${label}"`);
  }
  const parsedConfidence = confidence ? Number(confidence[1]) : null;
  if (parsedConfidence != null && (parsedConfidence < 0 || parsedConfidence > 100)) {
    warnings.push('PLAN.md: confiança fora do intervalo 0–100%');
  }
  return {
    hasSection: true,
    bestPlan: best ? best[1].toLowerCase().replace('nao', 'não') : null,
    confidence: parsedConfidence,
    warnings,
  };
}

/**
 * @param {string} planPath
 * @param {number} threshold
 * @returns {string[]}
 */
function planSelfEvaluationWarnings(planPath, threshold) {
  const info = parsePlanSelfEvaluation(planPath);
  const warns = [...info.warnings];
  if (!fs.existsSync(planPath)) return warns;
  if (info.bestPlan === 'não') warns.push('PLAN.md: autoavaliação declara que este não é o melhor plano atual');
  if (info.confidence != null && info.confidence < threshold) {
    warns.push(`PLAN.md: confiança ${info.confidence}% abaixo do limiar executável (${threshold}%)`);
  }
  return warns;
}

/**
 * @param {string} target
 * @param {string | null} activeSession
 * @returns {string[]}
 */
function sessionWarnings(target, activeSession) {
  if (!activeSession) return [];
  const base = oxePaths(target);
  const scoped = scopedOxePaths(target, activeSession);
  /** @type {string[]} */
  const warns = [];
  if (!/^sessions\/s\d{3}-/.test(activeSession)) {
    warns.push(`active_session "${activeSession}" não segue o formato sessions/sNNN-slug`);
  }
  if (!fs.existsSync(scoped.sessionRoot)) {
    warns.push(`active_session aponta para ${activeSession}, mas a pasta da sessão não existe em .oxe/`);
    return warns;
  }
  if (!fs.existsSync(scoped.sessionManifest)) warns.push(`Sessão ativa ${activeSession} sem SESSION.md`);
  if (!fs.existsSync(base.sessionsIndex)) warns.push('Sessão ativa definida, mas .oxe/SESSIONS.md não existe');
  return warns;
}

/**
 * @param {string} target
 * @returns {string[]}
 */
function installationCompletenessWarnings(target) {
  const p = oxePaths(target);
  /** @type {string[]} */
  const warns = [];
  if (!fs.existsSync(p.oxe)) return warns;
  if (!fs.existsSync(p.globalDir)) warns.push('.oxe/global/ ausente');
  if (!fs.existsSync(p.globalLessons)) warns.push('.oxe/global/LESSONS.md ausente');
  if (!fs.existsSync(p.globalMilestones)) warns.push('.oxe/global/MILESTONES.md ausente');
  if (!fs.existsSync(p.globalMilestonesDir)) warns.push('.oxe/global/milestones/ ausente');
  if (!fs.existsSync(p.sessionsDir)) warns.push('.oxe/sessions/ ausente');
  if (!fs.existsSync(p.capabilitiesDir)) warns.push('.oxe/capabilities/ ausente');
  if (!fs.existsSync(p.capabilitiesIndex)) warns.push('.oxe/CAPABILITIES.md ausente');
  if (!fs.existsSync(p.investigationsDir)) warns.push('.oxe/investigations/ ausente');
  if (!fs.existsSync(p.investigationsIndex)) warns.push('.oxe/INVESTIGATIONS.md ausente');
  if (!fs.existsSync(p.runtime)) warns.push('.oxe/EXECUTION-RUNTIME.md ausente');
  if (!fs.existsSync(p.checkpoints)) warns.push('.oxe/CHECKPOINTS.md ausente');
  if (!fs.existsSync(p.activeRun)) warns.push('.oxe/ACTIVE-RUN.json ausente');
  if (!fs.existsSync(p.runsDir)) warns.push('.oxe/runs/ ausente');
  if (!fs.existsSync(p.events)) warns.push('.oxe/OXE-EVENTS.ndjson ausente');
  if (azure.isAzureContextEnabled(target)) {
    const azurePaths = azure.azurePaths(target);
    if (!fs.existsSync(azurePaths.root)) warns.push('.oxe/cloud/azure/ ausente');
    if (!fs.existsSync(azurePaths.operationsDir)) warns.push('.oxe/cloud/azure/operations/ ausente');
    if (!fs.existsSync(azurePaths.profile)) warns.push('.oxe/cloud/azure/profile.json ausente');
    if (!fs.existsSync(azurePaths.authStatus)) warns.push('.oxe/cloud/azure/auth-status.json ausente');
  }
  return warns;
}

/**
 * @param {string} stateText
 * @param {ReturnType<typeof scopedOxePaths>} p
 * @returns {string[]}
 */
function runtimeWarnings(stateText, p) {
  /** @type {string[]} */
  const warns = [];
  const checkpointPending = /\*\*checkpoint_status:\*\*\s*`?pending_approval`?/i.test(stateText);
  const runtimeBlocked = /\*\*runtime_status:\*\*\s*`?(blocked|waiting_approval|failed)`?/i.test(stateText);
  if (checkpointPending && !fs.existsSync(p.checkpoints)) {
    warns.push('STATE.md indica checkpoint pendente, mas o índice de checkpoints não existe');
  }
  if (runtimeBlocked && !fs.existsSync(p.runtime)) {
    warns.push('STATE.md indica runtime bloqueado, mas EXECUTION-RUNTIME.md não existe');
  }
  if (fs.existsSync(p.runtime)) {
    const raw = fs.readFileSync(p.runtime, 'utf8');
    if (!/##\s*Checkpoints/i.test(raw)) warns.push('EXECUTION-RUNTIME.md sem seção "Checkpoints"');
    if (!/##\s*Agentes ativos/i.test(raw)) warns.push('EXECUTION-RUNTIME.md sem seção "Agentes ativos"');
    if (!/Run ID/i.test(raw)) warns.push('EXECUTION-RUNTIME.md sem referência explícita de Run ID');
    if (!/Tracing operacional/i.test(raw)) warns.push('EXECUTION-RUNTIME.md sem seção "Tracing operacional"');
  }
  if (!fs.existsSync(p.activeRun)) {
    warns.push('ACTIVE-RUN.json não existe para o escopo atual');
  }
  if (!fs.existsSync(p.events)) {
    warns.push('OXE-EVENTS.ndjson não existe para o escopo atual');
  }
  const runState = operational.readRunState(path.dirname(p.oxe), p.activeSession || null);
  const checkpointRows = [];
  if (fs.existsSync(p.checkpoints)) {
    const checkpointText = fs.readFileSync(p.checkpoints, 'utf8');
    for (const line of checkpointText.split('\n')) {
      const match = line.match(/^\|\s*(CP-[^|]+)\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*([^|]+)\|/i);
      if (!match) continue;
      checkpointRows.push({ id: match[1].trim(), status: match[2].trim() });
    }
  }
  for (const warn of operational.runtimeStateWarnings(runState, checkpointRows)) warns.push(warn);
  return warns;
}

/**
 * @param {ReturnType<typeof scopedOxePaths>} p
 * @returns {string[]}
 */
function capabilityWarnings(p) {
  /** @type {string[]} */
  const warns = [];
  if (fs.existsSync(p.capabilitiesDir) && !fs.existsSync(p.capabilitiesIndex)) {
    warns.push('Existem capabilities em .oxe/capabilities/, mas .oxe/CAPABILITIES.md não existe');
  }
  for (const warn of operational.capabilityCatalogWarnings(path.dirname(p.oxe))) warns.push(warn);
  return warns;
}

/**
 * @param {ReturnType<typeof scopedOxePaths>} p
 * @returns {string[]}
 */
function investigationWarnings(p) {
  /** @type {string[]} */
  const warns = [];
  if (fs.existsSync(p.investigationsDir) && !fs.existsSync(p.investigationsIndex)) {
    warns.push('Existe pasta de investigações, mas falta o índice INVESTIGATIONS.md');
  }
  return warns;
}

/**
 * @param {string} stateText
 * @param {ReturnType<typeof scopedOxePaths>} p
 * @returns {string[]}
 */
function planReviewWarnings(stateText, p) {
  /** @type {string[]} */
  const warns = [];
  const reviewStatus = parsePlanReviewStatus(stateText);
  if (fs.existsSync(p.plan) && !reviewStatus) {
    warns.push('PLAN.md existe, mas STATE.md não declara plan_review_status');
  }
  if (reviewStatus && !fs.existsSync(p.planReview)) {
    warns.push('STATE.md declara revisão do plano, mas PLAN-REVIEW.md não existe');
  }
  if (reviewStatus === 'needs_revision' || reviewStatus === 'rejected') {
    warns.push(`Plano em estado ${reviewStatus} — revisão adicional necessária antes de executar`);
  }
  return warns;
}

/**
 * Próximo passo único (espelha o workflow next.md).
 * @param {string} target
 * @param {{ discuss_before_plan?: boolean }} cfg
 */
function suggestNextStep(target, cfg = {}) {
  const base = oxePaths(target);
  const stateText = fs.existsSync(base.state) ? fs.readFileSync(base.state, 'utf8') : '';
  const p = scopedOxePaths(target, parseActiveSession(stateText));
  const discussBefore = Boolean(cfg.discuss_before_plan);
  const threshold = Number(cfg.plan_confidence_threshold) || 70;
  const has = (/** @type {string} */ f) => fs.existsSync(f);
  const mapsComplete = EXPECTED_CODEBASE_MAPS.every((f) => has(path.join(p.codebase, f)));
  const azureActive = azure.isAzureContextEnabled(target, cfg);

  if (!has(p.oxe) || !has(p.state)) {
    return {
      step: 'scan',
      cursorCmd: '/oxe-scan',
      reason: 'Pasta .oxe/ ou STATE.md ausente — inicialize com oxe-cc init-oxe e rode o primeiro scan',
      artifacts: ['.oxe/'],
    };
  }

  const phase = parseStatePhase(stateText);

  if (!mapsComplete && !has(p.quick)) {
    return {
      step: 'scan',
      cursorCmd: '/oxe-scan',
      reason: 'Mapas do codebase incompletos e sem QUICK.md — atualize o contexto com scan',
      artifacts: ['.oxe/codebase/'],
    };
  }

  if (azureActive) {
    const azureHealth = azure.azureDoctor(target, cfg, {
      autoInstall: false,
      write: false,
    });
    if (!azureHealth.authStatus || !azureHealth.authStatus.login_active) {
      return {
        step: 'azure-auth',
        cursorCmd: 'npx oxe-cc azure auth login',
        reason: 'Contexto Azure ativo, mas sem sessão Azure CLI autenticada',
        artifacts: ['.oxe/cloud/azure/profile.json', '.oxe/cloud/azure/auth-status.json'],
      };
    }
    if (!azureHealth.profile || !azureHealth.profile.subscription_id) {
      return {
        step: 'azure-auth',
        cursorCmd: 'npx oxe-cc azure auth set-subscription --subscription <id-ou-nome>',
        reason: 'Contexto Azure ativo, mas a subscription operacional ainda não está definida',
        artifacts: ['.oxe/cloud/azure/profile.json', '.oxe/cloud/azure/auth-status.json'],
      };
    }
    const maxAgeHours = cfg.azure && cfg.azure.inventory_max_age_hours != null
      ? Number(cfg.azure.inventory_max_age_hours)
      : 24;
    const syncedAt = Date.parse(String(azureHealth.inventory && azureHealth.inventory.synced_at || ''));
    const staleInventory =
      !azureHealth.inventory ||
      (maxAgeHours > 0 && !Number.isNaN(syncedAt) && ((Date.now() - syncedAt) / (1000 * 60 * 60)) > maxAgeHours);
    if (staleInventory) {
      return {
        step: 'azure-sync',
        cursorCmd: 'npx oxe-cc azure sync',
        reason: 'Contexto Azure ativo, mas o inventário está ausente ou stale',
        artifacts: ['.oxe/cloud/azure/inventory.json', '.oxe/cloud/azure/INVENTORY.md'],
      };
    }
  }

  if (phase === 'quick_active' || (has(p.quick) && !has(p.plan))) {
    return {
      step: 'execute',
      cursorCmd: '/oxe-execute',
      reason: 'Modo QUICK ativo ou PLAN ausente — execute passos do QUICK.md, depois /oxe-verify; se o trabalho cresceu, use /oxe-spec',
      artifacts: ['.oxe/QUICK.md', '.oxe/STATE.md'],
    };
  }

  if (!has(p.spec)) {
    return {
      step: 'spec',
      cursorCmd: '/oxe-spec',
      reason: 'Sem SPEC.md — defina o contrato antes do plano (ou /oxe-quick para trabalho pontual)',
      artifacts: ['.oxe/SPEC.md'],
    };
  }

  if (discussBefore && !has(p.discuss)) {
    return {
      step: 'discuss',
      cursorCmd: '/oxe-discuss',
      reason: 'discuss_before_plan está ativo e DISCUSS.md não existe — alinhe decisões antes do plano',
      artifacts: ['.oxe/DISCUSS.md'],
    };
  }

  if (!has(p.plan)) {
    return {
      step: 'plan',
      cursorCmd: '/oxe-plan',
      reason: 'SPEC existe mas PLAN.md não — gere o plano com verificação por tarefa',
      artifacts: ['.oxe/PLAN.md'],
    };
  }

  const selfEval = parsePlanSelfEvaluation(p.plan);
  if (selfEval.bestPlan === 'não' || (selfEval.confidence != null && selfEval.confidence < threshold)) {
    return {
      step: 'plan',
      cursorCmd: '/oxe-plan --replan',
      reason: `O plano atual ainda não atingiu confiança executável (limiar ${threshold}%)`,
      artifacts: ['.oxe/PLAN.md', '.oxe/STATE.md'],
    };
  }

  const reviewStatus = parsePlanReviewStatus(stateText);
  if (phase === 'plan_ready' && (reviewStatus === 'needs_revision' || reviewStatus === 'rejected')) {
    return {
      step: 'plan',
      cursorCmd: '/oxe-plan --replan',
      reason: `Revisão do plano em estado ${reviewStatus} — ajuste o plano antes de executar`,
      artifacts: ['.oxe/PLAN.md', '.oxe/PLAN-REVIEW.md', '.oxe/STATE.md'],
    };
  }
  if (phase === 'plan_ready' && (!reviewStatus || reviewStatus === 'draft' || reviewStatus === 'in_review')) {
    return {
      step: 'dashboard',
      cursorCmd: '/oxe-dashboard',
      reason: 'Plano pronto, mas ainda não passou por revisão/aprovação visual',
      artifacts: ['.oxe/PLAN.md', '.oxe/PLAN-REVIEW.md', '.oxe/STATE.md'],
    };
  }

  const activeRun = operational.readRunState(target, parseActiveSession(stateText));
  if (activeRun && activeRun.status === 'waiting_approval') {
    return {
      step: 'dashboard',
      cursorCmd: '/oxe-dashboard',
      reason: 'ACTIVE-RUN está aguardando aprovação formal antes de continuar',
      artifacts: ['.oxe/ACTIVE-RUN.json', '.oxe/CHECKPOINTS.md', '.oxe/OXE-EVENTS.ndjson'],
    };
  }
  if (activeRun && activeRun.status === 'paused') {
    return {
      step: 'execute',
      cursorCmd: '/oxe-execute',
      reason: 'ACTIVE-RUN está pausado — retome a execução a partir do cursor atual',
      artifacts: ['.oxe/ACTIVE-RUN.json', '.oxe/EXECUTION-RUNTIME.md'],
    };
  }

  if (/\*\*checkpoint_status:\*\*\s*`?pending_approval`?/i.test(stateText)) {
    return {
      step: 'execute',
      cursorCmd: '/oxe-execute',
      reason: 'Há checkpoint pendente de aprovação — resolva a aprovação antes de avançar a execução',
      artifacts: ['.oxe/CHECKPOINTS.md', '.oxe/STATE.md'],
    };
  }

  if (!has(p.verify)) {
    return {
      step: 'execute',
      cursorCmd: '/oxe-execute',
      reason: 'PLAN.md existe e VERIFY.md ainda não — execute a onda atual no agente; depois rode /oxe-verify',
      artifacts: ['.oxe/PLAN.md', '.oxe/STATE.md'],
    };
  }

  const verifyText = fs.readFileSync(p.verify, 'utf8');
  const phaseLow = (phase || '').toLowerCase();
  if (phaseLow === 'verify_failed' || /\bverify_failed\b/i.test(stateText)) {
    return {
      step: 'plan',
      cursorCmd: '/oxe-plan',
      reason: 'STATE indica verify_failed — leia VERIFY.md e SUMMARY.md, corrija ou replaneje (--replan)',
      artifacts: ['.oxe/VERIFY.md', '.oxe/PLAN.md'],
    };
  }

  const gapM = verifyText.match(/##+\s*Gaps\s*\n([\s\S]*?)(?=\n##+\s[^#]|$)/im);
  if (gapM) {
    const gb = gapM[1].trim();
    const low = gb.toLowerCase();
    const negligible =
      gb.length < 12 ||
      /^(nenhum|none|n\/a)\b|^-\s*nenhum|^sem gaps\b|^não há gaps\b|^não ha gaps\b/m.test(low);
    if (!negligible) {
      return {
        step: 'plan',
        cursorCmd: '/oxe-plan',
        reason: 'VERIFY.md lista gaps com conteúdo — trate ou replaneje; atualize SUMMARY.md se aplicável',
        artifacts: ['.oxe/VERIFY.md'],
      };
    }
  }

  if (/\b(falhou|fail)\b/i.test(verifyText) && /\|\s*(não|no|false)\s*\|/i.test(verifyText)) {
    return {
      step: 'plan',
      cursorCmd: '/oxe-plan',
      reason: 'VERIFY.md indica verificações não aprovadas — corrija ou replaneje',
      artifacts: ['.oxe/VERIFY.md'],
    };
  }

  // Após verify_complete, sugerir retro se LESSONS.md não existe ou last_retro ausente no STATE
  if (phaseLow === 'verify_complete' || /\bverify_complete\b/i.test(stateText)) {
    const lessonsExist = has(path.join(target, '.oxe', 'LESSONS.md'));
    const hasRetroInState = /\blast_retro\s*:/i.test(stateText);
    if (!lessonsExist || !hasRetroInState) {
      return {
        step: 'retro',
        cursorCmd: '/oxe-retro',
        reason: 'Verify completo — capture as lições do ciclo em .oxe/LESSONS.md para orientar o próximo spec/plan',
        artifacts: ['.oxe/LESSONS.md'],
      };
    }
  }

  return {
    step: 'next',
    cursorCmd: '/oxe-next',
    reason: 'Artefatos coerentes — /oxe-next confirma o passo único; use /oxe-spec ou /oxe-quick para nova entrega',
    artifacts: ['.oxe/STATE.md', '.oxe/VERIFY.md'],
  };
}

/**
 * @param {string} target
 */
function buildHealthReport(target) {
  const contextEngine = require('./oxe-context-engine.cjs');
  const runtimeSemantics = require('./oxe-runtime-semantics.cjs');
  const { config, path: cfgPath, parseError } = loadOxeConfigMerged(target);
  const shape = validateConfigShape(config);
  const base = oxePaths(target);
  let stateText = '';
  if (fs.existsSync(base.state)) {
    try {
      stateText = fs.readFileSync(base.state, 'utf8');
    } catch {
      stateText = '';
    }
  }
  const activeSession = parseActiveSession(stateText);
  const p = scopedOxePaths(target, activeSession);
  const phase = parseStatePhase(stateText);
  const scanDate = parseLastScanDate(stateText);
  const stale = isStaleScan(scanDate, Number(config.scan_max_age_days) || 0);
  const compactDate = parseLastCompactDate(stateText);
  const staleCompact = isStaleScan(compactDate, Number(config.compact_max_age_days) || 0);
  const retroDate = parseLastRetroDate(stateText);
  const staleLessons = isStaleLessons(retroDate, Number(config.lessons_max_age_days) || 0);
  const phaseWarn = phase ? phaseCoherenceWarnings(phase, p) : [];
  const runtimeWarn = runtimeWarnings(stateText, p);
  const sumWarn = verifyGapsWithoutSummaryWarning(p.verify, p.summary);
  const specReq = Array.isArray(config.spec_required_sections) ? config.spec_required_sections : [];
  const specWarn = specSectionWarnings(p.spec, specReq.map(String));
  const threshold = Number(config.plan_confidence_threshold) || 70;
  const capabilityWarn = capabilityWarnings(p);
  const investigationWarn = investigationWarnings(p);
  const planWarn = [
    ...planWaveWarningsFixed(p.plan, Number(config.plan_max_tasks_per_wave) || 0),
    ...planTaskAceiteWarnings(p.plan),
    ...planSelfEvaluationWarnings(p.plan, threshold),
    ...planAgentsWarnings(target),
  ];
  const sessionWarn = sessionWarnings(target, activeSession);
  const installWarn = installationCompletenessWarnings(target);
  const copilot = copilotIntegrationReport(target);
  const copilotWarn = copilot.warnings;
  const reviewWarn = planReviewWarnings(stateText, p);
  const planSelfEvaluation = parsePlanSelfEvaluation(p.plan);
  const activeRun = operational.readRunState(target, activeSession);
  const eventsSummary = operational.summarizeEvents(operational.readEvents(target, activeSession));
  const memoryLayers = operational.buildMemoryLayers(target, activeSession);
  const azureActive = azure.isAzureContextEnabled(target, config);
  const azureReport = azureActive
    ? azure.azureDoctor(target, config, {
        autoInstall: false,
        write: false,
      })
    : null;
  const azureInventorySyncedAt = azureReport && azureReport.inventory ? azureReport.inventory.synced_at || null : null;
  const azureInventoryMaxAgeHours = config.azure && config.azure.inventory_max_age_hours != null
    ? Number(config.azure.inventory_max_age_hours)
    : 24;
  let azureInventoryStale = { stale: false, hours: null };
  if (azureInventorySyncedAt) {
    const syncedAt = Date.parse(String(azureInventorySyncedAt));
    if (!Number.isNaN(syncedAt)) {
      const ageHours = Math.floor((Date.now() - syncedAt) / (1000 * 60 * 60));
      azureInventoryStale = {
        stale: azureInventoryMaxAgeHours > 0 ? ageHours > azureInventoryMaxAgeHours : false,
        hours: ageHours,
      };
    }
  } else if (azureActive) {
    azureInventoryStale = { stale: true, hours: null };
  }
  const next = suggestNextStep(target, {
    discuss_before_plan: config.discuss_before_plan,
    plan_confidence_threshold: threshold,
    azure: config.azure,
  });
  /** @type {string[]} */
  const contextWarn = [];
  /** @type {Record<string, unknown>} */
  const contextPacks = {};
  /** @type {Record<string, unknown>} */
  const packFreshness = {};
  /** @type {{ project: string | null, session: string | null, phase: string | null }} */
  let activeSummaryRefs = { project: null, session: null, phase: null };
  /** @type {{ primaryWorkflow: string | null, primaryScore: number | null, primaryStatus: string | null, byWorkflow: Record<string, unknown> }} */
  let contextQuality = {
    primaryWorkflow: null,
    primaryScore: null,
    primaryStatus: null,
    byWorkflow: {},
  };
  // Bloco A — resolução de paths e refs de summaries
  try {
    const ctxPaths = contextEngine.contextPaths(target, activeSession);
    activeSummaryRefs = {
      project: ctxPaths.projectSummaryJson,
      session: ctxPaths.sessionSummaryJson,
      phase: ctxPaths.phaseSummaryJson,
    };
  } catch (err) {
    contextWarn.push(`Contexto — falha ao resolver paths (contextPaths): ${err instanceof Error ? err.message : String(err)}`);
  }
  // Bloco B — inspeção de context packs por workflow
  try {
    const contextMaterialized = fs.existsSync(base.contextIndex);
    const candidateWorkflows = Array.from(
      new Set(
        ['dashboard', next.step, phase === 'planning' ? 'plan' : null, phase === 'executing' ? 'execute' : null, phase === 'verifying' ? 'verify' : null]
          .filter(Boolean)
          .map(String)
      )
    ).filter((workflow) => Boolean(runtimeSemantics.getWorkflowContract(workflow)));
    for (const workflow of candidateWorkflows) {
      let pack;
      try {
        pack = contextEngine.inspectContextPack(target, { workflow, activeSession });
      } catch (err) {
        contextWarn.push(`Context pack ${workflow} — falha na inspeção: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      contextPacks[workflow] = {
        path: pack.path || contextEngine.resolvePackFile(target, workflow, activeSession),
        context_tier: pack.context_tier,
        semantics_hash: pack.semantics_hash,
        read_order: pack.read_order,
        selected_artifacts: (pack.selected_artifacts || []).map((artifact) => ({
          alias: artifact.alias,
          path: artifact.path,
          exists: artifact.exists,
          required: artifact.required,
          using_fallback: artifact.using_fallback,
          scope: artifact.scope,
          summary: artifact.summary,
        })),
        gaps: pack.gaps,
        conflicts: pack.conflicts,
        fallback_required: pack.fallback_required,
        freshness: pack.freshness,
        context_quality: pack.context_quality,
      };
      packFreshness[workflow] = pack.freshness;
      contextQuality.byWorkflow[workflow] = pack.context_quality;
      if (contextMaterialized && pack.fallback_required) {
        contextWarn.push(`Context pack ${workflow} exige fallback explícito para leitura direta.`);
      }
      if (contextMaterialized && pack.freshness && pack.freshness.stale) {
        contextWarn.push(`Context pack ${workflow} stale (${pack.freshness.reason}).`);
      }
    }
    if (contextPacks.dashboard) {
      contextQuality.primaryWorkflow = 'dashboard';
      contextQuality.primaryScore = contextPacks.dashboard.context_quality.score;
      contextQuality.primaryStatus = contextPacks.dashboard.context_quality.status;
    } else {
      const firstWorkflow = Object.keys(contextPacks)[0] || null;
      if (firstWorkflow) {
        contextQuality.primaryWorkflow = firstWorkflow;
        contextQuality.primaryScore = contextPacks[firstWorkflow].context_quality.score;
        contextQuality.primaryStatus = contextPacks[firstWorkflow].context_quality.status;
      }
    }
  } catch (err) {
    contextWarn.push(`Contexto — falha ao inspecionar context packs: ${err instanceof Error ? err.message : String(err)}`);
  }
  const semanticsManifest = readJsonFileSafe(base.runtimeSemanticsManifest);
  const semanticsAudit = runtimeSemantics.auditRuntimeTargets(target);
  /** @type {string[]} */
  const semanticsWarn = [];
  const semanticTargetsPresent = [
    path.join(target, '.github', 'prompts'),
    path.join(target, 'commands', 'oxe'),
    path.join(target, '.cursor', 'commands'),
  ].some((dirPath) => fs.existsSync(dirPath));
  if (semanticTargetsPresent && !semanticsManifest.ok) {
    semanticsWarn.push('runtime-semantics.json ausente ou inválido — rode `npx oxe-cc update` para sincronizar o manifest semântico.');
  }
  if (semanticsManifest.error) {
    semanticsWarn.push(`runtime-semantics.json inválido: ${semanticsManifest.error}`);
  }
  if (semanticsManifest.data && semanticsManifest.data.contract_version && semanticsManifest.data.contract_version !== runtimeSemantics.CONTRACT_VERSION) {
    semanticsWarn.push(
      `Manifest semântico em versão ${semanticsManifest.data.contract_version}; esperado ${runtimeSemantics.CONTRACT_VERSION}.`
    );
  }
  if (semanticsAudit.registryIssues.length) {
    semanticsWarn.push(...semanticsAudit.registryIssues);
  }
  if (semanticsAudit.mismatches.length) {
    semanticsWarn.push(`${semanticsAudit.mismatches.length} wrapper(s) com drift semântico detectado.`);
  }
  const semanticsDrift = {
    ok: semanticsWarn.length === 0 && semanticsAudit.ok,
    contractVersion: runtimeSemantics.CONTRACT_VERSION,
    manifestPath: base.runtimeSemanticsManifest,
    manifest: semanticsManifest.data,
    audit: {
      ok: semanticsAudit.ok,
      warnings: semanticsAudit.warnings,
      mismatchCount: semanticsAudit.mismatches.length,
      mismatches: semanticsAudit.mismatches,
      targets: Object.fromEntries(
        Object.entries(semanticsAudit.targets || {}).map(([name, value]) => [
          name,
          {
            path: value.path,
            checked: value.checked,
            missing: value.missing,
          },
        ])
      ),
    },
  };
  const hardFailure = Boolean(parseError) || sessionWarn.some((w) => /não existe|sem SESSION\.md/i.test(w));
  const warningCount =
    phaseWarn.length +
    runtimeWarn.length +
    reviewWarn.length +
    specWarn.length +
    planWarn.length +
    capabilityWarn.length +
    investigationWarn.length +
    sessionWarn.length +
    installWarn.length +
    copilotWarn.length +
    contextWarn.length +
    semanticsWarn.length +
    (azureReport ? azureReport.warnings.length : 0) +
    (sumWarn ? 1 : 0);
  const healthStatus = hardFailure ? 'broken' : warningCount > 0 ? 'warning' : 'healthy';

  return {
    configPath: cfgPath,
    configParseError: parseError,
    unknownConfigKeys: shape.unknownKeys,
    typeErrors: shape.typeErrors,
    phase,
    activeSession,
    scanDate,
    stale,
    compactDate,
    staleCompact,
    retroDate,
    staleLessons,
    phaseWarn,
    runtimeWarn,
    reviewWarn,
    capabilityWarn,
    investigationWarn,
    sessionWarn,
    installWarn,
    copilotWarn,
    contextWarn,
    semanticsWarn,
    copilot,
    summaryGapWarn: sumWarn,
    specWarn,
    planWarn,
    planSelfEvaluation,
    planReviewStatus: parsePlanReviewStatus(stateText),
    activeRun,
    eventsSummary,
    memoryLayers,
    azureActive,
    azure: azureReport
      ? {
          profile: azureReport.profile,
          authStatus: azureReport.authStatus,
          inventorySummary: azureReport.inventorySummary,
          inventoryPath: azureReport.paths.inventory,
          operationsPath: azureReport.paths.operationsDir,
          inventorySyncedAt: azureInventorySyncedAt,
          inventoryStale: azureInventoryStale,
          pendingOperations: azure.listAzureOperations(target).filter((operation) => operation.phase === 'waiting_approval').length,
          lastOperation: azure.listAzureOperations(target)[0] || null,
          warnings: azureReport.warnings,
        }
      : null,
    contextPacks,
    contextQuality,
    semanticsDrift,
    packFreshness,
    activeSummaryRefs,
    healthStatus,
    next,
    scanFocusGlobs: config.scan_focus_globs,
    scanIgnoreGlobs: config.scan_ignore_globs,
  };
}

module.exports = {
  ALLOWED_CONFIG_KEYS,
  EXECUTION_PROFILES,
  VERIFICATION_DEPTHS,
  INSTALL_PROFILES,
  INSTALL_REPO_LAYOUTS,
  INSTALL_OBJECT_KEYS,
  EXPECTED_CODEBASE_MAPS,
  expandExecutionProfile,
  loadOxeConfigMerged,
  validateConfigShape,
  parseStatePhase,
  parseLastScanDate,
  parseLastCompactDate,
  parseLastRetroDate,
  parseActiveSession,
  parsePlanReviewStatus,
  isStaleScan,
  isStaleLessons,
  copilotWorkspacePaths,
  copilotLegacyPaths,
  copilotIntegrationReport,
  planAgentsWarnings,
  installationCompletenessWarnings,
  parsePlanSelfEvaluation,
  planSelfEvaluationWarnings,
  runtimeWarnings,
  planReviewWarnings,
  capabilityWarnings,
  investigationWarnings,
  phaseCoherenceWarnings,
  verifyGapsWithoutSummaryWarning,
  specSectionWarnings,
  planWaveWarningsFixed,
  planTaskAceiteWarnings,
  suggestNextStep,
  buildHealthReport,
  oxePaths,
  scopedOxePaths,
};
