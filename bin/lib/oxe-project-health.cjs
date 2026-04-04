'use strict';

const fs = require('fs');
const path = require('path');

/** @type {string[]} */
const ALLOWED_CONFIG_KEYS = [
  'discuss_before_plan',
  'after_verify_suggest_pr',
  'after_verify_draft_commit',
  'after_verify_suggest_uat',
  'default_verify_command',
  'scan_max_age_days',
  'compact_max_age_days',
  'scan_focus_globs',
  'scan_ignore_globs',
  'spec_required_sections',
  'plan_max_tasks_per_wave',
  'profile',
  'verification_depth',
  'install',
  'plugins',
  'workstreams',
  'milestones',
  'scale_adaptive',
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
 * @param {string} targetProject
 */
function loadOxeConfigMerged(targetProject) {
  const defaults = {
    discuss_before_plan: false,
    after_verify_suggest_pr: true,
    after_verify_draft_commit: true,
    after_verify_suggest_uat: false,
    verification_depth: 'standard',
    default_verify_command: '',
    scan_max_age_days: 0,
    compact_max_age_days: 0,
    scan_focus_globs: [],
    scan_ignore_globs: [],
    spec_required_sections: [],
    plan_max_tasks_per_wave: 0,
  };
  const p = path.join(targetProject, '.oxe', 'config.json');
  if (!fs.existsSync(p)) return { config: defaults, path: null, parseError: null };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { config: defaults, path: p, parseError: 'não é um objeto' };
    // Expandir profile antes de mesclar com o config explícito (keys explícitas prevalecem)
    const profileExpansion = (typeof j.profile === 'string') ? expandExecutionProfile(j.profile) : {};
    return { config: { ...defaults, ...profileExpansion, ...j }, path: p, parseError: null };
  } catch (e) {
    return { config: defaults, path: p, parseError: e.message };
  }
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
  if (cfg.after_verify_suggest_uat != null && typeof cfg.after_verify_suggest_uat !== 'boolean') {
    typeErrors.push('after_verify_suggest_uat deve ser boolean');
  }
  if (cfg.scale_adaptive != null && typeof cfg.scale_adaptive !== 'boolean') {
    typeErrors.push('scale_adaptive deve ser boolean');
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
 * @param {Date | null} scanDate
 * @param {number} maxAgeDays 0 = desligado
 */
function isStaleScan(scanDate, maxAgeDays) {
  if (!scanDate || !maxAgeDays || maxAgeDays <= 0) return { stale: false, days: null };
  const days = (Date.now() - scanDate.getTime()) / 86400000;
  return { stale: days > maxAgeDays, days: Math.floor(days) };
}

/**
 * @param {string} target
 */
function oxePaths(target) {
  const oxe = path.join(target, '.oxe');
  return {
    oxe,
    state: path.join(oxe, 'STATE.md'),
    spec: path.join(oxe, 'SPEC.md'),
    plan: path.join(oxe, 'PLAN.md'),
    quick: path.join(oxe, 'QUICK.md'),
    verify: path.join(oxe, 'VERIFY.md'),
    discuss: path.join(oxe, 'DISCUSS.md'),
    summary: path.join(oxe, 'SUMMARY.md'),
    codebase: path.join(oxe, 'codebase'),
  };
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
 * Próximo passo único (espelha o workflow next.md).
 * @param {string} target
 * @param {{ discuss_before_plan?: boolean }} cfg
 */
function suggestNextStep(target, cfg = {}) {
  const p = oxePaths(target);
  const discussBefore = Boolean(cfg.discuss_before_plan);
  const has = (/** @type {string} */ f) => fs.existsSync(f);
  const mapsComplete = EXPECTED_CODEBASE_MAPS.every((f) => has(path.join(p.codebase, f)));

  if (!has(p.oxe) || !has(p.state)) {
    return {
      step: 'scan',
      cursorCmd: '/oxe-scan',
      reason: 'Pasta .oxe/ ou STATE.md ausente — inicialize com oxe-cc init-oxe e rode o primeiro scan',
      artifacts: ['.oxe/'],
    };
  }

  const stateText = fs.readFileSync(p.state, 'utf8');
  const phase = parseStatePhase(stateText);

  if (!mapsComplete && !has(p.quick)) {
    return {
      step: 'scan',
      cursorCmd: '/oxe-scan',
      reason: 'Mapas do codebase incompletos e sem QUICK.md — atualize o contexto com scan',
      artifacts: ['.oxe/codebase/'],
    };
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
  const { config, path: cfgPath, parseError } = loadOxeConfigMerged(target);
  const shape = validateConfigShape(config);
  const p = oxePaths(target);
  let stateText = '';
  if (fs.existsSync(p.state)) {
    try {
      stateText = fs.readFileSync(p.state, 'utf8');
    } catch {
      stateText = '';
    }
  }
  const phase = parseStatePhase(stateText);
  const scanDate = parseLastScanDate(stateText);
  const stale = isStaleScan(scanDate, Number(config.scan_max_age_days) || 0);
  const compactDate = parseLastCompactDate(stateText);
  const staleCompact = isStaleScan(compactDate, Number(config.compact_max_age_days) || 0);
  const phaseWarn = phase ? phaseCoherenceWarnings(phase, p) : [];
  const sumWarn = verifyGapsWithoutSummaryWarning(p.verify, p.summary);
  const specReq = Array.isArray(config.spec_required_sections) ? config.spec_required_sections : [];
  const specWarn = specSectionWarnings(p.spec, specReq.map(String));
  const planWarn = [
    ...planWaveWarningsFixed(p.plan, Number(config.plan_max_tasks_per_wave) || 0),
    ...planTaskAceiteWarnings(p.plan),
  ];
  const next = suggestNextStep(target, { discuss_before_plan: config.discuss_before_plan });

  return {
    configPath: cfgPath,
    configParseError: parseError,
    unknownConfigKeys: shape.unknownKeys,
    typeErrors: shape.typeErrors,
    phase,
    scanDate,
    stale,
    compactDate,
    staleCompact,
    phaseWarn,
    summaryGapWarn: sumWarn,
    specWarn,
    planWarn,
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
  isStaleScan,
  phaseCoherenceWarnings,
  verifyGapsWithoutSummaryWarning,
  specSectionWarnings,
  planWaveWarningsFixed,
  planTaskAceiteWarnings,
  suggestNextStep,
  buildHealthReport,
  oxePaths,
};
