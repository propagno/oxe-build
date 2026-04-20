'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const health = require('./oxe-project-health.cjs');
const operational = require('./oxe-operational.cjs');
const azure = require('./oxe-azure.cjs');
const contextEngine = require('./oxe-context-engine.cjs');

function readTextIfExists(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
}

function readJsonArrayIfExists(p) {
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function ensureDirForFile(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function firstMatch(text, regex) { const m = String(text || '').match(regex); return m ? m[1].trim() : null; }
function escapeRegex(v) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function summarizeText(text, max = 500) { const clean = String(text || '').replace(/\r\n/g, '\n').trim(); return !clean ? '' : clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; }
function normalizeCell(v) { return String(v || '').replace(/<br\s*\/?>/gi, ' ').replace(/`/g, '').replace(/\s+/g, ' ').trim(); }
function splitTableRow(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => normalizeCell(c)); }

function parseMarkdownTables(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!/^\s*\|?[\-:\s|]+\|?\s*$/.test(lines[i + 1] || '')) continue;
    const headers = splitTableRow(lines[i]);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      const cells = splitTableRow(lines[j]);
      const row = {};
      for (let k = 0; k < headers.length; k += 1) row[headers[k]] = normalizeCell(cells[k] || '');
      rows.push(row);
      j += 1;
    }
    tables.push({ headers, rows });
    i = j - 1;
  }
  return tables;
}

function findTableByHeaders(text, expected) {
  const wants = expected.map((x) => x.toLowerCase());
  return parseMarkdownTables(text).find((table) => wants.every((w) => table.headers.some((h) => h.toLowerCase() === w)));
}

function listSectionItems(text, heading) {
  const match = String(text || '').match(new RegExp(`##\\s*${escapeRegex(heading)}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'));
  if (!match) return [];
  return match[1].split('\n').map((l) => l.trim()).filter((l) => /^-\s+/.test(l)).map((l) => l.replace(/^-\s+/, '').trim()).filter(Boolean);
}

function parsePlan(planMd) {
  const parts = planMd.split(/^###\s+(T\d+)\s*[—-]\s*/m);
  const tasks = [];
  const waves = {};
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i].trim();
    const rest = (parts[i + 1] || '').split(/^###\s+T\d+/m)[0];
    const title = ((rest.match(/^([^\n]+)/) || [null, ''])[1] || '').trim();
    const wave = Number((rest.match(/\*\*Onda:\*\*\s*(\d+)/i) || [null, ''])[1]) || null;
    const dependsOn = (((rest.match(/\*\*Depende\s+de:\*\*\s*([^\n]+)/i) || [null, ''])[1]) || '').split(/[,\s]+/).filter((s) => /^T\d+$/.test(s.trim()));
    const verifyCommand = (rest.match(/Comando:\s*`([^`]+)`/i) || [null, null])[1];
    const aceite = ((((rest.match(/\*\*Aceite\s+vinculado:\*\*\s*([^\n]+)/i) || [null, ''])[1]) || '').match(/A\d+/g) || []);
    const decisions = ((((rest.match(/\*\*Decisão\s+vinculada:\*\*\s*([^\n]+)/i) || [null, ''])[1]) || '').match(/D-\d+/g) || []);
    const task = { id, title, wave, dependsOn, verifyCommand, aceite, decisions };
    tasks.push(task);
    if (wave != null) (waves[wave] ||= []).push(id);
  }
  return {
    tasks,
    totalTasks: tasks.length,
    waves: Object.keys(waves).map((k) => ({ wave: Number(k), taskIds: waves[k], tasks: waves[k].map((id) => tasks.find((t) => t.id === id)).filter(Boolean) })).sort((a, b) => a.wave - b.wave),
  };
}

function parseSpec(specMd) {
  const objective = (((specMd.match(/##\s*Objetivo\s*\n+([\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im) || [null, ''])[1]) || '').trim().split('\n')[0].trim() || null;
  const criteria = [];
  const m = specMd.match(/##\s*Critérios.*?aceite[\s\S]*?(\|[\s\S]*?)(?=\n##\s|\n#[^\#]|$)/im);
  if (m) {
    for (const row of m[1].split('\n').filter((l) => l.startsWith('|'))) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && /^A\d+$/i.test(cells[0])) criteria.push({ id: cells[0].toUpperCase(), criterion: cells[1] || '', howToVerify: cells[2] || '' });
    }
  }
  return { objective, criteria };
}

function parseRuntime(runtimeMd) {
  const agentTable = findTableByHeaders(runtimeMd, ['ID', 'Papel', 'Tarefas', 'Estado']);
  const checkpointTable = findTableByHeaders(runtimeMd, ['ID', 'Tipo', 'Escopo', 'Estado']);
  return {
    currentWave: Number(firstMatch(runtimeMd, /\*\*Onda:\*\*\s*([^\n]+)/i)) || firstMatch(runtimeMd, /\*\*Onda:\*\*\s*([^\n]+)/i),
    status: firstMatch(runtimeMd, /\*\*Estado:\*\*\s*([^\n]+)/i),
    activeTasks: ((firstMatch(runtimeMd, /\*\*Tarefas ativas:\*\*\s*([^\n]+)/i) || '').split(',').map((x) => x.trim()).filter(Boolean)),
    nextAction: firstMatch(runtimeMd, /\*\*Ação:\*\*\s*([^\n]+)/i),
    nextReason: firstMatch(runtimeMd, /\*\*Motivo:\*\*\s*([^\n]+)/i),
    agents: (agentTable?.rows || []).map((row) => ({ id: row.ID || row.Id || '—', role: row.Papel || row.Role || '—', tasks: (row.Tarefas || row.Tasks || '').split(',').map((x) => x.trim()).filter(Boolean), status: row.Estado || row.Status || '—' })),
    checkpoints: (checkpointTable?.rows || []).map((row) => ({ id: row.ID || row.Id || '—', type: row.Tipo || row.Type || '—', scope: row.Escopo || row.Scope || '—', status: row.Estado || row.Status || '—', decision: row.Decisão || row.Decisao || row.Decision || '—' })),
    evidence: listSectionItems(runtimeMd, 'Evidências produzidas'),
    blockages: listSectionItems(runtimeMd, 'Bloqueios').filter((x) => !/^(\(nenhum\)|nenhum)$/i.test(x)),
  };
}

function parseCheckpointsIndex(md) {
  const table = findTableByHeaders(md, ['ID', 'Tipo', 'Fase', 'Escopo', 'Estado']);
  return (table?.rows || []).map((row) => ({ id: row.ID || row.Id || '—', type: row.Tipo || row.Type || '—', phase: row.Fase || row.Phase || '—', scope: row.Escopo || row.Scope || '—', status: row.Estado || row.Status || '—', notes: row.Notas || row.Notes || '—' }));
}

function parseSessionsIndex(md) {
  const table = parseMarkdownTables(md).find((t) => {
    const h = t.headers.map((x) => x.toLowerCase());
    return h.includes('id') && h.includes('nome') && h.includes('status') && h.includes('path');
  });
  return (table?.rows || []).map((row) => ({ id: row.ID || row.Id || '—', name: row.Nome || row.Name || '—', status: row.Status || '—', createdAt: row.Criada || row.Created || '—', lastActivity: row['Última atividade'] || row['Ultima atividade'] || row['Last activity'] || '—', summary: row.Resumo || row.Summary || '—', path: (row.Path || row.Caminho || '—').replace(/`/g, '') }));
}

function parseSessionDetail(md) {
  return { id: firstMatch(md, /\*\*ID:\*\*\s*([^\n]+)/i), name: firstMatch(md, /\*\*Nome:\*\*\s*([^\n]+)/i), status: firstMatch(md, /\*\*Status:\*\*\s*([^\n]+)/i), createdAt: firstMatch(md, /\*\*Criada:\*\*\s*([^\n]+)/i), lastActivity: firstMatch(md, /\*\*(?:Última|Ultima) atividade:\*\*\s*([^\n]+)/i), summary: firstMatch(md, /\*\*Resumo:\*\*\s*([^\n]+)/i), tags: listSectionItems(md, 'Tags'), history: (findTableByHeaders(md, ['Data', 'Evento'])?.rows || []).map((row) => ({ date: row.Data || row.Date || '—', event: row.Evento || row.Event || '—' })) };
}

function normalizeEvidenceStatus(raw) {
  const v = String(raw || '').toLowerCase();
  if (!v) return 'mentioned';
  if (/(ok|pass|aprov|sim|true|done|conclu)/.test(v)) return 'passed';
  if (/(fail|falh|reprov|não|nao|false|blocked)/.test(v)) return 'failed';
  return 'mentioned';
}

function parseVerify(md) {
  const criteria = [];
  for (const table of parseMarkdownTables(md)) {
    for (const row of table.rows) {
      const idCandidate = row.ID || row.Id || row['Critério'] || row['Criterio'] || '';
      const match = String(idCandidate).match(/A\d+/i);
      if (!match) continue;
      criteria.push({ id: match[0].toUpperCase(), status: normalizeEvidenceStatus(row.Status || row.Resultado || row.Result || row.Veredito || row['Passou?'] || ''), summary: row.Evidência || row.Evidencia || row.Resumo || row.Notas || '' });
    }
  }
  return { criteria, mentionedCriteria: Array.from(new Set((md.match(/\bA\d+\b/g) || []).map((x) => x.toUpperCase()))), failed: /\b(verify_failed|falhou|falha|reprovad)\b/i.test(md), passed: /\b(verify_complete|aprovad|passou|sucesso)\b/i.test(md) };
}

function confidenceBand(confidence, threshold) {
  if (confidence == null) return 'unknown';
  if (confidence >= 85) return 'ready';
  if (confidence >= threshold) return 'controlled';
  if (confidence >= 50) return 'needs_refinement';
  return 'do_not_execute';
}

function computeReadiness(ctx, threshold) {
  const blockers = [];
  const warnings = [...ctx.diagnostics.reviewWarnings, ...ctx.diagnostics.runtimeWarnings, ...ctx.diagnostics.planWarnings];
  if (ctx.planReviewStatus !== 'approved') blockers.push(`review_status:${ctx.planReviewStatus || 'draft'}`);
  if (ctx.plan.selfEvaluation.bestPlan === 'não') blockers.push('best_plan:no');
  if (ctx.plan.selfEvaluation.confidence == null) blockers.push('confidence:missing');
  else if (ctx.plan.selfEvaluation.confidence < threshold) blockers.push(`confidence:${ctx.plan.selfEvaluation.confidence}%<${threshold}%`);
  if (ctx.checkpoints.parsed.some((x) => /pending_approval/i.test(x.status))) blockers.push('checkpoint:pending_approval');
  if (ctx.runtime.parsed.status === 'blocked') blockers.push('runtime:blocked');
  if (ctx.spec.uncoveredCriteria.length) warnings.push(`${ctx.spec.uncoveredCriteria.length} critérios sem cobertura no plano`);
  return {
    go: blockers.length === 0,
    decision: blockers.length === 0 ? 'go' : 'no-go',
    threshold,
    confidence: ctx.plan.selfEvaluation.confidence,
    confidenceBand: confidenceBand(ctx.plan.selfEvaluation.confidence, threshold),
    checkpointPending: blockers.includes('checkpoint:pending_approval'),
    blockers,
    warnings,
  };
}

function buildCoverageMatrix(spec, plan, verify) {
  const taskMap = new Map();
  for (const task of plan.tasks) {
    for (const criterion of task.aceite || []) {
      if (!taskMap.has(criterion)) taskMap.set(criterion, []);
      taskMap.get(criterion).push(task.id);
    }
  }
  const verifyMap = new Map((verify.criteria || []).map((x) => [x.id, x]));
  return spec.criteria.map((c) => ({
    id: c.id,
    criterion: c.criterion,
    verifyHow: c.howToVerify,
    tasks: taskMap.get(c.id) || [],
    planCovered: taskMap.has(c.id),
    verifyStatus: verifyMap.has(c.id) ? verifyMap.get(c.id).status : (verify.mentionedCriteria || []).includes(c.id) ? 'mentioned' : 'missing',
    verifySummary: verifyMap.has(c.id) ? verifyMap.get(c.id).summary : '',
  }));
}

function computeCalibration(phase, confidence, verify) {
  if (confidence == null) return { status: 'pending', summary: 'Calibração indisponível antes do verify.' };
  const low = String(phase || '').toLowerCase();
  const completed = low === 'verify_complete' || verify.passed;
  const failed = low === 'verify_failed' || verify.failed;
  if (!completed && !failed) return { status: 'pending', summary: 'Calibração só fecha após verify.' };
  if (confidence >= 85 && failed) return { status: 'overconfident', summary: `Confiança ${confidence}% alta, mas o verify falhou.` };
  if (confidence < 70 && failed) return { status: 'calibrated-risk', summary: `O plano já sinalizava risco (${confidence}%) e o verify confirmou a fragilidade.` };
  if (confidence < 70 && completed) return { status: 'underconfident', summary: `O resultado final foi melhor que a confiança inicial (${confidence}%).` };
  if (confidence >= 85 && completed) return { status: 'well-calibrated', summary: `Alta confiança (${confidence}%) e verify coerente com a expectativa.` };
  return { status: 'acceptable', summary: `Confiança ${confidence}% e verify dentro da faixa esperada.` };
}

function readRepositoryContext(codebaseDir) {
  const names = ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'CONCERNS.md', 'INTEGRATIONS.md'];
  const out = {};
  for (const name of names) out[name.replace('.md', '').toLowerCase()] = { path: path.join(codebaseDir, name), summary: summarizeText(readTextIfExists(path.join(codebaseDir, name)) || '', 420) };
  return out;
}

function ensureStateSection(stateText, sectionTitle) {
  return new RegExp(`##\\s*${escapeRegex(sectionTitle)}`, 'i').test(stateText) ? stateText : `${stateText.trimEnd()}\n\n## ${sectionTitle}\n\n`;
}

function upsertBulletInSection(body, label, value) {
  const line = `- **${label}:** ${value}`;
  const re = new RegExp(`^- \\*\\*${escapeRegex(label)}:\\*\\*.*$`, 'im');
  if (re.test(body)) return body.replace(re, line);
  const trimmed = body.trimEnd();
  return !trimmed ? `${line}\n` : `${trimmed}\n${line}\n`;
}

function upsertStateBullet(stateText, sectionTitle, label, value) {
  const ensured = ensureStateSection(stateText, sectionTitle);
  const re = new RegExp(`(##\\s*${escapeRegex(sectionTitle)}\\s*\\n+)([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  return ensured.replace(re, (m, head, body) => `${head}${upsertBulletInSection(body, label, value)}`);
}

function reviewPaths(projectRoot, activeSession) {
  const p = health.scopedOxePaths(projectRoot, activeSession);
  return { ...p, state: health.oxePaths(projectRoot).state, reviewJson: p.planReviewComments };
}

function readScopedText(primaryPath, fallbackPath) {
  const primary = readTextIfExists(primaryPath);
  if (primary) return primary;
  return fallbackPath && fallbackPath !== primaryPath ? readTextIfExists(fallbackPath) || '' : '';
}

function savePlanReviewStatus(projectRoot, input = {}) {
  const globalStatePath = health.oxePaths(projectRoot).state;
  const stateText = readTextIfExists(globalStatePath) || '# OXE — Estado\n';
  const activeSession = input.activeSession === undefined ? health.parseActiveSession(stateText) : input.activeSession;
  const p = reviewPaths(projectRoot, activeSession || null);
  const nowIso = new Date().toISOString();
  const status = String(input.status || 'draft');
  const note = String(input.note || '—');
  const author = String(input.author || 'dashboard');
  const reviewRef = path.relative(path.join(projectRoot, '.oxe'), p.planReview).replace(/\\/g, '/');
  let nextState = stateText;
  nextState = upsertStateBullet(nextState, 'Revisão do plano (opcional — dashboard / aprovação)', 'plan_review_status', `\`${status}\``);
  nextState = upsertStateBullet(nextState, 'Revisão do plano (opcional — dashboard / aprovação)', 'plan_review_updated', `\`${nowIso}\``);
  nextState = upsertStateBullet(nextState, 'Revisão do plano (opcional — dashboard / aprovação)', 'plan_review_ref', `\`${reviewRef}\``);
  nextState = upsertStateBullet(nextState, 'Revisão do plano (opcional — dashboard / aprovação)', 'Notas', note);
  ensureDirForFile(globalStatePath);
  fs.writeFileSync(globalStatePath, nextState, 'utf8');
  const comments = readJsonArrayIfExists(p.reviewJson);
  const format = (c) => `- **${c.target || 'plan'}** [${c.type || 'note'} | ${c.status || 'open'}] ${c.text || ''}`;
  const reviewMd =
    `---\noxe_doc: plan_review\nstatus: ${status}\nupdated: ${nowIso.slice(0, 10)}\nplan_ref: ${path.basename(p.plan)}\n---\n\n# OXE — Revisão do Plano\n\n## Estado\n\n- **Status:** ${status}\n- **Atualizado em:** ${nowIso}\n- **Origem:** dashboard local\n- **Autor:** ${author}\n\n## Decisão\n\n- **Resultado:** ${status}\n- **Justificativa:** ${note}\n\n## Comentários abertos\n\n${comments.filter((x) => x.status !== 'resolved').map(format).join('\n') || '- Nenhum'}\n\n## Comentários resolvidos\n\n${comments.filter((x) => x.status === 'resolved').map(format).join('\n') || '- Nenhum'}\n\n## Próxima ação recomendada\n\n${status === 'approved' ? '- `/oxe-execute` ou `oxe-cc status` para seguir a trilha.' : '- `/oxe-plan --replan` ou ajuste do plano antes de executar.'}\n`;
  ensureDirForFile(p.planReview);
  fs.writeFileSync(p.planReview, reviewMd, 'utf8');
  operational.appendEvent(projectRoot, activeSession || null, {
    type: 'plan_review_status_changed',
    payload: { status, note, author, review_ref: reviewRef },
  });
  return { status, updatedAt: nowIso, ref: p.planReview, note, author, activeSession: activeSession || null };
}

function addPlanReviewComment(projectRoot, input = {}) {
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '# OXE — Estado\n';
  const activeSession = input.activeSession === undefined ? health.parseActiveSession(stateText) : input.activeSession;
  const p = reviewPaths(projectRoot, activeSession || null);
  const comments = readJsonArrayIfExists(p.reviewJson);
  const next = { id: `c-${Date.now().toString(36)}`, target: String(input.target || 'plan'), type: String(input.type || 'note'), status: 'open', author: String(input.author || 'dashboard'), created_at: new Date().toISOString(), text: String(input.text || '').trim() };
  comments.push(next);
  ensureDirForFile(p.reviewJson);
  fs.writeFileSync(p.reviewJson, JSON.stringify(comments, null, 2), 'utf8');
  operational.appendEvent(projectRoot, activeSession || null, {
    type: 'plan_review_comment_added',
    payload: { comment_id: next.id, target: next.target, comment_type: next.type },
  });
  savePlanReviewStatus(projectRoot, { activeSession, status: health.parsePlanReviewStatus(stateText) || 'in_review', note: 'Há comentários de revisão em aberto', author: String(input.author || 'dashboard') });
  return next;
}

function updatePlanReviewCommentStatus(projectRoot, input = {}) {
  const stateText = readTextIfExists(health.oxePaths(projectRoot).state) || '# OXE — Estado\n';
  const activeSession = input.activeSession === undefined ? health.parseActiveSession(stateText) : input.activeSession;
  const p = reviewPaths(projectRoot, activeSession || null);
  const comments = readJsonArrayIfExists(p.reviewJson);
  const idx = comments.findIndex((x) => x.id === input.commentId);
  if (idx === -1) return null;
  comments[idx] = { ...comments[idx], status: String(input.status || 'resolved'), updated_at: new Date().toISOString() };
  fs.writeFileSync(p.reviewJson, JSON.stringify(comments, null, 2), 'utf8');
  operational.appendEvent(projectRoot, activeSession || null, {
    type: 'plan_review_comment_updated',
    payload: { comment_id: comments[idx].id, status: comments[idx].status },
  });
  return comments[idx];
}

function loadDashboardContext(projectRoot, opts = {}) {
  const globalPaths = health.oxePaths(projectRoot);
  const stateText = readTextIfExists(globalPaths.state) || '';
  const activeSession = opts.activeSession === undefined ? health.parseActiveSession(stateText) : opts.activeSession;
  const p = reviewPaths(projectRoot, activeSession || null);
  const rootScoped = reviewPaths(projectRoot, null);
  const report = health.buildHealthReport(projectRoot);
  const specText = readScopedText(p.spec, rootScoped.spec);
  const planText = readScopedText(p.plan, rootScoped.plan);
  const verifyText = readScopedText(p.verify, rootScoped.verify);
  const runtimeText = readScopedText(p.runtime, rootScoped.runtime);
  const checkpointsText = readScopedText(p.checkpoints, rootScoped.checkpoints);
  const spec = parseSpec(specText);
  const plan = parsePlan(planText);
  const runtime = parseRuntime(runtimeText);
  const checkpoints = parseCheckpointsIndex(checkpointsText);
  const verify = parseVerify(verifyText);
  const activeRunState = operational.readRunState(projectRoot, activeSession || null);
  const traceEvents = operational.readEvents(projectRoot, activeSession || null);
  const traceSummary = operational.summarizeEvents(traceEvents);
  const memoryLayers = operational.buildMemoryLayers(projectRoot, activeSession || null);
  const capabilityCatalog = operational.readCapabilityCatalog(projectRoot);
  const azurePaths = azure.azurePaths(projectRoot);
  const dashboardPack = report.contextPacks && report.contextPacks.dashboard
    ? report.contextPacks.dashboard
    : contextEngine.inspectContextPack(projectRoot, { workflow: 'dashboard', activeSession: activeSession || null });
  const sessionsRaw = readTextIfExists(globalPaths.sessionsIndex) || '';
  const sessions = parseSessionsIndex(sessionsRaw);
  const sessionPath = activeSession ? path.join(projectRoot, '.oxe', activeSession, 'SESSION.md') : null;
  const sessionRaw = sessionPath ? readTextIfExists(sessionPath) || '' : '';
  const ctx = {
    projectRoot: path.resolve(projectRoot),
    activeSession: activeSession || null,
    phase: report.phase || health.parseStatePhase(stateText),
    healthStatus: report.healthStatus,
    nextStep: report.next,
    planReviewStatus: report.planReviewStatus || 'draft',
    state: { path: globalPaths.state, raw: stateText, parsed: { phase: health.parseStatePhase(stateText), activeSession, runtimeStatus: firstMatch(stateText, /\*\*runtime_status:\*\*\s*([^\n]+)/i) } },
    spec: { path: p.spec, raw: specText, objective: spec.objective, criteria: spec.criteria, uncoveredCriteria: spec.criteria.filter((c) => !plan.tasks.some((t) => (t.aceite || []).includes(c.id))) },
    plan: { path: p.plan, raw: planText, tasks: plan.tasks, waves: plan.waves, totalTasks: plan.totalTasks, selfEvaluation: report.planSelfEvaluation },
    runtime: { path: p.runtime, raw: runtimeText, summary: summarizeText(runtimeText, 800), parsed: runtime },
    activeRun: activeRunState,
    runtimeCanonical: activeRunState && activeRunState.canonical_state ? activeRunState.canonical_state : null,
    compiledGraph: activeRunState && activeRunState.compiled_graph ? activeRunState.compiled_graph : null,
    enterprise: {
      runtimeMode: report.runtimeMode || null,
      fallbackMode: report.fallbackMode || null,
      verificationSummary: report.verificationSummary || null,
      residualRiskSummary: report.residualRiskSummary || null,
      evidenceCoverage: report.evidenceCoverage || null,
      pendingGates: report.pendingGates || null,
      gateQueue: report.gateQueue || null,
      policyDecisionSummary: report.policyDecisionSummary || null,
      policyCoverage: report.policyCoverage || null,
      quotaSummary: report.quotaSummary || null,
      auditSummary: report.auditSummary || null,
      promotionSummary: report.promotionSummary || null,
      promotionReadiness: report.promotionReadiness || null,
      recoveryState: report.recoveryState || null,
      multiAgent: report.multiAgent || null,
      providerCatalog: report.providerCatalog || null,
      warnings: report.enterpriseWarn || [],
    },
    tracing: { path: operational.operationalPaths(projectRoot, activeSession || null).events, events: traceEvents, summary: traceSummary },
    checkpoints: { path: p.checkpoints, raw: checkpointsText, parsed: checkpoints },
    verify: { path: p.verify, raw: verifyText, summary: summarizeText(verifyText, 800), parsed: verify },
    review: { markdownPath: p.planReview, commentsPath: p.reviewJson, comments: readJsonArrayIfExists(p.reviewJson) },
    sessions: { indexPath: globalPaths.sessionsIndex, raw: sessionsRaw, items: sessions, currentPath: sessionPath, current: sessionRaw ? parseSessionDetail(sessionRaw) : null },
    support: { capabilitiesSummary: summarizeText(readTextIfExists(p.capabilitiesIndex) || '', 420), investigationsSummary: summarizeText(readTextIfExists(p.investigationsIndex) || '', 420) },
    capabilities: capabilityCatalog,
    memoryLayers,
    context: {
      pack: dashboardPack,
      packs: report.contextPacks || {},
      quality: report.contextQuality || null,
      freshness: report.packFreshness || {},
      summaries: report.activeSummaryRefs || {},
      semantics: report.semanticsDrift || null,
    },
    azure: report.azureActive && report.azure
      ? {
          ...report.azure,
          profilePath: azurePaths.profile,
          authStatusPath: azurePaths.authStatus,
          inventoryMarkdownPath: azurePaths.inventoryMd,
          serviceBusPath: azurePaths.serviceBusMd,
          eventGridPath: azurePaths.eventGridMd,
          sqlPath: azurePaths.sqlMd,
        }
      : null,
    diagnostics: {
      reviewWarnings: report.reviewWarn,
      runtimeWarnings: report.runtimeWarn,
      enterpriseWarnings: report.enterpriseWarn || [],
      planWarnings: report.planWarn,
      sessionWarnings: report.sessionWarn,
      capabilityWarnings: report.capabilityWarn,
      investigationWarnings: report.investigationWarn,
    },
    repositoryContext: readRepositoryContext(rootScoped.codebase),
  };
  if (ctx.azure) {
    const inventorySummary = ctx.azure.inventorySummary || { total: 0, servicebus: 0, eventgrid: 0, sql: 0 };
    ctx.repositoryContext.azure = {
      path: ctx.azure.inventoryMarkdownPath,
      summary: `login=${ctx.azure.authStatus && ctx.azure.authStatus.login_active ? 'ativo' : 'ausente'} · subscription=${ctx.azure.profile && (ctx.azure.profile.subscription_name || ctx.azure.profile.subscription_id) || '—'} · total=${inventorySummary.total} · sb=${inventorySummary.servicebus || 0} · eg=${inventorySummary.eventgrid || 0} · sql=${inventorySummary.sql || 0}`,
    };
  }
  ctx.readiness = computeReadiness(ctx, 70);
  ctx.coverage = buildCoverageMatrix(ctx.spec, ctx.plan, verify);
  ctx.calibration = computeCalibration(ctx.phase, ctx.plan.selfEvaluation.confidence, verify);
  ctx.visual = {
    flow: { nodes: [{ label: 'STATE', status: 'done' }, { label: 'SPEC', status: ctx.spec.raw ? 'done' : 'pending' }, { label: 'PLAN', status: ctx.plan.raw ? 'done' : 'pending' }, { label: 'REVIEW', status: ctx.planReviewStatus === 'approved' ? 'done' : /(rejected|needs_revision)/i.test(ctx.planReviewStatus) ? 'blocked' : 'active' }, { label: 'EXECUTE', status: ctx.runtime.parsed.status === 'running' ? 'active' : ctx.runtime.raw ? 'done' : 'pending' }, { label: 'CHECKPOINTS', status: ctx.readiness.checkpointPending ? 'active' : ctx.checkpoints.parsed.length ? 'done' : 'pending' }, { label: 'VERIFY', status: ctx.verify.raw ? 'done' : 'pending' }, { label: 'LESSONS', status: 'pending' }] },
    artifactGraph: [{ id: 'state', label: 'STATE', path: ctx.state.path, detail: ctx.phase || 'índice global', status: 'done' }, { id: 'spec', label: 'SPEC', path: ctx.spec.path, detail: ctx.spec.objective || 'contrato', status: ctx.spec.raw ? 'done' : 'pending' }, { id: 'plan', label: 'PLAN', path: ctx.plan.path, detail: `${ctx.plan.totalTasks} tarefas`, status: ctx.plan.raw ? 'done' : 'pending' }, { id: 'review', label: 'PLAN REVIEW', path: ctx.review.markdownPath, detail: ctx.planReviewStatus, status: ctx.planReviewStatus === 'approved' ? 'done' : 'active' }, { id: 'runtime', label: 'RUNTIME', path: ctx.runtime.path, detail: ctx.runtime.parsed.status || 'sem status', status: ctx.runtime.raw ? 'active' : 'pending' }, { id: 'active-run', label: 'ACTIVE RUN', path: operational.operationalPaths(projectRoot, activeSession || null).activeRun, detail: ctx.activeRun && ctx.activeRun.run_id ? `${ctx.activeRun.run_id} · ${ctx.activeRun.status}` : 'sem run ativo', status: ctx.activeRun ? 'active' : 'pending' }, { id: 'events', label: 'TRACE', path: operational.operationalPaths(projectRoot, activeSession || null).events, detail: `${ctx.tracing.summary.total} evento(s)`, status: ctx.tracing.summary.total ? 'done' : 'pending' }, { id: 'checkpoints', label: 'CHECKPOINTS', path: ctx.checkpoints.path, detail: `${ctx.checkpoints.parsed.length} gates`, status: ctx.readiness.checkpointPending ? 'active' : 'pending' }, { id: 'verify', label: 'VERIFY', path: ctx.verify.path, detail: ctx.calibration.status, status: ctx.verify.raw ? 'done' : 'pending' }],
  };
  if (ctx.azure) {
    ctx.visual.artifactGraph.push(
      {
        id: 'azure-profile',
        label: 'AZURE PROFILE',
        path: ctx.azure.profilePath,
        detail: ctx.azure.profile && (ctx.azure.profile.subscription_name || ctx.azure.profile.subscription_id) || 'sem subscription',
        status: ctx.azure.authStatus && ctx.azure.authStatus.login_active ? 'done' : 'blocked',
      },
      {
        id: 'azure-inventory',
        label: 'AZURE INVENTORY',
        path: ctx.azure.inventoryMarkdownPath,
        detail: ctx.azure.inventorySummary ? `${ctx.azure.inventorySummary.total} recurso(s)` : 'inventário ausente',
        status: ctx.azure.inventorySyncedAt ? (ctx.azure.inventoryStale && ctx.azure.inventoryStale.stale ? 'warning' : 'done') : 'pending',
      }
    );
  }
  ctx.operationalGraph = ctx.activeRun ? operational.buildOperationalGraph(ctx.activeRun) : { nodes: [], edges: [] };
  ctx.dashboard = { readOnly: false };
  return ctx;
}

function dashboardHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>OXE Dashboard</title><style>
  :root{--bg:#f4efe6;--bg2:#edf4ed;--panel:#fff;--ink:#1d2f3e;--muted:#617787;--line:#dbe3e8;--brand:#173f58;--ok:#1f7a52;--warn:#9d6b12;--bad:#a53e3e;--info:#235f84;--okbg:#e4f3eb;--warnbg:#fbf0da;--badbg:#f8e8e8;--infobg:#e5eff7;--shadow:0 16px 40px rgba(17,32,44,.08);--radius:18px}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,var(--bg),var(--bg2));font-family:"Segoe UI",Arial,sans-serif;color:var(--ink)}.page{max-width:1560px;margin:0 auto;padding:24px}.hero,.stats,.tabs,.grid2,.grid3,.layout{display:grid;gap:16px}.hero{grid-template-columns:1.2fr .8fr}.stats{grid-template-columns:repeat(5,minmax(0,1fr));margin:0 0 16px}.layout{grid-template-columns:1.45fr .95fr}.grid2{grid-template-columns:repeat(2,minmax(0,1fr))}.grid3{grid-template-columns:repeat(3,minmax(0,1fr))}.panel,.metric,.mini,.item,.entry{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}.panel{padding:18px}.metric,.mini,.item,.entry{padding:14px}.stack,.list,.rail{display:grid;gap:14px}.rail{grid-template-columns:repeat(8,minmax(100px,1fr))}.tabs{grid-template-columns:repeat(7,max-content)}.tab{padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:#fff;cursor:pointer;font-weight:700}.tab.active{background:var(--brand);color:#fff;border-color:var(--brand)}.view{display:none}.view.active{display:block}.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.value{font-size:24px;font-weight:800;margin-top:6px}.muted{color:var(--muted)}.small{font-size:13px}.badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 10px;font-size:11px;text-transform:uppercase;font-weight:800}.done{background:var(--okbg);color:var(--ok)}.active{background:var(--infobg);color:var(--info)}.warning{background:var(--warnbg);color:var(--warn)}.blocked{background:var(--badbg);color:var(--bad)}.pending{background:#edf1f4;color:#567181}.head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}button{border:0;border-radius:12px;padding:10px 12px;font-weight:700;cursor:pointer}.primary{background:var(--brand);color:#fff}.secondary{background:#edf2f5;color:var(--ink)}.warnbtn{background:#f2e3c5;color:#81540a}.danger{background:#f5dada;color:#8d3030}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:12px;padding:10px;font:inherit}.form{display:grid;gap:10px}.raw{white-space:pre-wrap;background:#f8faf9;border:1px solid var(--line);border-radius:12px;padding:12px;max-height:220px;overflow:auto}.chip{display:inline-flex;border-radius:999px;padding:4px 8px;background:#eef3f6;color:#355267;font-size:12px;margin:4px 6px 0 0}.node{padding:12px;border:1px solid var(--line);border-radius:16px;background:#fff}.go{background:linear-gradient(180deg,#f2fbf5,#ebf7ef)}.nogo{background:linear-gradient(180deg,#fff5f5,#faeded)}@media (max-width:1200px){.hero,.layout{grid-template-columns:1fr}.rail{grid-template-columns:repeat(4,minmax(100px,1fr))}}@media (max-width:860px){.stats,.grid2,.grid3,.tabs,.rail{grid-template-columns:1fr}.page{padding:16px}}</style></head><body><div class="page"><div class="hero"><div class="panel"><h1 style="margin:0;font-size:42px">OXE Decision Control Room</h1><div class="muted" style="margin-top:10px">Control room para decisões reais de Go / No-Go, sem duplicar a fonte de verdade textual do OXE.</div></div><div class="grid2"><div class="mini"><div class="label">Projeto</div><div class="small" id="hero-project">—</div></div><div class="mini"><div class="label">Sessão</div><div class="value" id="hero-session">—</div></div><div class="mini"><div class="label">Próximo passo</div><div class="small" id="hero-next">—</div></div><div class="mini"><div class="label">Confiança</div><div class="value" id="hero-confidence">—</div></div></div></div><div id="app">Carregando…</div></div><script>
  const app=document.getElementById('app');let ctx=null;let tab='decision';let session=null;
  const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); const cls=(s)=>{const v=String(s||'').toLowerCase();if(/(healthy|approved|done|go|well-calibrated|passed|ready|completed)/.test(v))return'done';if(/(running|in_review|active|mentioned|acceptable|controlled|replaying)/.test(v))return'active';if(/(rejected|needs_revision|blocked|failed|no-go|overconfident|do_not_execute|aborted|waiting_approval)/.test(v))return'blocked';if(/(risk|warning|underconfident|needs_refinement|paused)/.test(v))return'warning';return'pending';}; const badge=(s,l)=>'<span class="badge '+cls(s)+'">'+esc(l||s||'pending')+'</span>'; const list=(items,empty)=>items&&items.length?'<div class="list">'+items.join('')+'</div>':'<div class="entry small">'+esc(empty)+'</div>'; const runtimeDisabled=()=>ctx&&ctx.dashboard&&ctx.dashboard.readOnly;
  async function api(url,opts={}){const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});if(!res.ok)throw new Error(await res.text());return res.json();} async function refresh(){ctx=await api('/api/context'+(session?'?session='+encodeURIComponent(session):''));render();}
  function render(){document.getElementById('hero-project').textContent=ctx.projectRoot||'—';document.getElementById('hero-session').textContent=ctx.activeSession||'modo legado';document.getElementById('hero-next').textContent=(ctx.nextStep.step||'—')+' · '+(ctx.nextStep.reason||'—');document.getElementById('hero-confidence').textContent=ctx.readiness.confidence!=null?ctx.readiness.confidence+'%':'—';
    const flow=(ctx.visual.flow.nodes||[]).map((n)=>'<div class="node"><div class="label">Etapa</div><div style="font-weight:800;font-size:18px;margin-top:6px">'+esc(n.label)+'</div><div style="margin-top:10px">'+badge(n.status)+'</div></div>');
    const graph=(ctx.visual.artifactGraph||[]).map((n)=>'<div class="item"><div class="head"><strong>'+esc(n.label)+'</strong>'+badge(n.status)+'</div><div class="small">'+esc(n.detail||'—')+'</div><div class="small muted" style="margin-top:8px">'+esc(n.path||'—')+'</div></div>');
    const waves=(ctx.plan.waves||[]).map((w)=>'<div class="panel"><div class="head"><div><strong>Onda '+esc(w.wave)+'</strong><div class="small muted">'+esc(w.taskIds.length)+' tarefas</div></div>'+badge(String(ctx.runtime.parsed.currentWave)===String(w.wave)?'running':'planned')+'</div>'+w.tasks.map((t)=>'<div class="entry"><div style="font-weight:800">'+esc(t.id)+' — '+esc(t.title)+'</div><div class="small muted" style="margin-top:6px">Depende de: '+esc(t.dependsOn.length?t.dependsOn.join(', '):'—')+'</div><div class="small muted">Verificação: '+esc(t.verifyCommand||'—')+'</div><div class="small" style="margin-top:6px">'+(t.aceite||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+(t.decisions||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div></div>').join('')+'</div>');
    const coverage=(ctx.coverage||[]).map((c)=>'<div class="item"><div class="head"><strong>'+esc(c.id)+'</strong>'+badge(c.verifyStatus,c.verifyStatus)+'</div><div class="small">'+esc(c.criterion)+'</div><div class="small muted" style="margin-top:8px">Plano: '+esc(c.tasks.length?c.tasks.join(', '):'sem cobertura')+'</div><div class="small muted">Verify: '+esc(c.verifySummary||c.verifyHow||'sem evidência explícita')+'</div></div>');
    const checkpoints=(ctx.checkpoints.parsed||[]).map((c)=>'<div class="item"><div class="head"><strong>'+esc(c.id)+'</strong>'+badge(c.status)+'</div><div class="small muted">Tipo: '+esc(c.type)+' · Fase: '+esc(c.phase||'—')+' · Escopo: '+esc(c.scope||'—')+'</div><div class="small" style="margin-top:8px">'+esc(c.notes||'—')+'</div></div>');
    const agents=((ctx.runtime.parsed.agents&&ctx.runtime.parsed.agents.length)?ctx.runtime.parsed.agents:(ctx.blueprint&&ctx.blueprint.agents)||[]).map((a)=>'<div class="item"><div class="head"><strong>'+esc(a.id||a.name||'agent')+'</strong>'+badge(a.status||a.model_hint||'planned')+'</div><div class="small muted">'+esc(a.role||a.persona||'—')+'</div><div class="small">Tarefas: '+esc((a.tasks||[]).join(', ')||a.scope||'—')+'</div></div>');
    const comments=(ctx.review.comments||[]).map((c)=>'<div class="item"><div class="small muted">'+esc(c.target)+' · '+esc(c.type)+' · '+esc(c.status)+' · '+esc(c.author)+'</div><div style="margin-top:6px">'+esc(c.text)+'</div>'+(c.status!=='resolved'?'<div class="actions"><button class="secondary" onclick="resolveComment(\\''+esc(c.id)+'\\')">Resolver</button></div>':'')+'</div>');
    const sessions=(ctx.sessions.items||[]).map((s)=>'<div class="item"><div class="head"><div><strong>'+esc(s.id)+' · '+esc(s.name)+'</strong><div class="small muted">Criada: '+esc(s.createdAt)+' · Última atividade: '+esc(s.lastActivity)+'</div></div>'+badge(s.status)+'</div><div class="small">'+esc(s.summary||'—')+'</div><div class="small muted" style="margin-top:8px">'+esc(s.path||'—')+'</div><div class="actions"><button class="secondary" onclick="openSession(\\''+esc(s.path)+'\\')">Abrir sessão</button></div></div>');
    const repo=Object.entries(ctx.repositoryContext||{}).map(([k,v])=>'<div class="item"><strong>'+esc(k.toUpperCase())+'</strong><div class="small" style="margin-top:8px">'+esc(v.summary||'Sem resumo disponível.')+'</div><div class="small muted" style="margin-top:8px">'+esc(v.path||'—')+'</div></div>');
    const contextSelected=((ctx.context&&ctx.context.pack&&ctx.context.pack.selected_artifacts)||[]).map((artifact)=>'<div class="item"><div class="head"><strong>'+esc(artifact.alias)+'</strong>'+badge(artifact.exists?(artifact.using_fallback?'fallback':'selected'):'missing',artifact.exists?(artifact.using_fallback?'fallback':'selected'):'missing')+'</div><div class="small">'+esc(artifact.summary||'—')+'</div><div class="small muted" style="margin-top:8px">'+esc(artifact.path||'—')+'</div></div>');
    const contextGaps=((ctx.context&&ctx.context.pack&&ctx.context.pack.gaps)||[]).map((gap)=>'<div class="entry small">['+esc(gap.severity)+'] '+esc(gap.alias)+': '+esc(gap.reason)+'</div>');
    const contextConflicts=((ctx.context&&ctx.context.pack&&ctx.context.pack.conflicts)||[]).map((conflict)=>'<div class="entry small">'+esc(conflict.alias)+': '+esc(conflict.reason)+'</div>');
    const semanticsWarnings=((ctx.context&&ctx.context.semantics&&ctx.context.semantics.audit&&ctx.context.semantics.audit.warnings)||[]).map((warning)=>'<div class="entry small">'+esc(warning)+'</div>');
  const blockers=(ctx.readiness.blockers||[]).map((x)=>'<div class="entry small">'+esc(x)+'</div>'); const warnings=(ctx.readiness.warnings||[]).concat((ctx.diagnostics.enterpriseWarnings||[])).slice(0,10).map((x)=>'<div class="entry small">'+esc(x)+'</div>'); const evidence=(ctx.runtime.parsed.evidence||[]).map((x)=>'<div class="entry small">'+esc(x)+'</div>'); const blockages=(ctx.runtime.parsed.blockages||[]).map((x)=>'<div class="entry small">'+esc(x)+'</div>'); const history=((ctx.sessions.current&&ctx.sessions.current.history)||[]).map((x)=>'<div class="entry small">'+esc(x.date)+' · '+esc(x.event)+'</div>');
  const enterpriseGates=((ctx.enterprise&&ctx.enterprise.pendingGates&&ctx.enterprise.pendingGates.pending)||[]).map((gate)=>'<div class="entry small">'+esc(gate.gate_id)+' · '+esc(gate.scope)+' · '+esc(gate.work_item_id||'run')+'</div>');
    app.innerHTML='<div class="stats"><div class="metric"><div class="label">Saúde lógica</div><div class="value">'+badge(ctx.healthStatus)+'</div></div><div class="metric"><div class="label">Go / No-Go</div><div class="value">'+badge(ctx.readiness.decision,ctx.readiness.decision)+'</div></div><div class="metric"><div class="label">Review</div><div class="value">'+badge(ctx.planReviewStatus)+'</div></div><div class="metric"><div class="label">Checkpoints</div><div class="value">'+badge(ctx.readiness.checkpointPending?'pending_approval':'clear',ctx.readiness.checkpointPending?'pendente':'ok')+'</div></div><div class="metric"><div class="label">Runtime</div><div class="value">'+badge(ctx.runtime.parsed.status||ctx.state.parsed.runtimeStatus||'pending')+'</div></div></div>'
    +'<div class="tabs">'+['decision','plan','execution','evidence','sessions','context','repository'].map((t)=>'<button class="tab'+(tab===t?' active':'')+'" onclick="setTab(\\''+t+'\\')">'+(t==='repository'?'repository context':t)+'</button>').join('')+'</div>'
    +'<div class="view'+(tab==='decision'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Decision Control</h2><div class="muted">A pergunta principal: podemos executar agora?</div></div></div><div class="'+(ctx.readiness.go?'panel go':'panel nogo')+'" style="padding:18px"><div class="label">Decisão operacional</div><div style="font-size:38px;font-weight:900;margin-top:8px">'+(ctx.readiness.go?'GO':'NO-GO')+'</div><div class="small muted" style="margin-top:8px">'+esc(ctx.nextStep.reason||'—')+'</div><div class="actions">'+badge(ctx.planReviewStatus,'review:'+ctx.planReviewStatus)+badge(ctx.readiness.confidenceBand,'confiança:'+ctx.readiness.confidenceBand)+(ctx.readiness.checkpointPending?badge('pending_approval','checkpoint pendente'):'')+'</div></div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Decision Rail</h2><div class="muted">Spec → Plan → Review → Execute → Verify → Lessons.</div></div></div><div class="rail">'+flow.join('')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Readiness Map</h2><div class="muted">Bloqueios e sinais ativos antes do execute.</div></div></div><div class="grid2"><div><h3>Bloqueios</h3>'+list(blockers,'Sem bloqueios formais para executar.')+'</div><div><h3>Warnings</h3>'+list(warnings,'Sem warnings relevantes.')+'</div></div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Review e aprovação</h2><div class="muted">Persistida em STATE.md, PLAN-REVIEW.md e comentários.</div></div></div><div class="grid2"><div><div class="actions"><button class="primary" onclick="changeReview(\\'approved\\')">Aprovar</button><button class="warnbtn" onclick="changeReview(\\'needs_revision\\')">Pedir revisão</button><button class="secondary" onclick="changeReview(\\'in_review\\')">Marcar em revisão</button><button class="danger" onclick="changeReview(\\'rejected\\')">Rejeitar</button></div><div class="form"><input id="comment-target" placeholder="target ex.: wave:1, T2, checkpoint:CP-01"/><select id="comment-type"><option value="note">note</option><option value="risk">risk</option><option value="question">question</option><option value="approval">approval</option></select><textarea id="comment-text" rows="6" placeholder="Comentário de revisão"></textarea><button class="primary" onclick="addComment()">Adicionar comentário</button></div></div><div><h3>Comentários</h3>'+list(comments,'Nenhum comentário de revisão.')+'</div></div></div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Mapa de artefatos</h2><div class="muted">Fonte de verdade visual do ciclo atual.</div></div></div><div class="grid3">'+graph.join('')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Calibração do plano</h2><div class="muted">Confiança prevista versus resultado real.</div></div>'+badge(ctx.calibration.status)+'</div><div class="small">'+esc(ctx.calibration.summary)+'</div></div></div></div></div>'
    +'<div class="view'+(tab==='plan'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Trilha do plano</h2><div class="muted">Ondas, dependências e vínculos com aceite e decisões.</div></div>'+badge(ctx.planReviewStatus)+'</div>'+list(waves,'PLAN.md ausente ou sem tarefas estruturadas.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Matriz de cobertura</h2><div class="muted">SPEC → PLAN → VERIFY em um único quadro.</div></div></div><div class="grid2">'+coverage.join('')+'</div></div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Autoavaliação do plano</h2><div class="muted">Melhor plano atual e faixa de confiança.</div></div></div><div class="grid3"><div class="item"><strong>Melhor plano atual</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.plan.selfEvaluation&&ctx.plan.selfEvaluation.bestPlan)||'—')+'</div></div><div class="item"><strong>Confiança</strong><div class="small muted" style="margin-top:8px">'+esc(ctx.readiness.confidence!=null?ctx.readiness.confidence+'%':'—')+'</div></div><div class="item"><strong>Faixa</strong><div class="small muted" style="margin-top:8px">'+esc(ctx.readiness.confidenceBand)+'</div></div></div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Lacunas da SPEC</h2><div class="muted">Critérios sem cobertura explícita no plano.</div></div></div>'+list((ctx.spec.uncoveredCriteria||[]).map((c)=>'<div class="entry small">'+esc(c.id)+' · '+esc(c.criterion)+'</div>'),'Sem lacunas detectadas.')+'</div></div></div></div>'
  +'<div class="view'+(tab==='execution'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Runtime operacional</h2><div class="muted">Estado tático da execução.</div></div>'+badge(ctx.runtime.parsed.status||'pending')+'</div><div class="grid3"><div class="item"><strong>Onda atual</strong><div class="small muted" style="margin-top:8px">'+esc(ctx.runtime.parsed.currentWave||'—')+'</div></div><div class="item"><strong>Tarefas ativas</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.runtime.parsed.activeTasks||[]).join(', ')||'—')+'</div></div><div class="item"><strong>Próxima ação</strong><div class="small muted" style="margin-top:8px">'+esc(ctx.runtime.parsed.nextAction||'—')+'</div></div><div class="item"><strong>Motivo</strong><div class="small muted" style="margin-top:8px">'+esc(ctx.runtime.parsed.nextReason||'—')+'</div></div><div class="item"><strong>Modo runtime</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.enterprise&&ctx.enterprise.runtimeMode&&ctx.enterprise.runtimeMode.runtime_mode)||'—')+'</div></div><div class="item"><strong>Fallback</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.enterprise&&ctx.enterprise.fallbackMode)||'—')+'</div></div></div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Checkpoints</h2><div class="muted">Gates humanos formais.</div></div></div>'+list(checkpoints,'CHECKPOINTS.md ausente ou sem gates formais.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Gates pendentes</h2><div class="muted">Fila operacional persistida por run/work item.</div></div></div>'+list(enterpriseGates,'Sem gates pendentes no runtime.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Agentes</h2><div class="muted">Blueprint e runtime multiagente.</div></div></div>'+list(agents,'Sem blueprint de agentes ou runtime multiagente ativo.')+'</div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Evidências</h2><div class="muted">Artefatos e sinais da execução atual.</div></div></div>'+list(evidence,'Sem evidência operacional registrada.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Enterprise verify</h2><div class="muted">Manifest, risco residual, governança e promoção.</div></div></div><div class="grid3">'+kvItem('Checks',(ctx.enterprise&&ctx.enterprise.verificationSummary&&ctx.enterprise.verificationSummary.total)||'—')+kvItem('Fail',(ctx.enterprise&&ctx.enterprise.verificationSummary&&ctx.enterprise.verificationSummary.fail)||0)+kvItem('Coverage',(ctx.enterprise&&ctx.enterprise.evidenceCoverage&&String(ctx.enterprise.evidenceCoverage.coverage_percent)+'%')||'—')+kvItem('Residual risks',(ctx.enterprise&&ctx.enterprise.residualRiskSummary&&ctx.enterprise.residualRiskSummary.total)||0)+kvItem('High/Critical',(ctx.enterprise&&ctx.enterprise.residualRiskSummary&&ctx.enterprise.residualRiskSummary.highOrCritical)||0)+kvItem('Policy decisions',(ctx.enterprise&&ctx.enterprise.policyDecisionSummary&&ctx.enterprise.policyDecisionSummary.total)||0)+kvItem('Policy coverage',(ctx.enterprise&&ctx.enterprise.policyCoverage&&String(ctx.enterprise.policyCoverage.coveragePercent)+'%')||'—')+kvItem('Quota retries',(ctx.enterprise&&ctx.enterprise.quotaSummary&&ctx.enterprise.quotaSummary.consumed&&String(ctx.enterprise.quotaSummary.consumed.retries)+'/'+((ctx.enterprise.quotaSummary.limits&&ctx.enterprise.quotaSummary.limits.maxRetriesPerRun)!=null?ctx.enterprise.quotaSummary.limits.maxRetriesPerRun:'∞'))||'—')+kvItem('Audit critical',(ctx.enterprise&&ctx.enterprise.auditSummary&&ctx.enterprise.auditSummary.critical)||0)+kvItem('Promotion',(ctx.enterprise&&ctx.enterprise.promotionSummary&&ctx.enterprise.promotionSummary.status)||'—')+kvItem('Promotion readiness',(ctx.enterprise&&ctx.enterprise.promotionReadiness&&ctx.enterprise.promotionReadiness.status)||'—')+kvItem('Recovery',(ctx.enterprise&&ctx.enterprise.recoveryState&&ctx.enterprise.recoveryState.status)||'—')+kvItem('Providers',((ctx.enterprise&&ctx.enterprise.providerCatalog&&ctx.enterprise.providerCatalog.summary&&((ctx.enterprise.providerCatalog.summary.pluginsCount!=null?ctx.enterprise.providerCatalog.summary.pluginsCount:ctx.enterprise.providerCatalog.summary.total_plugins)!=null?(ctx.enterprise.providerCatalog.summary.pluginsCount!=null?ctx.enterprise.providerCatalog.summary.pluginsCount:ctx.enterprise.providerCatalog.summary.total_plugins):Array.isArray(ctx.enterprise.providerCatalog.summary.plugins)?ctx.enterprise.providerCatalog.summary.plugins.length:0)))||0)+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Bloqueios</h2><div class="muted">O que impede avanço agora.</div></div></div>'+list(blockages,'Sem bloqueios explícitos.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Runtime bruto</h2><div class="muted">Leitura direta do artefato operacional.</div></div></div><div class="raw">'+esc(ctx.runtime.summary||'EXECUTION-RUNTIME.md ausente.')+'</div></div></div></div></div>'
    +'<div class="view'+(tab==='evidence'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Verify</h2><div class="muted">Evidência final e validação.</div></div>'+badge(ctx.calibration.status)+'</div><div class="raw">'+esc(ctx.verify.summary||'VERIFY.md ausente.')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Critérios no verify</h2><div class="muted">Evidências detectadas por critério A*.</div></div></div><div class="grid2">'+coverage.join('')+'</div></div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Investigações</h2><div class="muted">Base de evidência antes do plano.</div></div></div><div class="raw">'+esc(ctx.support.investigationsSummary||'INVESTIGATIONS.md ausente.')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Capabilities</h2><div class="muted">Recursos nativos do projeto.</div></div></div><div class="raw">'+esc(ctx.support.capabilitiesSummary||'CAPABILITIES.md ausente.')+'</div></div></div></div></div>'
    +'<div class="view'+(tab==='sessions'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Sessão ativa</h2><div class="muted">Contexto atual resolvido pelo STATE global.</div></div></div><div class="grid2"><div class="item"><strong>ID</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.sessions.current&&ctx.sessions.current.id)||'—')+'</div></div><div class="item"><strong>Nome</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.sessions.current&&ctx.sessions.current.name)||ctx.activeSession||'—')+'</div></div><div class="item"><strong>Status</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.sessions.current&&ctx.sessions.current.status)||'—')+'</div></div><div class="item"><strong>Última atividade</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.sessions.current&&ctx.sessions.current.lastActivity)||'—')+'</div></div></div><div class="item" style="margin-top:14px"><strong>Resumo</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.sessions.current&&ctx.sessions.current.summary)||'Sem SESSION.md ativo ou modo legado.')+'</div><div class="small muted" style="margin-top:8px">'+esc(ctx.sessions.currentPath||'—')+'</div></div><div class="item" style="margin-top:14px"><strong>Tags</strong><div class="small" style="margin-top:8px">'+((ctx.sessions.current&&ctx.sessions.current.tags)||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div></div><h3>Histórico</h3>'+list(history,'Sem histórico de sessão disponível.')+'</div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Lista de sessões</h2><div class="muted">Índice real lido de .oxe/SESSIONS.md.</div></div></div>'+list(sessions,'SESSIONS.md ausente ou sem sessões registradas.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Índice bruto</h2><div class="muted">Leitura direta do artefato global.</div></div></div><div class="raw">'+esc(ctx.sessions.raw||'SESSIONS.md ausente.')+'</div></div></div></div></div>'
    +'<div class="view'+(tab==='context'?' active':'')+'"><div class="layout"><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Context Pack</h2><div class="muted">Seleção determinística de artefatos para este estado do OXE.</div></div>'+badge((ctx.context&&ctx.context.quality&&ctx.context.quality.primaryStatus)||((ctx.context&&ctx.context.pack&&ctx.context.pack.context_quality&&ctx.context.pack.context_quality.status)||'pending'))+'</div><div class="grid3"><div class="item"><strong>Workflow primário</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.context&&ctx.context.quality&&ctx.context.quality.primaryWorkflow)||'dashboard')+'</div></div><div class="item"><strong>Score</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.context&&ctx.context.quality&&ctx.context.quality.primaryScore)!=null?String(ctx.context.quality.primaryScore):'—')+'</div></div><div class="item"><strong>Freshness</strong><div class="small muted" style="margin-top:8px">'+esc((ctx.context&&ctx.context.pack&&ctx.context.pack.freshness&&ctx.context.pack.freshness.reason)||'—')+'</div></div></div><div class="small muted" style="margin-top:12px">Pack: '+esc((ctx.context&&ctx.context.pack&&ctx.context.pack.path)||'—')+' · semantics hash: '+esc((ctx.context&&ctx.context.pack&&ctx.context.pack.semantics_hash)||'—')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Artefatos selecionados</h2><div class="muted">Contexto efetivamente priorizado pelo pack.</div></div></div><div class="grid2">'+contextSelected.join('')+'</div></div></div><div class="stack"><div class="panel"><div class="head"><div><h2 style="margin:0">Gaps e conflitos</h2><div class="muted">Lacunas e divergências entre raiz e sessão.</div></div></div><h3>Gaps</h3>'+list(contextGaps,'Sem gaps no pack atual.')+'<h3>Conflitos</h3>'+list(contextConflicts,'Sem conflitos detectados.')+'</div><div class="panel"><div class="head"><div><h2 style="margin:0">Summaries ativos</h2><div class="muted">Referências persistidas para compressão de contexto.</div></div></div><div class="grid2">'+kvItem('Project summary',(ctx.context&&ctx.context.summaries&&ctx.context.summaries.project)||'—')+kvItem('Session summary',(ctx.context&&ctx.context.summaries&&ctx.context.summaries.session)||'—')+kvItem('Phase summary',(ctx.context&&ctx.context.summaries&&ctx.context.summaries.phase)||'—')+'</div></div><div class="panel"><div class="head"><div><h2 style="margin:0">Semântica multi-runtime</h2><div class="muted">Drift auditável entre workflow, wrapper e prompt renderizado.</div></div>'+badge(ctx.context&&ctx.context.semantics&&ctx.context.semantics.ok?'healthy':'warning',ctx.context&&ctx.context.semantics&&ctx.context.semantics.ok?'ok':'drift')+'</div><div class="small muted">Manifest: '+esc((ctx.context&&ctx.context.semantics&&ctx.context.semantics.manifestPath)||'—')+' · mismatch count: '+esc((ctx.context&&ctx.context.semantics&&ctx.context.semantics.audit&&ctx.context.semantics.audit.mismatchCount)||0)+'</div>'+list(semanticsWarnings,'Sem warnings semânticos ativos.')+'</div></div></div></div>'
    +'<div class="view'+(tab==='repository'?' active':'')+'"><div class="panel"><div class="head"><div><h2 style="margin:0">Repository Context</h2><div class="muted">Contexto de repositório como suporte de decisão.</div></div></div><div class="grid3">'+repo.join('')+'</div></div></div>'; enhanceExecutionView();}
  function executionViewElement(){return Array.from(app.querySelectorAll('.view')).find((view)=>view.textContent.includes('Runtime operacional'));}
    function panel(title,body){return '<div class="panel"><div class="head"><div><h2 style="margin:0">'+esc(title)+'</h2></div></div>'+body+'</div>';}
    function kvItem(label,value){return '<div class="item"><strong>'+esc(label)+'</strong><div class="small muted" style="margin-top:8px">'+esc(value)+'</div></div>';}
    function actionButton(label,action,klass){return '<button class="'+klass+'" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\''+action+'\\')">'+label+'</button>';}
    function enhanceExecutionView(){
      const view=executionViewElement();
    if(!view||!ctx)return;
    const stacks=view.querySelectorAll('.stack');
    if(stacks.length<2)return;
    const activeRun=ctx.activeRun||{};
    const graph=ctx.operationalGraph||{nodes:[],edges:[]};
    const trace=((ctx.tracing&&ctx.tracing.events)||[]).slice(-8).reverse().map((event)=>'<div class="entry"><div class="head"><strong>'+esc(event.type)+'</strong>'+badge(event.timestamp?event.timestamp.slice(11,19):'—',event.timestamp?event.timestamp.slice(11,19):'—')+'</div><div class="small muted">run='+esc(event.run_id||'—')+' · wave='+esc(event.wave_id||'—')+' · task='+esc(event.task_id||'—')+'</div><div class="small" style="margin-top:8px">'+esc(JSON.stringify(event.payload||{}))+'</div></div>').join('')||'<div class="entry small">Sem eventos registrados.</div>';
    const nodes=(graph.nodes||[]).map((node)=>'<div class="item"><div class="head"><strong>'+esc(node.label||node.id)+'</strong>'+badge(node.status||'pending')+'</div><div class="small muted">'+esc(node.kind||'node')+'</div><div class="small" style="margin-top:8px">'+esc(node.detail||'—')+'</div></div>').join('')||'<div class="entry small">Sem nós operacionais.</div>';
    const edges=(graph.edges||[]).map((edge)=>'<div class="entry"><div class="small"><strong>'+esc(edge.from)+'</strong> → <strong>'+esc(edge.to)+'</strong></div><div class="small muted" style="margin-top:6px">'+esc(edge.type||'link')+' · '+esc(edge.status||'—')+'</div><div class="small" style="margin-top:6px">'+esc(edge.reason||edge.label||'—')+'</div></div>').join('')||'<div class="entry small">Sem handoffs ou dependências registradas.</div>';
      const memory=Object.entries(ctx.memoryLayers||{}).filter(([key])=>key!=='readOrder').map(([key,val])=>kvItem(key,Array.isArray(val.source)?val.source.join(' | '):val.source||'—')).join('')||'<div class="entry small">Sem contrato de memória disponível.</div>';
      const enterprise=ctx.enterprise||{};
      const gateQueue=enterprise.gateQueue||{pending:[],stalePending:[],resolvedRecent:[],gateSlaHours:24};
      const pendingGates=(gateQueue.pending||[]).map((gate)=>'<div class="entry"><div class="head"><strong>'+esc(gate.gate_id)+'</strong>'+badge(gate.status||'pending')+'</div><div class="small muted">scope='+esc(gate.scope||'—')+' · task='+esc(gate.work_item_id||'—')+' · actor='+(gate.actor?esc(gate.actor):'—')+'</div><div class="small" style="margin-top:8px">'+esc((gate.context&&gate.context.description)||gate.action||'Sem descrição')+'</div><div class="actions" style="margin-top:12px"><button class="primary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gate.gate_id)+'\\',\\'approve\\')">Approve</button><button class="warnbtn" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gate.gate_id)+'\\',\\'waive\\')">Waive</button><button class="danger" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gate.gate_id)+'\\',\\'reject\\')">Reject</button></div></div>').join('')||'<div class="entry small">Sem gates pendentes.</div>';
      const staleGates=(gateQueue.stalePending||[]).map((gate)=>'<div class="entry"><div class="head"><strong>'+esc(gate.gate_id)+'</strong>'+badge('stale','warning')+'</div><div class="small muted">requested_at='+esc(gate.requested_at||'—')+' · scope='+esc(gate.scope||'—')+'</div></div>').join('')||'<div class="entry small">Sem gates stale.</div>';
      const recentResolved=(gateQueue.resolvedRecent||[]).map((gate)=>'<div class="entry"><div class="head"><strong>'+esc(gate.gate_id)+'</strong>'+badge(gate.decision||'resolved','ok')+'</div><div class="small muted">actor='+esc(gate.actor||'—')+' · reason='+esc(gate.reason||'—')+'</div></div>').join('')||'<div class="entry small">Sem resoluções recentes.</div>';
      const gatePanel=panel('Runtime gates','<div class="grid3">'+kvItem('Pending',String((gateQueue.pending||[]).length))+kvItem('Stale',String(gateQueue.staleCount||0))+kvItem('SLA (h)',String(gateQueue.gateSlaHours||24))+'</div><h3>Pendentes</h3>'+pendingGates+'<h3>Stale</h3>'+staleGates+'<h3>Resolvidos nas últimas 24h</h3>'+recentResolved);
      const multiAgent=enterprise.multiAgent||null;
      const multiAgentPanel=multiAgent&&multiAgent.enabled?panel('Multi-agent','<div class="grid3">'+kvItem('Mode',multiAgent.mode||'—')+kvItem('Isolation',multiAgent.workspaceIsolationEnforced?'isolated':'shared')+kvItem('Agents',String((multiAgent.agents||[]).length))+'</div><h3>Ownership</h3>'+((multiAgent.ownership||[]).map((item)=>'<div class="entry"><div class="head"><strong>'+esc(item.work_item_id||'—')+'</strong>'+badge(item.owner_agent_id||'unassigned')+'</div></div>').join('')||'<div class="entry small">Sem ownership ativo.</div>')+'<h3>Handoffs</h3>'+((multiAgent.handoffs||[]).map((handoff)=>'<div class="entry"><div class="small"><strong>'+esc(handoff.from_agent_id||'—')+'</strong> → <strong>'+esc(handoff.to_agent_id||'—')+'</strong></div><div class="small muted" style="margin-top:6px">'+esc(handoff.work_item_id||'—')+'</div></div>').join('')||'<div class="entry small">Sem handoffs registrados.</div>')):'';
      const recovery=enterprise.recoveryState||null;
      const recoveryPanel=recovery?panel('Recovery','<div class="grid3">'+kvItem('Status',recovery.status||'—')+kvItem('Last recovery',recovery.lastRecoveredAt||'—')+kvItem('Issues',String((recovery.issues||[]).length))+'</div><h3>Issues</h3>'+((recovery.issues||[]).map((issue)=>'<div class="entry"><div class="small"><strong>'+esc(issue.code||'issue')+'</strong></div><div class="small muted" style="margin-top:6px">'+esc(issue.message||issue.reason||'—')+'</div></div>').join('')||'<div class="entry small">Sem inconsistências abertas.</div>')):'';
      const promotion=enterprise.promotionReadiness||null;
      const promotionPanel=promotion?panel('Promotion readiness','<div class="grid3">'+kvItem('Status',promotion.status||'—')+kvItem('Coverage',String(promotion.coveragePercent==null?'—':promotion.coveragePercent+'%'))+kvItem('Policy',String(promotion.policyCoveragePercent==null?'—':promotion.policyCoveragePercent+'%'))+'</div><h3>Blockers</h3>'+((promotion.reasons||promotion.blockers||[]).map((reason)=>'<div class="entry small">'+esc(reason)+'</div>').join('')||'<div class="entry small">Sem blockers ativos.</div>')):'';
      const azure=ctx.azure||null;
    const azureInventory=azure&&azure.inventorySummary?azure.inventorySummary:{total:0,servicebus:0,eventgrid:0,sql:0,other:0};
      const azurePanel=azure?panel('Azure context operacional','<div class="grid3">'+kvItem('Login',azure.authStatus&&azure.authStatus.login_active?'ativo':'ausente')+kvItem('Subscription',azure.profile&&(azure.profile.subscription_name||azure.profile.subscription_id)||'—')+kvItem('Último sync',azure.inventorySyncedAt||'—')+kvItem('Service Bus',String(azureInventory.servicebus||0))+kvItem('Event Grid',String(azureInventory.eventgrid||0))+kvItem('Azure SQL',String(azureInventory.sql||0))+'</div><div class="small muted" style="margin-top:12px">Inventário: total '+esc(azureInventory.total||0)+' · pending operations: '+esc(azure.pendingOperations||0)+' · '+esc(azure.inventoryStale&&azure.inventoryStale.stale?'stale':'fresh')+'</div>'+(azure.lastOperation?'<div class="entry" style="margin-top:12px"><div class="head"><strong>Última operação</strong>'+badge(azure.lastOperation.phase||'pending')+'</div><div class="small">'+esc(azure.lastOperation.summary||azure.lastOperation.operation_id||'—')+'</div><div class="small muted" style="margin-top:8px">'+esc(azure.lastOperation.operation_id||'—')+'</div></div>':'')):'';
      stacks[0].insertAdjacentHTML('afterbegin',panel('Run control','<div class="grid3">'+kvItem('Run ID',activeRun.run_id||'—')+kvItem('Status',activeRun.status||'pending')+kvItem('Cursor',(activeRun.cursor&&((activeRun.cursor.wave!=null?'wave '+activeRun.cursor.wave:'')+(activeRun.cursor.task?' · '+activeRun.cursor.task:'')+(activeRun.cursor.mode?' · '+activeRun.cursor.mode:'')))||'—')+'</div><div class="actions">'+actionButton('Start','start','primary')+actionButton('Pause','pause','warnbtn')+actionButton('Resume','resume','secondary')+actionButton('Replay','replay','danger')+'</div><div class="small muted" style="margin-top:12px">Transitions: '+esc((activeRun.metrics&&activeRun.metrics.transitions)||0)+' · pause_count: '+esc((activeRun.metrics&&activeRun.metrics.pause_count)||0)+' · replay_count: '+esc((activeRun.metrics&&activeRun.metrics.replay_count)||0)+'</div>'));
      stacks[0].insertAdjacentHTML('beforeend',panel('Mapa operacional','<div class="grid3">'+nodes+'</div><h3>Handoffs e dependências</h3>'+edges)+(gatePanel||'')+(multiAgentPanel||'')+(azurePanel||''));
      stacks[1].insertAdjacentHTML('afterbegin',panel('Trace operacional','<div class="small muted" style="margin-bottom:12px">Arquivo: '+esc((ctx.tracing&&ctx.tracing.path)||'—')+' · total: '+esc((ctx.tracing&&ctx.tracing.summary&&ctx.tracing.summary.total)||0)+' evento(s)</div>'+trace));
      stacks[1].insertAdjacentHTML('beforeend',panel('Camadas de memória','<div class="small muted" style="margin-bottom:12px">'+esc(((ctx.memoryLayers&&ctx.memoryLayers.readOrder)||[]).join(' → ')||'—')+'</div><div class="grid2">'+memory+'</div>')+(recoveryPanel||'')+(promotionPanel||''));
    }
  function setTab(next){tab=next;render();}
  async function openSession(path){session=path||null;await refresh();tab='sessions';render();}
  async function changeReview(status){const note=prompt('Justificativa curta para o novo estado do plano:',status==='approved'?'Plano aprovado para execução.':'');if(note==null)return;await api('/api/review/status',{method:'POST',body:JSON.stringify({status,note,author:'user',activeSession:session})});await refresh();}
  async function addComment(){const target=document.getElementById('comment-target').value||'plan';const type=document.getElementById('comment-type').value||'note';const text=document.getElementById('comment-text').value.trim();if(!text)return alert('Escreva um comentário.');await api('/api/review/comment',{method:'POST',body:JSON.stringify({target,type,text,author:'user',activeSession:session})});document.getElementById('comment-text').value='';await refresh();}
    async function resolveComment(id){await api('/api/review/comment-status',{method:'POST',body:JSON.stringify({commentId:id,status:'resolved',activeSession:session})});await refresh();}
    async function runtimeAction(action){if(runtimeDisabled())return;const reason=prompt('Motivo da transição de runtime:',action==='start'?'iniciar execução':'');if(reason==null)return;const wave=prompt('Onda atual (opcional):',ctx.activeRun&&ctx.activeRun.current_wave!=null?String(ctx.activeRun.current_wave):'');if(wave===null)return;const task=prompt('Tarefa atual (opcional):',ctx.activeRun&&ctx.activeRun.cursor&&ctx.activeRun.cursor.task?String(ctx.activeRun.cursor.task):'');if(task===null)return;await api('/api/runtime/action',{method:'POST',body:JSON.stringify({action,reason,activeSession:session,wave:wave?Number(wave):null,task:task||null})});await refresh();}
    async function runtimeGateResolve(gateId,decision){if(runtimeDisabled())return;const needsReason=decision==='reject'||decision==='waive';const reason=needsReason?prompt('Justificativa obrigatória para '+decision+':',''):'';if(needsReason&&(!reason||!reason.trim()))return alert('Justificativa é obrigatória para '+decision+'.');await api('/api/runtime/gates/resolve',{method:'POST',body:JSON.stringify({gateId,decision,actor:'dashboard',reason:reason&&reason.trim()?reason.trim():undefined,activeSession:session})});await refresh();}
    window.setTab=setTab;window.openSession=openSession;window.changeReview=changeReview;window.addComment=addComment;window.resolveComment=resolveComment;window.runtimeAction=runtimeAction;window.runtimeGateResolve=runtimeGateResolve;refresh().catch((err)=>{app.innerHTML='<div class="panel"><h2>Erro</h2><div class="muted">'+esc(err.message)+'</div></div>';});
  </script></body></html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function createDashboardServer(projectRoot, opts = {}) {
  const root = path.resolve(projectRoot);
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && reqUrl.pathname === '/') {
        const html = dashboardHtml();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && reqUrl.pathname === '/api/context') {
        const activeSession = reqUrl.searchParams.get('session') || opts.activeSession || null;
        sendJson(res, 200, { ...loadDashboardContext(root, { activeSession }), dashboard: { readOnly: Boolean(opts.readOnly) } });
        return;
      }

      if (opts.readOnly && req.method === 'POST' && (reqUrl.pathname.startsWith('/api/review/') || reqUrl.pathname.startsWith('/api/runtime/'))) {
        sendJson(res, 403, { error: 'Dashboard em modo read-only.' });
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/review/status') {
        const body = await readJsonBody(req);
        const result = savePlanReviewStatus(root, body || {});
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/review/comment') {
        const body = await readJsonBody(req);
        const result = addPlanReviewComment(root, body || {});
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/review/comment-status') {
        const body = await readJsonBody(req);
        const result = updatePlanReviewCommentStatus(root, body || {});
        if (!result) {
          sendJson(res, 404, { error: 'Comentário não encontrado.' });
          return;
        }
        const stateText = readTextIfExists(health.oxePaths(root).state) || '';
        savePlanReviewStatus(root, {
          activeSession: body.activeSession,
          status: health.parsePlanReviewStatus(stateText) || 'in_review',
          note: 'Estado de comentários de revisão atualizado',
          author: body.author || 'dashboard',
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/runtime/action') {
        const body = await readJsonBody(req);
        const result = operational.applyRuntimeAction(root, body.activeSession || opts.activeSession || null, body || {});
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/runtime/gates/resolve') {
        const body = await readJsonBody(req);
        const result = await operational.resolveRuntimeGate(root, body.activeSession || opts.activeSession || null, body || {});
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'Rota não encontrada.' });
    } catch (err) {
      sendJson(res, 500, { error: err && err.message ? err.message : 'Erro interno.' });
    }
  });
  return server;
}

module.exports = {
  loadDashboardContext,
  savePlanReviewStatus,
  addPlanReviewComment,
  updatePlanReviewCommentStatus,
  createDashboardServer,
  parsePlan,
  parseSpec,
  parseVerify,
  buildCoverageMatrix,
};
