'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const health = require('./oxe-project-health.cjs');
const operational = require('./oxe-operational.cjs');
const azure = require('./oxe-azure.cjs');
const runtimeSemantics = require('./oxe-runtime-semantics.cjs');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  } catch (err) {
    throw new Error(`Falha ao escrever ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function sha256File(filePath) {
  try {
    return sha256Text(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hoursSince(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60));
}

function summarizeText(text, maxChars = 640, maxLines = 12) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const joined = lines.join(' ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined;
}

const INTENT_SECTION_KEYWORDS = {
  execution_input: ['onda', 'tarefa', 'hipótese', 'hipotese', 'wave', 'task', 'bloqueio', 'checkpoint', 'execu'],
  verification:    ['gap', 'critério', 'criterio', 'finding', 'auditoria', 'resultado', 'evidência', 'evidencia', 'falha', 'lacuna'],
  planning_input:  ['objetivo', 'autoavaliação', 'autoavaliacao', 'confiança', 'confianca', 'plano', 'requisito', 'risco', 'hipótese', 'hipotese'],
  critical_check:  ['bloqueio', 'falha', 'gap', 'erro', 'crítico', 'critico', 'p0', 'p1'],
  status_read:     ['fase', 'estado', 'próximo', 'proximo', 'status', 'resumo', 'sessão', 'sessao', 'snapshot'],
};

const DEFAULT_PRESERVE_MARKERS = [
  'P0', 'P1', 'bloqueado', 'BLOQUEADO', 'FALHA', 'crítico', 'CRÍTICO',
  'gaps', 'GAPS', 'bloqueante', 'BLOQUEANTE', 'crítica', 'CRÍTICA',
];

/**
 * Extração semântica orientada a intenção — preserva marcadores críticos independentemente
 * de posição, prioriza seções relevantes ao workflow e preenche o orçamento restante
 * com conteúdo adicional.
 *
 * @param {string} text
 * @param {{ intent?: string, maxChars?: number, preserveMarkers?: string[] }} [options]
 * @returns {string}
 */
function extractSemanticFragment(text, options = {}) {
  const intent = String(options.intent || 'status_read');
  const maxChars = Math.max(200, Number(options.maxChars) || 1200);
  const preserveMarkers = Array.isArray(options.preserveMarkers)
    ? options.preserveMarkers
    : DEFAULT_PRESERVE_MARKERS;

  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  // Sem headings — fallback para summarizeText com limite maior
  if (!normalized.includes('\n## ') && !normalized.startsWith('## ') &&
      !normalized.includes('\n# ') && !normalized.startsWith('# ')) {
    return summarizeText(normalized, maxChars, 20);
  }

  // Parsear em seções delimitadas por headings (# ou ##)
  const sections = [];
  let current = { heading: '', lines: [] };
  for (const line of normalized.split('\n')) {
    if (/^#{1,3} /.test(line)) {
      sections.push(current);
      current = { heading: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const kws = INTENT_SECTION_KEYWORDS[intent] || INTENT_SECTION_KEYWORDS.status_read;

  // Pontuar cada seção: 3=crítica, 2=relevante ao intent, 1=primeira seção, 0=resto
  const scored = sections.map((s, i) => {
    const h = s.heading.toLowerCase();
    const hasCritical = [s.heading, ...s.lines].some((l) =>
      preserveMarkers.some((m) => l.includes(m))
    );
    const isRelevant = kws.some((k) => h.includes(k));
    const relevance = hasCritical ? 3 : isRelevant ? 2 : i === 0 ? 1 : 0;
    return { ...s, relevance, index: i };
  });

  // Ordenar: críticas primeiro, depois por intent, depois por posição original
  const sorted = [...scored].sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return a.index - b.index;
  });

  // Preencher orçamento gulodamente
  const parts = [];
  let budget = maxChars;

  for (const section of sorted) {
    if (budget <= 0) break;
    const chunk = [section.heading, ...section.lines.filter(Boolean)]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!chunk) continue;
    if (chunk.length <= budget) {
      parts.push({ index: section.index, text: chunk });
      budget -= chunk.length + 2;
    } else if (budget > 80) {
      parts.push({ index: section.index, text: `${chunk.slice(0, budget - 1)}…` });
      budget = 0;
    }
  }

  // Reordenar na sequência original do documento
  parts.sort((a, b) => a.index - b.index);
  const result = parts.map((p) => p.text).join('\n\n').trim();
  return result.length > maxChars ? `${result.slice(0, maxChars - 1)}…` : result;
}

function sanitizeSession(activeSession) {
  return String(activeSession || '')
    .replace(/^sessions\//, '')
    .replace(/[\\/]/g, '__')
    .replace(/[^A-Za-z0-9._-]+/g, '-');
}

function contextPaths(projectRoot, activeSession) {
  const base = health.oxePaths(projectRoot);
  const stateText = readTextIfExists(base.state) || '';
  const resolvedSession = activeSession === undefined ? health.parseActiveSession(stateText) : activeSession;
  const sessionKey = sanitizeSession(resolvedSession);
  const phase = health.parseStatePhase(stateText) || 'unknown';
  const safePhase = String(phase).replace(/[^A-Za-z0-9._-]+/g, '-');
  const root = path.join(base.oxe, 'context');
  const packsDir = path.join(root, 'packs');
  const summariesDir = path.join(root, 'summaries');
  return {
    root,
    index: path.join(root, 'index.json'),
    packsDir,
    summariesDir,
    projectSummaryJson: path.join(summariesDir, 'project.json'),
    projectSummaryMd: path.join(summariesDir, 'project.md'),
    sessionSummaryJson: resolvedSession ? path.join(summariesDir, `session-${sessionKey}.json`) : null,
    sessionSummaryMd: resolvedSession ? path.join(summariesDir, `session-${sessionKey}.md`) : null,
    phaseSummaryJson: path.join(summariesDir, `phase-${safePhase}.json`),
    phaseSummaryMd: path.join(summariesDir, `phase-${safePhase}.md`),
    defaultPackJson: (workflow) => path.join(packsDir, `${workflow}.json`),
    defaultPackMd: (workflow) => path.join(packsDir, `${workflow}.md`),
    sessionPackJson: (workflow) => resolvedSession ? path.join(packsDir, `session-${sessionKey}-${workflow}.json`) : null,
    sessionPackMd: (workflow) => resolvedSession ? path.join(packsDir, `session-${sessionKey}-${workflow}.md`) : null,
    activeSession: resolvedSession || null,
    phase,
  };
}

function inferScope(activeSession, preferSession) {
  if (preferSession && activeSession) return 'session';
  return 'project';
}

function resolveArtifactCandidates(projectRoot, activeSession) {
  const base = health.oxePaths(projectRoot);
  const scoped = health.scopedOxePaths(projectRoot, activeSession || null);
  const ctx = contextPaths(projectRoot, activeSession);
  const azurePaths = azure.azurePaths(projectRoot);
  const preferSession = Boolean(activeSession);
  const withFallback = (alias, semanticType, primaryPath, fallbackPath = null, scope = inferScope(activeSession, true)) => ({
    alias,
    semantic_type: semanticType,
    scope,
    primary: primaryPath,
    fallback: fallbackPath && fallbackPath !== primaryPath ? fallbackPath : null,
  });
  return {
    state: withFallback('state', 'state', base.state, null, 'project'),
    session_manifest: withFallback('session_manifest', 'session', scoped.sessionManifest || null, null, 'session'),
    sessions_index: withFallback('sessions_index', 'session_index', base.sessionsIndex, null, 'project'),
    execution_state: withFallback('execution_state', 'state', scoped.executionState || null, null, 'session'),
    spec: withFallback('spec', 'spec', scoped.spec, base.spec),
    discuss: withFallback('discuss', 'discuss', scoped.discuss, base.discuss),
    plan: withFallback('plan', 'plan', scoped.plan, base.plan),
    plan_agents: withFallback('plan_agents', 'plan_agents', base.planAgents, null, 'project'),
    quick: withFallback('quick', 'plan', scoped.quick, base.quick),
    runtime: withFallback('runtime', 'runtime', scoped.runtime, base.runtime),
    checkpoints: withFallback('checkpoints', 'checkpoints', scoped.checkpoints, base.checkpoints),
    verify: withFallback('verify', 'verify', scoped.verify, base.verify),
    summary: withFallback('summary', 'summary', scoped.summary, base.summary),
    plan_review: withFallback('plan_review', 'review', scoped.planReview, base.planReview),
    review_comments: withFallback('review_comments', 'review_comments', scoped.planReviewComments, base.planReviewComments),
    active_run: withFallback('active_run', 'runtime', operational.operationalPaths(projectRoot, activeSession || null).activeRun, null, preferSession ? 'session' : 'project'),
    events: withFallback('events', 'trace', operational.operationalPaths(projectRoot, activeSession || null).events, null, preferSession ? 'session' : 'project'),
    capabilities_index: withFallback('capabilities_index', 'capabilities', base.capabilitiesIndex, null, 'project'),
    investigations_index: withFallback('investigations_index', 'investigations', scoped.investigationsIndex, base.investigationsIndex),
    global_lessons: withFallback('global_lessons', 'memory', base.globalLessons, base.lessons, 'project'),
    codebase_overview: withFallback('codebase_overview', 'codebase', path.join(base.codebase, 'OVERVIEW.md'), null, 'project'),
    codebase_stack: withFallback('codebase_stack', 'codebase', path.join(base.codebase, 'STACK.md'), null, 'project'),
    codebase_structure: withFallback('codebase_structure', 'codebase', path.join(base.codebase, 'STRUCTURE.md'), null, 'project'),
    codebase_testing: withFallback('codebase_testing', 'codebase', path.join(base.codebase, 'TESTING.md'), null, 'project'),
    codebase_integrations: withFallback('codebase_integrations', 'codebase', path.join(base.codebase, 'INTEGRATIONS.md'), null, 'project'),
    codebase_concerns: withFallback('codebase_concerns', 'codebase', path.join(base.codebase, 'CONCERNS.md'), null, 'project'),
    azure_inventory: withFallback('azure_inventory', 'provider', azurePaths.inventoryMd, null, 'project'),
    azure_servicebus: withFallback('azure_servicebus', 'provider', azurePaths.serviceBusMd, null, 'project'),
    azure_eventgrid: withFallback('azure_eventgrid', 'provider', azurePaths.eventGridMd, null, 'project'),
    azure_sql: withFallback('azure_sql', 'provider', azurePaths.sqlMd, null, 'project'),
    copilot_manifest: withFallback('copilot_manifest', 'install_manifest', base.copilotManifest, null, 'project'),
    runtime_semantics_manifest: withFallback('runtime_semantics_manifest', 'install_manifest', path.join(base.installDir, 'runtime-semantics.json'), null, 'project'),
    project_summary: withFallback('project_summary', 'summary', ctx.projectSummaryJson, null, 'project'),
    session_summary: withFallback('session_summary', 'summary', ctx.sessionSummaryJson, null, 'session'),
    phase_summary: withFallback('phase_summary', 'summary', ctx.phaseSummaryJson, null, 'project'),
    context_pack_dashboard: withFallback('context_pack_dashboard', 'context_pack', ctx.defaultPackJson('dashboard'), null, 'project'),
    calibration: withFallback('calibration', 'calibration', path.join(base.oxe, 'calibration.json'), null, 'project'),
  };
}

function buildArtifactRecord(candidate) {
  const primaryExists = Boolean(candidate.primary && fs.existsSync(candidate.primary));
  const fallbackExists = Boolean(candidate.fallback && fs.existsSync(candidate.fallback));
  const chosenPath = primaryExists ? candidate.primary : fallbackExists ? candidate.fallback : candidate.primary || candidate.fallback || null;
  const chosenExists = Boolean(chosenPath && fs.existsSync(chosenPath));
  const chosenText = chosenExists ? readTextIfExists(chosenPath) || '' : '';
  const primaryHash = primaryExists ? sha256File(candidate.primary) : null;
  const fallbackHash = fallbackExists ? sha256File(candidate.fallback) : null;
  const stat = chosenExists ? fs.statSync(chosenPath) : null;
  return {
    alias: candidate.alias,
    semantic_type: candidate.semantic_type,
    scope: candidate.scope,
    primary_path: candidate.primary || null,
    primary_exists: primaryExists,
    fallback_path: candidate.fallback || null,
    fallback_exists: fallbackExists,
    path: chosenPath,
    exists: chosenExists,
    using_fallback: !primaryExists && fallbackExists,
    hash: chosenExists ? sha256Text(chosenText) : null,
    primary_hash: primaryHash,
    fallback_hash: fallbackHash,
    updated_at: stat ? stat.mtime.toISOString() : null,
    age_hours: stat ? hoursSince(stat.mtime.toISOString()) : null,
    size_bytes: stat ? stat.size : 0,
    summary: chosenExists ? summarizeText(chosenText) : '',
    conflict: Boolean(primaryExists && fallbackExists && primaryHash && fallbackHash && primaryHash !== fallbackHash),
  };
}

function buildProjectSummary(projectRoot, activeSession, options = {}) {
  const base = health.oxePaths(projectRoot);
  const codebaseDir = base.codebase;
  const overview = summarizeText(readTextIfExists(path.join(codebaseDir, 'OVERVIEW.md')) || '');
  const stack = summarizeText(readTextIfExists(path.join(codebaseDir, 'STACK.md')) || '');
  const concerns = summarizeText(readTextIfExists(path.join(codebaseDir, 'CONCERNS.md')) || '');
  const lessons = summarizeText(readTextIfExists(base.globalLessons) || '');
  const stateText = readTextIfExists(base.state) || '';
  const payload = {
    summary_type: 'project',
    generated_at: new Date().toISOString(),
    project_root: path.resolve(projectRoot),
    phase: health.parseStatePhase(stateText),
    active_session: activeSession || health.parseActiveSession(stateText),
    overview,
    stack,
    concerns,
    lessons,
  };
  const md =
    '# OXE Context Summary — Project\n\n' +
    `- **Gerado em:** ${payload.generated_at}\n` +
    `- **Fase:** ${payload.phase || '—'}\n` +
    `- **Sessão ativa:** ${payload.active_session || 'modo legado'}\n\n` +
    '## Overview\n\n' +
    `${overview || '—'}\n\n` +
    '## Stack\n\n' +
    `${stack || '—'}\n\n` +
    '## Concerns\n\n' +
    `${concerns || '—'}\n\n` +
    '## Lessons\n\n' +
    `${lessons || '—'}\n`;
  if (options.write !== false) {
    const ctx = contextPaths(projectRoot, activeSession);
    try {
      writeJson(ctx.projectSummaryJson, payload);
      ensureDir(path.dirname(ctx.projectSummaryMd));
      fs.writeFileSync(ctx.projectSummaryMd, md, 'utf8');
    } catch (err) {
      throw new Error(`buildProjectSummary: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { json: payload, markdown: md };
}

function buildSessionSummary(projectRoot, activeSession, options = {}) {
  if (!activeSession) return null;
  const scoped = health.scopedOxePaths(projectRoot, activeSession);
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '';
  const sessionText = readTextIfExists(scoped.sessionManifest) || '';
  const spec = summarizeText(readTextIfExists(scoped.spec) || '');
  const plan = summarizeText(readTextIfExists(scoped.plan) || '');
  const runtime = summarizeText(readTextIfExists(scoped.runtime) || '');
  const verify = summarizeText(readTextIfExists(scoped.verify) || '');
  const payload = {
    summary_type: 'session',
    generated_at: new Date().toISOString(),
    session: activeSession,
    phase: health.parseStatePhase(stateText),
    session_manifest: summarizeText(sessionText),
    spec,
    plan,
    runtime,
    verify,
  };
  const md =
    '# OXE Context Summary — Session\n\n' +
    `- **Gerado em:** ${payload.generated_at}\n` +
    `- **Sessão:** ${payload.session}\n` +
    `- **Fase:** ${payload.phase || '—'}\n\n` +
    '## Session Manifest\n\n' +
    `${payload.session_manifest || '—'}\n\n` +
    '## SPEC\n\n' +
    `${spec || '—'}\n\n` +
    '## PLAN\n\n' +
    `${plan || '—'}\n\n` +
    '## Runtime\n\n' +
    `${runtime || '—'}\n\n` +
    '## VERIFY\n\n' +
    `${verify || '—'}\n`;
  if (options.write !== false) {
    const ctx = contextPaths(projectRoot, activeSession);
    try {
      if (ctx.sessionSummaryJson) writeJson(ctx.sessionSummaryJson, payload);
      if (ctx.sessionSummaryMd) {
        ensureDir(path.dirname(ctx.sessionSummaryMd));
        fs.writeFileSync(ctx.sessionSummaryMd, md, 'utf8');
      }
    } catch (err) {
      throw new Error(`buildSessionSummary: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { json: payload, markdown: md };
}

function buildPhaseSummary(projectRoot, activeSession, options = {}) {
  const base = health.oxePaths(projectRoot);
  const stateText = readTextIfExists(base.state) || '';
  const payload = {
    summary_type: 'phase',
    generated_at: new Date().toISOString(),
    phase: health.parseStatePhase(stateText),
    active_session: activeSession || health.parseActiveSession(stateText),
    next_step: firstNonEmpty([
      summarizeText(readTextIfExists(base.state) || '', 220, 8),
    ]),
    runtime_status: firstMatch(stateText, /\*\*runtime_status:\*\*\s*([^\n]+)/i),
    plan_review_status: health.parsePlanReviewStatus(stateText),
  };
  const md =
    '# OXE Context Summary — Phase\n\n' +
    `- **Gerado em:** ${payload.generated_at}\n` +
    `- **Fase:** ${payload.phase || '—'}\n` +
    `- **Sessão ativa:** ${payload.active_session || 'modo legado'}\n` +
    `- **runtime_status:** ${payload.runtime_status || '—'}\n` +
    `- **plan_review_status:** ${payload.plan_review_status || '—'}\n\n` +
    '## Snapshot\n\n' +
    `${payload.next_step || '—'}\n`;
  if (options.write !== false) {
    const ctx = contextPaths(projectRoot, activeSession);
    try {
      writeJson(ctx.phaseSummaryJson, payload);
      ensureDir(path.dirname(ctx.phaseSummaryMd));
      fs.writeFileSync(ctx.phaseSummaryMd, md, 'utf8');
    } catch (err) {
      throw new Error(`buildPhaseSummary: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { json: payload, markdown: md };
}

function firstMatch(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1].trim() : null;
}

function firstNonEmpty(values) {
  for (const value of values || []) {
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

function buildContextIndex(projectRoot, activeSession, options = {}) {
  const writeOpt = { write: options.write !== false };
  const summaryErrors = [];
  for (const [label, fn, args] of [
    ['project', buildProjectSummary, [projectRoot, activeSession, writeOpt]],
    ['session', buildSessionSummary, [projectRoot, activeSession, writeOpt]],
    ['phase', buildPhaseSummary, [projectRoot, activeSession, writeOpt]],
  ]) {
    try {
      fn(...args);
    } catch (err) {
      summaryErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (summaryErrors.length) {
    process.stderr.write(`[oxe] WARN buildContextIndex — falha ao escrever summaries: ${summaryErrors.join('; ')}\n`);
  }
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '';
  const resolvedSession = activeSession === undefined ? health.parseActiveSession(stateText) : activeSession;
  const candidates = resolveArtifactCandidates(projectRoot, resolvedSession || null);
  const artifacts = Object.keys(candidates)
    .sort()
    .map((alias) => buildArtifactRecord(candidates[alias]));
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: path.resolve(projectRoot),
    active_session: resolvedSession || null,
    phase: health.parseStatePhase(stateText),
    artifacts,
    stats: {
      total: artifacts.length,
      existing: artifacts.filter((item) => item.exists).length,
      missing: artifacts.filter((item) => !item.exists).length,
      conflicts: artifacts.filter((item) => item.conflict).length,
    },
  };
  if (options.write !== false) {
    const ctx = contextPaths(projectRoot, resolvedSession || null);
    ensureDir(ctx.root);
    writeJson(ctx.index, payload);
  }
  return payload;
}

function computePackFreshness(pack, contract) {
  const generatedAt = pack.generated_at || null;
  const sourceTimes = (pack.selected_artifacts || [])
    .map((artifact) => artifact.updated_at)
    .filter(Boolean)
    .map((value) => Date.parse(String(value)))
    .filter((value) => !Number.isNaN(value));
  const latestSource = sourceTimes.length ? new Date(Math.max(...sourceTimes)).toISOString() : null;
  const generatedMs = generatedAt ? Date.parse(String(generatedAt)) : Number.NaN;
  const latestSourceMs = latestSource ? Date.parse(latestSource) : Number.NaN;
  const packAgeHours = hoursSince(generatedAt);
  const maxPackAgeHours = contract && contract.freshness_policy && contract.freshness_policy.pack_max_age_hours != null
    ? Number(contract.freshness_policy.pack_max_age_hours)
    : 12;
  const staleByAge = packAgeHours != null && maxPackAgeHours > 0 ? packAgeHours > maxPackAgeHours : false;
  const staleBySource = !Number.isNaN(generatedMs) && !Number.isNaN(latestSourceMs) ? generatedMs < latestSourceMs : false;
  return {
    generated_at: generatedAt,
    latest_source_at: latestSource,
    pack_age_hours: packAgeHours,
    max_pack_age_hours: maxPackAgeHours,
    stale: staleByAge || staleBySource || Boolean(pack.fallback_required),
    reason: staleBySource ? 'source_newer_than_pack' : staleByAge ? 'pack_age_exceeded' : pack.fallback_required ? 'fallback_required' : 'fresh',
  };
}

function computeContextQuality(pack) {
  const requiredMissing = (pack.gaps || []).filter((gap) => gap.severity === 'critical').length;
  const optionalMissing = (pack.gaps || []).filter((gap) => gap.severity !== 'critical').length;
  const conflicts = (pack.conflicts || []).length;
  const fallbackCount = (pack.selected_artifacts || []).filter((artifact) => artifact.using_fallback).length;
  let score = 100;
  score -= requiredMissing * 25;
  score -= optionalMissing * 5;
  score -= conflicts * 12;
  score -= fallbackCount * 6;
  if ((pack.selected_artifacts || []).length === 0) score -= 40;
  score = Math.max(0, Math.min(100, score));
  const status = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fragile' : 'critical';
  return {
    score,
    status,
    requiredMissing,
    optionalMissing,
    conflicts,
    fallbackCount,
  };
}

function renderPackMarkdown(pack) {
  const selected = (pack.selected_artifacts || [])
    .map((artifact) => `- **${artifact.alias}** (${artifact.scope}) -> ${artifact.exists ? artifact.path : 'ausente'}${artifact.using_fallback ? ' [fallback]' : ''}`)
    .join('\n') || '- Nenhum artefato selecionado';
  const gaps = (pack.gaps || [])
    .map((gap) => `- [${gap.severity}] ${gap.alias}: ${gap.reason}`)
    .join('\n') || '- Nenhuma lacuna';
  const conflicts = (pack.conflicts || [])
    .map((conflict) => `- ${conflict.alias}: ${conflict.reason}`)
    .join('\n') || '- Nenhum conflito';
  const sections = (pack.contract && pack.contract.output_sections || []).join(' · ') || '—';
  return (
    `# OXE Context Pack — ${pack.workflow}\n\n` +
    `- **Gerado em:** ${pack.generated_at}\n` +
    `- **Sessão ativa:** ${pack.active_session || 'modo legado'}\n` +
    `- **Tier:** ${pack.context_tier}\n` +
    `- **Semantics hash:** \`${pack.semantics_hash}\`\n` +
    `- **Quality score:** ${pack.context_quality.score}\n` +
    `- **Fallback required:** ${pack.fallback_required ? 'sim' : 'não'}\n\n` +
    '## Read Order\n\n' +
    `${(pack.read_order || []).map((alias) => `- ${alias}`).join('\n') || '- Nenhuma ordem resolvida'}\n\n` +
    '## Selected Artifacts\n\n' +
    `${selected}\n\n` +
    '## Gaps\n\n' +
    `${gaps}\n\n` +
    '## Conflicts\n\n' +
    `${conflicts}\n\n` +
    '## Output Contract\n\n' +
    `${sections}\n`
  );
}

/**
 * Extrai o vetor de confiança de um PLAN.md (bloco <confidence_vector>).
 * @param {string} planText
 * @returns {{ cycle: string|null, generated_at: string|null, dimensions: Array<{ name: string, score: number, weight: number, note: string }>, global: { score: number, gate: string } } | null}
 */
function parseConfidenceVector(planText) {
  const text = String(planText || '');
  const blockMatch = text.match(/<confidence_vector\s+([^>]*)>([\s\S]*?)<\/confidence_vector>/i);
  if (!blockMatch) return null;

  const attrs = blockMatch[1];
  const body = blockMatch[2];

  const cycle = (attrs.match(/\bcycle=["']([^"']+)["']/) || [])[1] || null;
  const generated_at = (attrs.match(/\bgenerated_at=["']([^"']+)["']/) || [])[1] || null;

  // Extrair dimensões: <dim name="..." score="..." weight="..." note="..." />
  const dimensions = [];
  const dimPattern = /<dim\s+([^/]*)\s*\/>/gi;
  let m;
  while ((m = dimPattern.exec(body)) !== null) {
    const dAttrs = m[1];
    const name = (dAttrs.match(/\bname=["']([^"']+)["']/) || [])[1] || '';
    const score = parseFloat((dAttrs.match(/\bscore=["']([^"']+)["']/) || [])[1] || '0');
    const weight = parseFloat((dAttrs.match(/\bweight=["']([^"']+)["']/) || [])[1] || '0');
    const note = (dAttrs.match(/\bnote=["']([^"']+)["']/) || [])[1] || '';
    if (name) dimensions.push({ name, score: isNaN(score) ? 0 : score, weight: isNaN(weight) ? 0 : weight, note });
  }

  // Extrair global: <global score="..." gate="..." />
  const globalMatch = body.match(/<global\s+([^/]*)\s*\/>/i);
  const globalAttrs = globalMatch ? globalMatch[1] : '';
  const globalScore = parseFloat((globalAttrs.match(/\bscore=["']([^"']+)["']/) || [])[1] || '0');
  const gate = (globalAttrs.match(/\bgate=["']([^"']+)["']/) || [])[1] || 'proceed_with_risk';

  // Se não há global explícito, calcular como média ponderada
  let computedScore = globalScore;
  if (!globalMatch && dimensions.length > 0) {
    const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
    computedScore = totalWeight > 0
      ? dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight
      : 0;
  }

  return {
    cycle,
    generated_at,
    dimensions,
    global: { score: isNaN(computedScore) ? 0 : Math.round(computedScore * 100) / 100, gate },
  };
}

/**
 * Extrai hipóteses críticas de um PLAN.md.
 * Suporta tags XML (<hypothesis ...>) e fallback para tabela Markdown.
 * @param {string} planText
 * @returns {Array<{ id: string, condition: string, validation: string, on_failure: string, checkpoint: string|null, status: string }>}
 */
function parseHypotheses(planText) {
  const text = String(planText || '');
  const results = [];

  // Formato 1: tags XML
  const xmlPattern = /<hypothesis\s+([^>]*)>([\s\S]*?)<\/hypothesis>/gi;
  let m;
  while ((m = xmlPattern.exec(text)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/\bid=["']([^"']+)["']/) || [])[1] || '';
    const checkpoint = (attrs.match(/\bcheckpoint=["']([^"']+)["']/) || [])[1] || null;
    const status = (attrs.match(/\bstatus=["']([^"']+)["']/) || [])[1] || 'pending';
    const condition = (body.match(/<condition>([\s\S]*?)<\/condition>/) || [])[1]?.trim() || '';
    const validation = (body.match(/<validation>([\s\S]*?)<\/validation>/) || [])[1]?.trim() || '';
    const on_failure = (body.match(/<on_failure>([\s\S]*?)<\/on_failure>/) || [])[1]?.trim() || '';
    if (id) results.push({ id, condition, validation, on_failure, checkpoint, status });
  }
  if (results.length > 0) return results;

  // Formato 2: tabela Markdown (fallback)
  // Encontrar a seção e extrair linhas até o próximo heading
  const sectionIdx = text.search(/##\s*Hip.teses\s*Cr.ticas/im);
  if (sectionIdx !== -1) {
    const afterSection = text.slice(sectionIdx);
    // Parar no próximo heading ## ou # (excluindo o próprio)
    const nextHeadingMatch = afterSection.slice(3).match(/\n#{1,3} /);
    const sectionText = nextHeadingMatch
      ? afterSection.slice(0, nextHeadingMatch.index + 3 + 1)
      : afterSection;
    const rows = sectionText.split('\n').filter((l) => l.trimStart().startsWith('|'));
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && /^H\d+$/i.test(cells[0])) {
        results.push({
          id: cells[0],
          condition: cells[1] || '',
          validation: cells[2] || '',
          on_failure: cells[3] || '',
          checkpoint: cells[4] || null,
          status: cells[5] || 'pending',
        });
      }
    }
  }
  return results;
}

function buildContextPack(projectRoot, input = {}) {
  const workflow = String(input.workflow || '').trim();
  if (!workflow) {
    throw new Error('workflow é obrigatório para buildContextPack');
  }
  const contract = runtimeSemantics.getWorkflowContract(workflow);
  if (!contract) {
    throw new Error(`Workflow sem contrato canónico: ${workflow}`);
  }
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '';
  const activeSession = input.activeSession === undefined ? health.parseActiveSession(stateText) : input.activeSession;
  const tier = ['minimal', 'standard', 'full'].includes(String(input.tier || 'standard'))
    ? String(input.tier || 'standard')
    : 'standard';
  const mode = String(input.mode || 'standard');
  const ctx = contextPaths(projectRoot, activeSession || null);
  const index = buildContextIndex(projectRoot, activeSession || null, { write: input.write !== false });
  const byAlias = new Map((index.artifacts || []).map((artifact) => [artifact.alias, artifact]));

  // Modo auditor: usa auditor_artifacts do contrato e exclui auditor_excluded
  let selectedAliases;
  if (mode === 'auditor' && contract.auditor_artifacts && contract.auditor_artifacts.length > 0) {
    const excluded = new Set(contract.auditor_excluded || []);
    selectedAliases = Array.from(
      new Set(contract.auditor_artifacts.filter((a) => !excluded.has(a)))
    );
  } else {
    selectedAliases = Array.from(
      new Set(['state', ...(contract.context_tiers[tier] || contract.context_tiers.standard || [])])
    );
  }
  const intent = String(contract.extraction_intent || 'status_read');
  const selectedArtifacts = selectedAliases.map((alias) => {
    const artifact = byAlias.get(alias);
    if (artifact) {
      const rawText = artifact.exists ? readTextIfExists(artifact.path) || '' : '';
      const semanticSummary = rawText
        ? extractSemanticFragment(rawText, { intent })
        : '';
      return {
        ...artifact,
        required: contract.required_artifacts.includes(alias),
        selected_because: contract.required_artifacts.includes(alias) ? 'required_artifact' : 'context_tier',
        semantic_summary: semanticSummary,
      };
    }
    return {
      alias,
      path: null,
      exists: false,
      scope: 'unknown',
      semantic_type: 'unknown',
      using_fallback: false,
      required: contract.required_artifacts.includes(alias),
      selected_because: contract.required_artifacts.includes(alias) ? 'required_artifact' : 'context_tier',
      updated_at: null,
      age_hours: null,
      hash: null,
      summary: '',
      semantic_summary: '',
    };
  });
  const gaps = [];
  for (const artifact of selectedArtifacts) {
    if (!artifact.exists) {
      gaps.push({
        alias: artifact.alias,
        severity: artifact.required ? 'critical' : 'warning',
        reason: artifact.required ? 'required_artifact_missing' : 'selected_artifact_missing',
      });
    }
  }
  const conflicts = selectedArtifacts
    .filter((artifact) => artifact.conflict)
    .map((artifact) => ({
      alias: artifact.alias,
      reason: 'session_and_root_artifacts_diverge',
      primary_path: artifact.primary_path,
      fallback_path: artifact.fallback_path,
    }));
  const pack = {
    schema_version: 1,
    workflow,
    mode,
    active_session: activeSession || null,
    context_tier: tier,
    generated_at: new Date().toISOString(),
    semantics_hash: runtimeSemantics.computeSemanticsHash(workflow),
    contract,
    read_order: selectedArtifacts.filter((artifact) => artifact.exists).map((artifact) => artifact.alias),
    selected_artifacts: selectedArtifacts,
    gaps,
    conflicts,
    fallback_required: gaps.some((gap) => gap.severity === 'critical') || selectedArtifacts.some((artifact) => artifact.using_fallback),
    summaries: {
      project: ctx.projectSummaryJson,
      session: ctx.sessionSummaryJson,
      phase: ctx.phaseSummaryJson,
    },
  };
  // Extrair hipóteses críticas do PLAN.md se disponível no pack
  const planArtifact = selectedArtifacts.find((a) => a.alias === 'plan' && a.exists);
  const hypotheses = planArtifact ? parseHypotheses(readTextIfExists(planArtifact.path) || '') : [];
  pack.context_quality = computeContextQuality(pack);
  pack.freshness = computePackFreshness(pack, contract);
  pack.hypotheses = hypotheses;
  pack.markdown = renderPackMarkdown(pack);
  if (input.write !== false) {
    try {
      ensureDir(ctx.packsDir);
      const defaultJson = ctx.defaultPackJson(workflow);
      const defaultMd = ctx.defaultPackMd(workflow);
      writeJson(defaultJson, pack);
      fs.writeFileSync(defaultMd, pack.markdown, 'utf8');
      if (ctx.sessionPackJson(workflow)) {
        writeJson(ctx.sessionPackJson(workflow), pack);
      }
      if (ctx.sessionPackMd(workflow)) {
        fs.writeFileSync(ctx.sessionPackMd(workflow), pack.markdown, 'utf8');
      }
    } catch (err) {
      throw new Error(`buildContextPack (${workflow}): falha ao persistir pack — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return pack;
}

function resolvePackFile(projectRoot, workflow, activeSession) {
  const ctx = contextPaths(projectRoot, activeSession);
  const candidates = [ctx.sessionPackJson(workflow), ctx.defaultPackJson(workflow)].filter(Boolean);
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return ctx.defaultPackJson(workflow);
}

function inspectContextPack(projectRoot, input = {}) {
  const workflow = String(input.workflow || '').trim();
  if (!workflow) {
    throw new Error('workflow é obrigatório para inspectContextPack');
  }
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '';
  const activeSession = input.activeSession === undefined ? health.parseActiveSession(stateText) : input.activeSession;
  const filePath = resolvePackFile(projectRoot, workflow, activeSession || null);
  let pack = null;
  if (fs.existsSync(filePath)) {
    try {
      pack = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      pack = null;
    }
  }
  if (!pack) {
    pack = buildContextPack(projectRoot, {
      workflow,
      tier: input.tier || 'standard',
      activeSession: activeSession || null,
      write: false,
    });
  } else {
    const contract = runtimeSemantics.getWorkflowContract(workflow);
    pack.contract = contract;
    pack.freshness = computePackFreshness(pack, contract);
    pack.context_quality = computeContextQuality(pack);
  }
  pack.path = filePath;
  return pack;
}

function buildAllContextPacks(projectRoot, input = {}) {
  const workflows = input.workflow
    ? [String(input.workflow)]
    : runtimeSemantics.getAllWorkflowContracts().map((contract) => contract.workflow_slug);
  return workflows.map((workflow) => buildContextPack(projectRoot, {
    workflow,
    tier: input.tier || 'standard',
    activeSession: input.activeSession,
    write: input.write !== false,
  }));
}

module.exports = {
  buildAllContextPacks,
  buildContextIndex,
  buildContextPack,
  buildPhaseSummary,
  buildProjectSummary,
  buildSessionSummary,
  computeContextQuality,
  computePackFreshness,
  contextPaths,
  extractSemanticFragment,
  inspectContextPack,
  parseConfidenceVector,
  parseHypotheses,
  resolveArtifactCandidates,
  resolvePackFile,
  summarizeText,
};
