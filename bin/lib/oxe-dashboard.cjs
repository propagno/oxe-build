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
      if (cells.length >= 2 && /^(?:A\d+(?:\.\d+)?|G\d+)$/i.test(cells[0])) criteria.push({ id: cells[0].toUpperCase(), criterion: cells[1] || '', howToVerify: cells[2] || '' });
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
  const normalizedThreshold = health.normalizePlanConfidenceThreshold(threshold);
  if (confidence == null) return 'unknown';
  if (health.isExecutablePlanConfidence(confidence, normalizedThreshold)) return 'ready';
  if (confidence >= Math.max(80, normalizedThreshold - 10)) return 'rational_but_not_ready';
  if (confidence >= 50) return 'needs_refinement';
  return 'do_not_execute';
}

function computeReadiness(ctx, threshold) {
  if (ctx.workspaceMode === 'product_package' && ctx.releaseReadiness) {
    const blockers = Array.isArray(ctx.releaseReadiness.blockers) ? ctx.releaseReadiness.blockers.slice() : [];
    const warnings = Array.isArray(ctx.releaseReadiness.warnings) ? ctx.releaseReadiness.warnings.slice() : [];
    return {
      go: Boolean(ctx.releaseReadiness.ok),
      decision: ctx.releaseReadiness.ok ? 'go' : 'no-go',
      threshold: health.normalizePlanConfidenceThreshold(threshold),
      confidence: ctx.plan && ctx.plan.selfEvaluation ? ctx.plan.selfEvaluation.confidence : null,
      confidenceBand: confidenceBand(ctx.plan && ctx.plan.selfEvaluation ? ctx.plan.selfEvaluation.confidence : null, threshold),
      checkpointPending: false,
      blockers,
      warnings,
    };
  }
  const normalizedThreshold = health.normalizePlanConfidenceThreshold(threshold);
  const blockers = [];
  const warnings = [...ctx.diagnostics.reviewWarnings, ...ctx.diagnostics.runtimeWarnings, ...ctx.diagnostics.planWarnings];
  if (!ctx.plan.selfEvaluation || !ctx.plan.selfEvaluation.hasSection) blockers.push('self_evaluation:missing');
  if (ctx.plan.selfEvaluation && Array.isArray(ctx.plan.selfEvaluation.warnings) && ctx.plan.selfEvaluation.warnings.length) {
    blockers.push(`self_evaluation:warnings:${ctx.plan.selfEvaluation.warnings.length}`);
  }
  if (ctx.planReviewStatus !== 'approved') blockers.push(`review_status:${ctx.planReviewStatus || 'draft'}`);
  if (ctx.plan.selfEvaluation.bestPlan === 'não') blockers.push('best_plan:no');
  if (ctx.plan.selfEvaluation.confidence == null) blockers.push('confidence:missing');
  else if (!health.isExecutablePlanConfidence(ctx.plan.selfEvaluation.confidence, normalizedThreshold)) {
    blockers.push(`confidence:${ctx.plan.selfEvaluation.confidence}%<=${normalizedThreshold}%`);
  }
  if (!ctx.executionRationality || !ctx.executionRationality.implementationPackReady) {
    blockers.push('implementation_pack:not_ready');
  }
  if (!ctx.executionRationality || !ctx.executionRationality.referenceAnchorsReady) {
    blockers.push('reference_anchors:not_ready');
  }
  if (!ctx.executionRationality || !ctx.executionRationality.fixturePackReady) {
    blockers.push('fixture_pack:not_ready');
  }
  if (ctx.checkpoints.parsed.some((x) => /pending_approval/i.test(x.status))) blockers.push('checkpoint:pending_approval');
  if (ctx.runtime.parsed.status === 'blocked') blockers.push('runtime:blocked');
  if (ctx.spec.uncoveredCriteria.length) warnings.push(`${ctx.spec.uncoveredCriteria.length} critérios sem cobertura no plano`);
  if (ctx.executionRationality && Array.isArray(ctx.executionRationality.criticalExecutionGaps)) {
    warnings.push(...ctx.executionRationality.criticalExecutionGaps);
  }
  return {
    go: blockers.length === 0,
    decision: blockers.length === 0 ? 'go' : 'no-go',
    threshold: normalizedThreshold,
    confidence: ctx.plan.selfEvaluation.confidence,
    confidenceBand: confidenceBand(ctx.plan.selfEvaluation.confidence, normalizedThreshold),
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

function computeCalibration(phase, confidence, verify, threshold) {
  const normalizedThreshold = health.normalizePlanConfidenceThreshold(threshold);
  if (confidence == null) return { status: 'pending', summary: 'Calibração indisponível antes do verify.' };
  const low = String(phase || '').toLowerCase();
  const completed = low === 'verify_complete' || verify.passed;
  const failed = low === 'verify_failed' || verify.failed;
  if (!completed && !failed) return { status: 'pending', summary: 'Calibração só fecha após verify.' };
  if (health.isExecutablePlanConfidence(confidence, normalizedThreshold) && failed) {
    return { status: 'overconfident', summary: `Confiança ${confidence}% acima do gate executável, mas o verify falhou.` };
  }
  if (!health.isExecutablePlanConfidence(confidence, normalizedThreshold) && failed) {
    return { status: 'calibrated-risk', summary: `O plano já sinalizava risco (${confidence}%) abaixo do gate executável e o verify confirmou a fragilidade.` };
  }
  if (!health.isExecutablePlanConfidence(confidence, normalizedThreshold) && completed) {
    return { status: 'underconfident', summary: `O resultado final foi melhor que a confiança inicial (${confidence}%), mas o plano ainda não superava o gate executável.` };
  }
  if (health.isExecutablePlanConfidence(confidence, normalizedThreshold) && completed) {
    return { status: 'well-calibrated', summary: `Alta confiança executável (${confidence}%) e verify coerente com a expectativa.` };
  }
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

function collectLiveTelemetry(projectRoot, activeSession) {
  const rootAbs = path.resolve(projectRoot);
  let activeAgents = [];
  let agentMessages = [];
  const agentCollisions = [];
  try {
    const coord = require('./oxe-agent-coord.cjs');
    activeAgents = coord.listActiveAgents(rootAbs, { readOnly: true }) || [];
    agentMessages = coord.readAgentMessages(rootAbs, { limit: 40 }) || [];
    const seenPairs = new Set();
    for (const a of activeAgents) {
      const files = Array.isArray(a.write_set) ? a.write_set : [];
      if (!files.length) continue;
      const col = coord.detectWriteSetCollisions(rootAbs, files, { readOnly: true, excludeAgentId: a.agent_id });
      for (const hit of (col && col.collisions) || []) {
        const pairKey = [hit.file, ...[a.agent_id, hit.agent_id].sort()].join('|');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        agentCollisions.push({
          file: hit.file,
          agents: [a.agent_id, hit.agent_id],
          providers: [a.provider, hit.provider],
          branches: [a.branch || null, hit.branch || null],
          tasks: [a.task || null, hit.task || null],
        });
      }
    }
  } catch { /* auxiliary */ }

  let worktreeHygiene = { ok: true, total: 0, clean: [], dirty: [], orphans: [], warnings: [] };
  try {
    const gc = require('./oxe-worktree-gc.cjs');
    if (typeof gc.summarizeWorktreeHygiene === 'function') {
      const h = gc.summarizeWorktreeHygiene(rootAbs);
      if (h && typeof h === 'object') worktreeHygiene = h;
    }
  } catch { /* non-git or unavailable */ }

  let reevaluate = {
    ok: false,
    overall_status: 'unavailable',
    base: null,
    since: null,
    upstream_commits_count: 0,
    upstream_changed_files: [],
    tasks: [],
    summary: { no_impact: 0, mechanical_sync: 0, contract_drift: 0 },
  };
  try {
    const reev = require('./oxe-reevaluate.cjs').reevaluateAgainstBase(rootAbs);
    if (reev && typeof reev === 'object') reevaluate = reev;
  } catch { /* non-git or no base ref */ }

  let scorecardRouting = { ok: false, tiers: { fast: 0, balanced: 0, powerful: 0 }, auto_route: false, scorecard: null };
  try {
    const cfg = health.loadOxeConfigMerged(rootAbs).config || {};
    const autoRoute = Boolean(cfg.models && cfg.models.auto_route === true);
    const tierCounts = { fast: 0, balanced: 0, powerful: 0 };
    const planJsonPath = path.join(rootAbs, '.oxe', 'PLAN.json');
    if (fs.existsSync(planJsonPath)) {
      const pdoc = JSON.parse(fs.readFileSync(planJsonPath, 'utf8'));
      for (const t of (pdoc && Array.isArray(pdoc.tasks) ? pdoc.tasks : [])) {
        const hint = t.model_hint || t.suggested_model_hint || 'balanced';
        if (Object.prototype.hasOwnProperty.call(tierCounts, hint)) tierCounts[hint] += 1;
      }
    }
    let sc = null;
    try {
      sc = operational.runtimeScorecard(rootAbs, activeSession || null, { withCi: true, withRouting: true });
    } catch { sc = null; }
    scorecardRouting = { ok: true, auto_route: autoRoute, tiers: tierCounts, scorecard: sc };
  } catch { /* auxiliary */ }

  let onboardSummary = null;
  try {
    const pack = require('./oxe-onboard.cjs').buildOnboardingPack(rootAbs, { activeSession: activeSession || null });
    onboardSummary = {
      stacks: (pack.project && pack.project.stacks) || [],
      ci_mode: pack.ci ? pack.ci.mode : 'local-only',
      ci_providers: (pack.ci && pack.ci.providers) || [],
      alm_provider: (pack.alm && pack.alm.provider) || 'none',
      alm_project: (pack.alm && pack.alm.project) || null,
      env_ok: pack.environment ? Boolean(pack.environment.ok) : true,
    };
  } catch { /* auxiliary */ }

  return {
    active_agents: activeAgents,
    agent_messages: agentMessages,
    agent_collisions: agentCollisions,
    worktree_hygiene: worktreeHygiene,
    reevaluate,
    scorecard_routing: scorecardRouting,
    onboard_summary: onboardSummary,
  };
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
    workspaceMode: report.workspaceMode || 'oxe_project',
    releaseReadiness: report.releaseReadiness || null,
    activeSession: activeSession || null,
    phase: report.phase || health.parseStatePhase(stateText),
    healthStatus: report.healthStatus,
    nextStep: report.next,
    planReviewStatus: report.planReviewStatus || 'draft',
    state: { path: globalPaths.state, raw: stateText, parsed: { phase: health.parseStatePhase(stateText), activeSession, runtimeStatus: firstMatch(stateText, /\*\*runtime_status:\*\*\s*([^\n]+)/i) } },
    spec: { path: p.spec, raw: specText, objective: spec.objective, criteria: spec.criteria, uncoveredCriteria: spec.criteria.filter((c) => !plan.tasks.some((t) => (t.aceite || []).includes(c.id))) },
    plan: { path: p.plan, raw: planText, tasks: plan.tasks, waves: plan.waves, totalTasks: plan.totalTasks, selfEvaluation: report.planSelfEvaluation },
    executionRationality: report.executionRationality || null,
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
      implementationPackReady: report.implementationPackReady,
      referenceAnchorsReady: report.referenceAnchorsReady,
      fixturePackReady: report.fixturePackReady,
      executionRationalityReady: report.executionRationalityReady,
      criticalExecutionGaps: report.criticalExecutionGaps || [],
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
  ctx.readiness = computeReadiness(ctx, report.planConfidenceThreshold || 90);
  ctx.coverage = buildCoverageMatrix(ctx.spec, ctx.plan, verify);
  ctx.calibration = computeCalibration(ctx.phase, ctx.plan.selfEvaluation.confidence, verify, ctx.readiness.threshold);
  ctx.visual = {
    flow: { nodes: [{ label: 'STATE', status: 'done' }, { label: 'SPEC', status: ctx.spec.raw ? 'done' : 'pending' }, { label: 'PLAN', status: ctx.plan.raw ? 'done' : 'pending' }, { label: 'REVIEW', status: ctx.planReviewStatus === 'approved' ? 'done' : /(rejected|needs_revision)/i.test(ctx.planReviewStatus) ? 'blocked' : 'active' }, { label: 'EXECUTE', status: ctx.runtime.parsed.status === 'running' ? 'active' : ctx.runtime.raw ? 'done' : 'pending' }, { label: 'CHECKPOINTS', status: ctx.readiness.checkpointPending ? 'active' : ctx.checkpoints.parsed.length ? 'done' : 'pending' }, { label: 'VERIFY', status: ctx.verify.raw ? 'done' : 'pending' }, { label: 'LESSONS', status: 'pending' }] },
    artifactGraph: [
      { id: 'state', label: 'STATE', path: ctx.state.path, detail: ctx.phase || 'índice global', status: 'done' },
      { id: 'spec', label: 'SPEC', path: ctx.spec.path, detail: ctx.spec.objective || 'contrato', status: ctx.spec.raw ? 'done' : 'pending' },
      { id: 'plan', label: 'PLAN', path: ctx.plan.path, detail: `${ctx.plan.totalTasks} tarefas`, status: ctx.plan.raw ? 'done' : 'pending' },
      {
        id: 'implementation-pack',
        label: 'IMPLEMENTATION PACK',
        path: ctx.executionRationality && ctx.executionRationality.implementationPack ? ctx.executionRationality.implementationPack.path : '—',
        detail: ctx.executionRationality && ctx.executionRationality.implementationPack ? `${ctx.executionRationality.implementationPack.taskCount || 0} contratos` : 'sem contrato',
        status: ctx.executionRationality && ctx.executionRationality.implementationPackReady ? 'done' : 'blocked',
      },
      {
        id: 'reference-anchors',
        label: 'REFERENCE ANCHORS',
        path: ctx.executionRationality && ctx.executionRationality.referenceAnchors ? ctx.executionRationality.referenceAnchors.path : '—',
        detail: ctx.executionRationality && ctx.executionRationality.referenceAnchors ? `${ctx.executionRationality.referenceAnchors.anchors ? ctx.executionRationality.referenceAnchors.anchors.length : 0} âncoras` : 'sem âncoras',
        status: ctx.executionRationality && ctx.executionRationality.referenceAnchorsReady ? 'done' : 'blocked',
      },
      {
        id: 'fixture-pack',
        label: 'FIXTURE PACK',
        path: ctx.executionRationality && ctx.executionRationality.fixturePack ? ctx.executionRationality.fixturePack.path : '—',
        detail: ctx.executionRationality && ctx.executionRationality.fixturePack ? `${ctx.executionRationality.fixturePack.fixtureCount || 0} fixtures` : 'sem fixtures',
        status: ctx.executionRationality && ctx.executionRationality.fixturePackReady ? 'done' : 'blocked',
      },
      { id: 'review', label: 'PLAN REVIEW', path: ctx.review.markdownPath, detail: ctx.planReviewStatus, status: ctx.planReviewStatus === 'approved' ? 'done' : 'active' },
      { id: 'runtime', label: 'RUNTIME', path: ctx.runtime.path, detail: ctx.runtime.parsed.status || 'sem status', status: ctx.runtime.raw ? 'active' : 'pending' },
      { id: 'active-run', label: 'ACTIVE RUN', path: operational.operationalPaths(projectRoot, activeSession || null).activeRun, detail: ctx.activeRun && ctx.activeRun.run_id ? `${ctx.activeRun.run_id} · ${ctx.activeRun.status}` : 'sem run ativo', status: ctx.activeRun ? 'active' : 'pending' },
      { id: 'events', label: 'TRACE', path: operational.operationalPaths(projectRoot, activeSession || null).events, detail: `${ctx.tracing.summary.total} evento(s)`, status: ctx.tracing.summary.total ? 'done' : 'pending' },
      { id: 'checkpoints', label: 'CHECKPOINTS', path: ctx.checkpoints.path, detail: `${ctx.checkpoints.parsed.length} gates`, status: ctx.readiness.checkpointPending ? 'active' : 'pending' },
      { id: 'verify', label: 'VERIFY', path: ctx.verify.path, detail: ctx.calibration.status, status: ctx.verify.raw ? 'done' : 'pending' },
    ],
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
  const live = collectLiveTelemetry(projectRoot, activeSession || null);
  ctx.active_agents = live.active_agents;
  ctx.agent_messages = live.agent_messages;
  ctx.agent_collisions = live.agent_collisions;
  ctx.worktree_hygiene = live.worktree_hygiene;
  ctx.reevaluate = live.reevaluate;
  ctx.scorecard_routing = live.scorecard_routing;
  ctx.onboard_summary = live.onboard_summary;
  ctx.dashboard = { readOnly: false, version: 'v2' };
  return ctx;
}

function dashboardHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>OXE Control Room v2</title><style>
  :root{
    --bg:#0b0f19;--bg2:#0e1424;--sidebar:#0f172a;--panel:#131c2e;--card:#172238;--card2:#1c2944;
    --ink:#f8fafc;--ink2:#cbd5e1;--muted:#94a3b8;
    --line:#243350;--line-strong:#3b5280;
    --brand:#1d4ed8;--brand-hi:#2563eb;--brand-light:#60a5fa;--brand-soft:rgba(37,99,235,.16);--brand-glow:rgba(37,99,235,.32);
    --ok:#34d399;--okbg:rgba(16,185,129,.16);
    --warn:#fbbf24;--warnbg:rgba(245,158,11,.16);
    --bad:#fb7185;--badbg:rgba(244,63,94,.16);
    --info:#38bdf8;--infobg:rgba(56,189,248,.16);
    --shadow:0 18px 40px rgba(0,0,0,.38);--radius:14px
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(circle at top right,rgba(37,99,235,.18),transparent 42%),linear-gradient(180deg,var(--bg),var(--bg2));font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);min-height:100vh}
  .shell{display:grid;grid-template-columns:256px minmax(0,1fr);min-height:100vh}
  .nav{background:var(--sidebar);border-right:1px solid var(--line);padding:20px 14px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh;overflow-y:auto}
  .brand-box{padding:14px;border-radius:var(--radius);background:linear-gradient(135deg,rgba(29,78,216,.34),rgba(15,23,42,.9));border:1px solid var(--brand-hi);box-shadow:0 0 24px var(--brand-glow)}
  .brand-title{font-size:18px;font-weight:900;letter-spacing:.02em;color:#fff;display:flex;align-items:center;justify-content:space-between}
  .brand-sub{font-size:12px;color:var(--ink2);margin-top:4px}
  .nav-group{display:grid;gap:6px}
  .nav-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);padding:0 10px;margin-bottom:2px;font-weight:700}
  .nav-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--ink2);font-size:13px;font-weight:700;cursor:pointer;text-align:left;transition:all .15s ease}
  .nav-btn:hover{background:rgba(37,99,235,.12);border-color:var(--line-strong);color:#fff}
  .nav-btn.active{background:linear-gradient(90deg,var(--brand),var(--brand-hi));border-color:var(--brand-light);color:#fff;box-shadow:0 6px 18px var(--brand-glow)}
  .nav-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font-weight:800}
  .main{padding:22px 26px;max-width:1620px;width:100%;margin:0 auto}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px;padding:16px 20px;border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}
  .topbar h1{margin:0;font-size:24px;font-weight:900;color:#fff}
  .topbar-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:18px}
  .layout{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}
  .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
  .stack,.list{display:grid;gap:14px;align-content:start}
  .rail{display:grid;grid-template-columns:repeat(8,minmax(92px,1fr));gap:10px}
  .panel,.metric,.item,.entry,.node{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius)}
  .panel{padding:18px;box-shadow:var(--shadow)}
  .metric{padding:14px;background:linear-gradient(180deg,var(--card),var(--panel))}
  .item,.entry,.node{padding:13px;background:var(--card)}
  .node{text-align:center}
  .view{display:none}.view.active{display:block}
  .label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}
  .value{font-size:22px;font-weight:900;margin-top:6px;color:#fff}
  .muted{color:var(--muted)}.small{font-size:13px;color:var(--ink2)}
  .head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px}
  .head h2{margin:0;font-size:17px;color:#fff}.head h3,h3{margin:12px 0 8px;font-size:14px;color:var(--brand-light)}
  .badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:4px 10px;font-size:11px;text-transform:uppercase;font-weight:800;letter-spacing:.04em}
  .done{background:var(--okbg);color:var(--ok);border:1px solid rgba(52,211,153,.35)}
  .active{background:var(--brand-soft);color:var(--brand-light);border:1px solid rgba(96,165,250,.4)}
  .warning{background:var(--warnbg);color:var(--warn);border:1px solid rgba(251,191,36,.35)}
  .blocked{background:var(--badbg);color:var(--bad);border:1px solid rgba(251,113,133,.38)}
  .pending{background:rgba(148,163,184,.14);color:var(--ink2);border:1px solid var(--line)}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  button{border:1px solid transparent;border-radius:10px;padding:8px 13px;font-weight:700;font-size:12px;cursor:pointer;transition:all .14s ease}
  .primary{background:var(--brand-hi);color:#fff;border-color:var(--brand-light)}.primary:hover{background:var(--brand)}
  .secondary{background:var(--card2);color:var(--ink);border-color:var(--line-strong)}.secondary:hover{border-color:var(--brand-light)}
  .warnbtn{background:var(--warnbg);color:var(--warn);border-color:rgba(251,191,36,.4)}
  .danger{background:var(--badbg);color:var(--bad);border-color:rgba(251,113,133,.4)}
  button:disabled{opacity:.45;cursor:not-allowed}
  input,select,textarea{width:100%;background:#0c1322;color:var(--ink);border:1px solid var(--line-strong);border-radius:10px;padding:10px;font:inherit;font-size:13px}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand-light);box-shadow:0 0 0 3px var(--brand-glow)}
  .form{display:grid;gap:10px;margin-top:10px}
  .raw{white-space:pre-wrap;font-family:Consolas,"Cascadia Code",monospace;font-size:12px;background:#0a0f1c;color:var(--ink2);border:1px solid var(--line);border-radius:10px;padding:12px;max-height:240px;overflow:auto}
  .chip{display:inline-flex;border-radius:999px;padding:3px 9px;background:var(--brand-soft);color:var(--brand-light);border:1px solid rgba(96,165,250,.3);font-size:11px;font-weight:700;margin:4px 6px 0 0}
  .go-card{background:linear-gradient(135deg,rgba(16,185,129,.16),rgba(29,78,216,.22));border:1px solid rgba(52,211,153,.45);border-radius:var(--radius);padding:18px}
  .nogo-card{background:linear-gradient(135deg,rgba(244,63,94,.16),rgba(23,34,56,.95));border:1px solid rgba(251,113,133,.45);border-radius:var(--radius);padding:18px}
  code{background:#0c1322;color:#93c5fd;padding:2px 6px;border-radius:6px;font-family:Consolas,monospace;font-size:12px}
  @media (max-width:1280px){.stats{grid-template-columns:repeat(3,minmax(0,1fr))}.layout{grid-template-columns:1fr}.rail{grid-template-columns:repeat(4,minmax(90px,1fr))}}
  @media (max-width:920px){.shell{grid-template-columns:1fr}.nav{position:static;height:auto}.stats,.grid2,.grid3,.rail{grid-template-columns:1fr}}
  </style></head><body>
  <div class="shell">
    <aside class="nav">
      <div class="brand-box">
        <div class="brand-title"><span>OXE Control Room</span><span class="nav-pill">v2</span></div>
        <div class="brand-sub" id="nav-project">Carregando…</div>
      </div>
      <div class="nav-group">
        <div class="nav-label">Menu Completo</div>
        <button class="nav-btn active" data-tab="overview" onclick="setTab('overview')"><span>Visão Geral & Go/No-Go</span><span class="nav-pill" id="pill-go">—</span></button>
        <button class="nav-btn" data-tab="plan" onclick="setTab('plan')"><span>Plano, Ondas & Cobertura</span><span class="nav-pill" id="pill-plan">0</span></button>
        <button class="nav-btn" data-tab="agents" onclick="setTab('agents')"><span>Agentes, Colisões & Inbox</span><span class="nav-pill" id="pill-agents">0</span></button>
        <button class="nav-btn" data-tab="reevaluate" onclick="setTab('reevaluate')"><span>Reavaliação & Drift</span><span class="nav-pill" id="pill-drift">0</span></button>
        <button class="nav-btn" data-tab="scorecard" onclick="setTab('scorecard')"><span>Scorecard & ROI</span><span class="nav-pill" id="pill-score">—</span></button>
        <button class="nav-btn" data-tab="worktrees" onclick="setTab('worktrees')"><span>Worktrees & Ecossistema</span><span class="nav-pill" id="pill-wt">0</span></button>
        <button class="nav-btn" data-tab="execution" onclick="setTab('execution')"><span>Execução, Gates & Verify</span><span class="nav-pill" id="pill-gates">0</span></button>
        <button class="nav-btn" data-tab="sessions" onclick="setTab('sessions')"><span>Sessões & Contexto</span><span class="nav-pill" id="pill-sess">0</span></button>
      </div>
      <div class="item" style="margin-top:auto">
        <div class="label">Sessão Ativa</div>
        <div class="small" id="nav-session" style="margin-top:4px;font-weight:700;color:#fff">—</div>
        <div class="actions" style="margin-top:10px">
          <button class="primary" onclick="refresh()">Atualizar</button>
          <button class="secondary" id="auto-btn" onclick="toggleAuto()">Auto: ON</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1 id="top-title">OXE Decision Control Room</h1>
          <div class="small" id="top-next" style="margin-top:4px">Sincronizando telemetria ao vivo via <code>/api/state</code>…</div>
        </div>
        <div class="topbar-meta">
          <span class="chip" id="chip-phase">fase: —</span>
          <span class="chip" id="chip-conf">confiança: —</span>
          <span class="chip" id="chip-alm">ALM: —</span>
          <span class="chip" id="chip-ci">CI: —</span>
        </div>
      </div>
      <div id="app">Carregando…</div>
    </main>
  </div>
  <script>
  const app=document.getElementById('app');let ctx=null;let tab='overview';let session=null;let autoOn=true;let timer=null;
  const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cls=(s)=>{const v=String(s||'').toLowerCase();if(/(healthy|approved|done|go|clean|well-calibrated|passed|ready|completed|no_impact|ok)/.test(v))return'done';if(/(running|in_review|active|mentioned|acceptable|controlled|replaying|planned)/.test(v))return'active';if(/(rejected|needs_revision|blocked|failed|no-go|overconfident|do_not_execute|aborted|waiting_approval|contract_drift|replan_recommended|broken)/.test(v))return'blocked';if(/(risk|warning|underconfident|needs_refinement|paused|mechanical_sync|stale)/.test(v))return'warning';return'pending';};
  const badge=(s,l)=>'<span class="badge '+cls(s)+'">'+esc(l||s||'pending')+'</span>';
  const list=(items,empty)=>items&&items.length?'<div class="list">'+items.join('')+'</div>':'<div class="entry small">'+esc(empty)+'</div>';
  const kv=(k,v)=>'<div class="item"><div class="label">'+esc(k)+'</div><div class="small" style="margin-top:6px;font-weight:700;color:#fff">'+esc(v)+'</div></div>';
  const runtimeDisabled=()=>ctx&&ctx.dashboard&&ctx.dashboard.readOnly;
  async function api(url,opts={}){const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});if(!res.ok)throw new Error(await res.text());return res.json();}
  async function refresh(){ctx=await api('/api/state'+(session?'?session='+encodeURIComponent(session):''));render();}
  function updateNav(){
    document.querySelectorAll('.nav-btn').forEach((b)=>b.classList.toggle('active',b.dataset.tab===tab));
    document.getElementById('nav-project').textContent=ctx.projectRoot||'—';
    document.getElementById('nav-session').textContent=ctx.activeSession||'raiz (.oxe/)';
    document.getElementById('top-next').innerHTML='Próximo: <strong>'+esc(ctx.nextStep&&ctx.nextStep.step||'—')+'</strong> · '+esc(ctx.nextStep&&ctx.nextStep.reason||'—');
    document.getElementById('chip-phase').textContent='fase: '+(ctx.phase||'—');
    document.getElementById('chip-conf').textContent='confiança: '+(ctx.readiness&&ctx.readiness.confidence!=null?ctx.readiness.confidence+'%':'—');
    document.getElementById('chip-alm').textContent='ALM: '+((ctx.onboard_summary&&ctx.onboard_summary.alm_provider)||'none');
    document.getElementById('chip-ci').textContent='CI: '+((ctx.onboard_summary&&ctx.onboard_summary.ci_providers&&ctx.onboard_summary.ci_providers.join(','))||'local');
    document.getElementById('pill-go').textContent=ctx.readiness&&ctx.readiness.go?'GO':'HOLD';
    document.getElementById('pill-plan').textContent=String((ctx.plan&&ctx.plan.totalTasks)||0);
    document.getElementById('pill-agents').textContent=String((ctx.active_agents||[]).length);
    document.getElementById('pill-drift').textContent=String((ctx.reevaluate&&ctx.reevaluate.summary&&ctx.reevaluate.summary.contract_drift)||0);
    document.getElementById('pill-score').textContent=ctx.scorecard_routing&&ctx.scorecard_routing.auto_route?'AUTO':'STD';
    document.getElementById('pill-wt').textContent=String((ctx.worktree_hygiene&&ctx.worktree_hygiene.total)||0);
    document.getElementById('pill-gates').textContent=String((ctx.enterprise&&ctx.enterprise.gateQueue&&ctx.enterprise.gateQueue.pending&&ctx.enterprise.gateQueue.pending.length)||0);
    document.getElementById('pill-sess').textContent=String((ctx.sessions&&ctx.sessions.items&&ctx.sessions.items.length)||0);
  }
  function render(){
    updateNav();
    const agentsLive=ctx.active_agents||[];
    const collisions=ctx.agent_collisions||[];
    const messages=ctx.agent_messages||[];
    const wt=ctx.worktree_hygiene||{total:0,clean:[],dirty:[],orphans:[],warnings:[]};
    const reev=ctx.reevaluate||{overall_status:'unavailable',summary:{no_impact:0,mechanical_sync:0,contract_drift:0},tasks:[]};
    const scr=ctx.scorecard_routing||{auto_route:false,tiers:{fast:0,balanced:0,powerful:0},scorecard:null};
    const ob=ctx.onboard_summary||{stacks:[],ci_providers:[],alm_provider:'none',env_ok:true};
    const flow=(ctx.visual.flow.nodes||[]).map((n)=>'<div class="node"><div class="label">Etapa</div><div style="font-weight:800;font-size:14px;margin-top:6px;color:#fff">'+esc(n.label)+'</div><div style="margin-top:8px">'+badge(n.status)+'</div></div>');
    const graph=(ctx.visual.artifactGraph||[]).map((n)=>'<div class="item"><div class="head"><strong>'+esc(n.label)+'</strong>'+badge(n.status)+'</div><div class="small">'+esc(n.detail||'—')+'</div><div class="small muted" style="margin-top:6px">'+esc(n.path||'—')+'</div></div>');
    const waves=(ctx.plan.waves||[]).map((w)=>'<div class="panel"><div class="head"><div><h2>Onda '+esc(w.wave)+'</h2><div class="small muted">'+esc(w.taskIds.length)+' tarefa(s)</div></div>'+badge(String(ctx.runtime.parsed.currentWave)===String(w.wave)?'running':'planned')+'</div>'+w.tasks.map((t)=>'<div class="entry" style="margin-top:10px"><div style="font-weight:800;color:#fff">'+esc(t.id)+' — '+esc(t.title)+'</div><div class="small muted" style="margin-top:4px">Depende de: '+esc(t.dependsOn.length?t.dependsOn.join(', '):'—')+' · Verify: <code>'+esc(t.verifyCommand||'—')+'</code></div><div style="margin-top:6px">'+(t.aceite||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+(t.decisions||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div></div>').join('')+'</div>');
    const coverage=(ctx.coverage||[]).map((c)=>'<div class="item"><div class="head"><strong>'+esc(c.id)+'</strong>'+badge(c.verifyStatus,c.verifyStatus)+'</div><div class="small">'+esc(c.criterion)+'</div><div class="small muted" style="margin-top:6px">Plano: '+esc(c.tasks.length?c.tasks.join(', '):'sem cobertura')+' · Verify: '+esc(c.verifySummary||c.verifyHow||'pendente')+'</div></div>');
    const comments=(ctx.review.comments||[]).map((c)=>'<div class="item"><div class="small muted">'+esc(c.target)+' · '+esc(c.type)+' · '+esc(c.status)+' · '+esc(c.author)+'</div><div style="margin-top:6px">'+esc(c.text)+'</div>'+(c.status!=='resolved'?'<div class="actions"><button class="secondary" onclick="resolveComment(\\''+esc(c.id)+'\\')">Resolver</button></div>':'')+'</div>');
    const blockers=(ctx.readiness.blockers||[]).map((x)=>'<div class="entry small">'+esc(x)+'</div>');
    const warnings=(ctx.readiness.warnings||[]).concat((ctx.diagnostics.enterpriseWarnings||[])).slice(0,12).map((x)=>'<div class="entry small">'+esc(x)+'</div>');
    const activeAgentsCards=agentsLive.map((a)=>'<div class="item"><div class="head"><div><strong>'+esc(a.agent_id)+'</strong><div class="small muted">'+esc(a.provider||'—')+' · '+esc(a.role||'executor')+' · branch: '+esc(a.branch||'—')+'</div></div>'+badge('active',a.task||'ativo')+'</div><div class="small">Worktree: <code>'+esc(a.worktree||'—')+'</code></div><div style="margin-top:6px">'+((a.write_set||[]).length?(a.write_set||[]).map((f)=>'<span class="chip">'+esc(f)+'</span>').join(''):'<span class="small muted">write_set vazio</span>')+'</div><div class="small muted" style="margin-top:6px">Visto: '+esc(a.last_seen||'—')+' · Expira: '+esc(a.expires_at||'—')+'</div></div>');
    const collisionCards=collisions.map((c)=>'<div class="item" style="border-color:rgba(251,113,133,.5)"><div class="head"><strong>'+esc(c.file)+'</strong>'+badge('blocked','colisão')+'</div><div class="small">Agentes: <strong>'+esc((c.agents||[]).join(' × '))+'</strong> ('+esc((c.providers||[]).join(' / '))+')</div><div class="small muted" style="margin-top:4px">Tarefas: '+esc((c.tasks||[]).filter(Boolean).join(', ')||'—')+'</div></div>');
    const inboxCards=messages.slice().reverse().map((m)=>'<div class="entry"><div class="head"><strong>'+esc(m.from)+' → '+esc(m.to)+'</strong>'+badge('active',m.topic||'general')+'</div><div class="small">'+esc(m.body)+'</div><div class="small muted" style="margin-top:4px">'+esc(m.at||'')+'</div></div>');
    const reevTasks=(reev.tasks||[]).map((t)=>'<div class="item"><div class="head"><strong>'+esc(t.id)+' — '+esc(t.title||'')+'</strong>'+badge(t.classification,t.classification)+'</div><div class="small">Ação: <code>'+esc(t.recommended_action||'—')+'</code></div>'+((t.overlapping_files&&t.overlapping_files.length)?'<div style="margin-top:6px">'+t.overlapping_files.map((f)=>'<span class="chip">'+esc(f)+'</span>').join('')+'</div>':'')+'</div>');
    const gateQueue=(ctx.enterprise&&ctx.enterprise.gateQueue)||{pending:[],stalePending:[],resolvedRecent:[],gateSlaHours:24};
    const pendingGates=(gateQueue.pending||[]).map((g)=>'<div class="entry"><div class="head"><strong>'+esc(g.gate_id)+'</strong>'+badge(g.status||'pending')+'</div><div class="small muted">scope='+esc(g.scope||'—')+' · task='+esc(g.work_item_id||'—')+'</div><div class="actions"><button class="primary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(g.gate_id)+'\\',\\'approve\\')">Aprovar</button><button class="warnbtn" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(g.gate_id)+'\\',\\'waive\\')">Dispensar</button><button class="danger" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(g.gate_id)+'\\',\\'reject\\')">Rejeitar</button></div></div>');
    const checkpoints=(ctx.checkpoints.parsed||[]).map((c)=>'<div class="item"><div class="head"><strong>'+esc(c.id)+'</strong>'+badge(c.status)+'</div><div class="small muted">'+esc(c.type)+' · '+esc(c.phase||'—')+' · '+esc(c.scope||'—')+'</div><div class="small" style="margin-top:6px">'+esc(c.notes||'—')+'</div></div>');
    const trace=((ctx.tracing&&ctx.tracing.events)||[]).slice(-10).reverse().map((e)=>'<div class="entry"><div class="head"><strong>'+esc(e.type)+'</strong>'+badge('active',e.timestamp?e.timestamp.slice(11,19):'—')+'</div><div class="small muted">run='+esc(e.run_id||'—')+' · task='+esc(e.work_item_id||e.task_id||'—')+'</div></div>');
    const sessions=(ctx.sessions.items||[]).map((s)=>'<div class="item"><div class="head"><div><strong>'+esc(s.id)+' · '+esc(s.name)+'</strong><div class="small muted">'+esc(s.createdAt)+' · '+esc(s.lastActivity)+'</div></div>'+badge(s.status)+'</div><div class="small">'+esc(s.summary||'—')+'</div><div class="actions"><button class="secondary" onclick="openSession(\\''+esc(s.path)+'\\')">Abrir sessão</button></div></div>');
    const repo=Object.entries(ctx.repositoryContext||{}).map(([k,v])=>'<div class="item"><strong>'+esc(k.toUpperCase())+'</strong><div class="small" style="margin-top:6px">'+esc(v.summary||'Sem resumo.')+'</div></div>');
    const activeRun=ctx.activeRun||{};

    app.innerHTML='<div class="stats">'
      +'<div class="metric"><div class="label">Saúde</div><div class="value">'+badge(ctx.healthStatus)+'</div></div>'
      +'<div class="metric"><div class="label">Go / No-Go</div><div class="value">'+badge(ctx.readiness.decision,ctx.readiness.decision)+'</div></div>'
      +'<div class="metric"><div class="label">Agentes Ativos</div><div class="value">'+esc(agentsLive.length)+'</div></div>'
      +'<div class="metric"><div class="label">Colisões Write-Set</div><div class="value">'+badge(collisions.length?'blocked':'done',String(collisions.length))+'</div></div>'
      +'<div class="metric"><div class="label">Reavaliação Base</div><div class="value">'+badge(reev.overall_status||'pending',reev.overall_status||'n/a')+'</div></div>'
      +'<div class="metric"><div class="label">Worktrees</div><div class="value">'+esc(wt.total||0)+'</div></div>'
    +'</div>'
    +'<div class="view'+(tab==='overview'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Decision Control</h2><div class="small muted">Podemos executar / promover agora?</div></div>'+badge(ctx.planReviewStatus,'review:'+ctx.planReviewStatus)+'</div><div class="'+(ctx.readiness.go?'go-card':'nogo-card')+'"><div class="label">Veredito Operacional</div><div style="font-size:34px;font-weight:900;margin-top:6px">'+(ctx.readiness.go?'GO — PRONTO':'HOLD — ATENÇÃO')+'</div><div class="small" style="margin-top:8px">'+esc(ctx.nextStep&&ctx.nextStep.reason||'—')+'</div></div></div>'
      +'<div class="panel"><div class="head"><div><h2>Decision Rail</h2><div class="small muted">Fluxo completo STATE → SPEC → PLAN → REVIEW → EXECUTE → CHECKPOINTS → VERIFY → LESSONS</div></div></div><div class="rail">'+flow.join('')+'</div></div>'
      +'<div class="panel"><div class="head"><div><h2>Bloqueios & Avisos</h2><div class="small muted">Sinais ativos antes do execute / ship</div></div></div><div class="grid2"><div><h3>Bloqueios</h3>'+list(blockers,'Nenhum bloqueio formal.')+'</div><div><h3>Avisos</h3>'+list(warnings,'Nenhum aviso relevante.')+'</div></div></div>'
      +'<div class="panel"><div class="head"><div><h2>Review & Aprovação do Plano</h2><div class="small muted">Persistido em STATE.md, PLAN-REVIEW.md e comentários</div></div></div><div class="grid2"><div><div class="actions"><button class="primary" onclick="changeReview(\\'approved\\')">Aprovar</button><button class="warnbtn" onclick="changeReview(\\'needs_revision\\')">Pedir revisão</button><button class="secondary" onclick="changeReview(\\'in_review\\')">Em revisão</button><button class="danger" onclick="changeReview(\\'rejected\\')">Rejeitar</button></div><div class="form"><input id="comment-target" placeholder="target ex.: wave:1, T2"/><select id="comment-type"><option value="note">note</option><option value="risk">risk</option><option value="question">question</option><option value="approval">approval</option></select><textarea id="comment-text" rows="4" placeholder="Comentário de revisão"></textarea><button class="primary" onclick="addComment()">Adicionar comentário</button></div></div><div><h3>Comentários</h3>'+list(comments,'Sem comentários.')+'</div></div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Mapa de Artefatos</h2><div class="small muted">Fonte da verdade em .oxe/</div></div></div><div class="grid2">'+graph.join('')+'</div></div>'
      +'<div class="panel"><div class="head"><div><h2>Calibração do Plano</h2><div class="small muted">Confiança prevista vs. resultado</div></div>'+badge(ctx.calibration.status)+'</div><div class="small">'+esc(ctx.calibration.summary)+'</div></div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='plan'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Ondas & Tarefas do Plano</h2><div class="small muted">Dependências, verificação e vínculos</div></div>'+badge(ctx.planReviewStatus)+'</div>'+list(waves,'PLAN.md ausente ou sem tarefas.')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Matriz de Cobertura SPEC → PLAN → VERIFY</h2></div></div><div class="grid2">'+coverage.join('')+'</div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Autoavaliação & Prontidão Racional</h2></div></div><div class="grid3">'+kv('Melhor plano',(ctx.plan.selfEvaluation&&ctx.plan.selfEvaluation.bestPlan)||'—')+kv('Confiança',ctx.readiness.confidence!=null?ctx.readiness.confidence+'%':'—')+kv('Pack Racional',ctx.executionRationality&&ctx.executionRationality.executionRationalityReady?'ready':'pendente')+'</div></div>'
      +'<div class="panel"><div class="head"><div><h2>Lacunas da SPEC</h2></div></div>'+list((ctx.spec.uncoveredCriteria||[]).map((c)=>'<div class="entry small">'+esc(c.id)+' · '+esc(c.criterion)+'</div>'),'100% dos critérios cobertos no plano.')+'</div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='agents'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Agentes Ativos Multi-Worktree</h2><div class="small muted">Ledger compartilhado em &lt;git-common-dir&gt;/oxe/active-agents.json</div></div>'+badge(agentsLive.length?'active':'pending',agentsLive.length+' ativo(s)')+'</div>'+list(activeAgentsCards,'Nenhum lease de agente ativo agora.')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Detector de Colisões de Write-Set</h2><div class="small muted">Sobreposições reais entre worktrees simultâneos</div></div>'+badge(collisions.length?'blocked':'done',collisions.length?collisions.length+' colisão(ões)':'limpo')+'</div>'+list(collisionCards,'Zero colisões de write_set detectadas.')+'</div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Inbox Inter-Worktree</h2><div class="small muted">Mensagens de coordenação entre agentes (oxe-cc agents send/inbox)</div></div>'+badge('active',messages.length+' msg(s)')+'</div>'+list(inboxCards,'Nenhuma mensagem registrada no inbox.')+'</div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='reevaluate'?' active':'')+'"><div class="panel"><div class="head"><div><h2>Reavaliação Contínua Contra Base</h2><div class="small muted">Base: '+esc(reev.base||'—')+' · Commits upstream: '+esc(reev.upstream_commits_count||0)+'</div></div>'+badge(reev.overall_status||'pending',reev.overall_status||'unavailable')+'</div><div class="grid3" style="margin-bottom:14px">'+kv('Sem Impacto (no_impact)',String((reev.summary&&reev.summary.no_impact)||0))+kv('Sync Mecânico (mechanical_sync)',String((reev.summary&&reev.summary.mechanical_sync)||0))+kv('Drift de Contrato (contract_drift)',String((reev.summary&&reev.summary.contract_drift)||0))+'</div>'+list(reevTasks,'Nenhuma tarefa pendente com drift contra a base.')+'</div></div>'
    +'<div class="view'+(tab==='scorecard'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Scorecard & Roteamento Empírico (ROI)</h2><div class="small muted">models.auto_route + distribuição por tier + telemetria local</div></div>'+badge(scr.auto_route?'done':'active',scr.auto_route?'auto_route ON':'auto_route OFF')+'</div><div class="grid3">'+kv('Tier Fast',String((scr.tiers&&scr.tiers.fast)||0))+kv('Tier Balanced',String((scr.tiers&&scr.tiers.balanced)||0))+kv('Tier Powerful',String((scr.tiers&&scr.tiers.powerful)||0))+'</div><div class="raw" style="margin-top:12px">'+esc(JSON.stringify(scr.scorecard||{note:'Sem telemetria de scorecard acumulada ainda.'},null,2))+'</div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Enterprise Verify & Governança</h2></div></div><div class="grid2">'+kv('Checks',(ctx.enterprise&&ctx.enterprise.verificationSummary&&ctx.enterprise.verificationSummary.total)||0)+kv('Coverage',(ctx.enterprise&&ctx.enterprise.evidenceCoverage&&String(ctx.enterprise.evidenceCoverage.coverage_percent)+'%')||'—')+kv('Riscos Residuais',(ctx.enterprise&&ctx.enterprise.residualRiskSummary&&ctx.enterprise.residualRiskSummary.total)||0)+kv('Promoção',(ctx.enterprise&&ctx.enterprise.promotionSummary&&ctx.enterprise.promotionSummary.status)||'—')+'</div></div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='worktrees'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Higiene de Worktrees</h2><div class="small muted">oxe-cc gc-worktrees · proteção automática de junctions ativas</div></div>'+badge(wt.ok?'done':'warning',wt.ok?'saudável':'atenção')+'</div><div class="grid3">'+kv('Total',String(wt.total||0))+kv('Sujas',String((wt.dirty||[]).length))+kv('Órfãs / Pendentes',String((wt.orphans||[]).length))+'</div>'+list((wt.warnings||[]).map((w)=>'<div class="entry small">'+esc(w)+'</div>'),'Sem pendências de higiene de worktrees.')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Ecossistema: Onboarding, CI, ALM & MCP</h2><div class="small muted">Core 100% agnóstico (D-5) · servidor nativo oxe-cc mcp</div></div></div><div class="grid2">'+kv('Stacks',(ob.stacks||[]).join(', ')||'—')+kv('CI Providers',(ob.ci_providers||[]).join(', ')||'local-only')+kv('ALM Provider',ob.alm_provider||'none')+kv('MCP Server','oxe-cc mcp (JSON-RPC 2.0 stdio)')+'</div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Repository Context</h2></div></div><div class="grid2">'+repo.join('')+'</div></div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='execution'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Run Control</h2><div class="small muted">Controle operacional do runtime</div></div>'+badge(activeRun.status||'pending')+'</div><div class="grid3">'+kv('Run ID',activeRun.run_id||'—')+kv('Status',activeRun.status||'pending')+kv('Onda Atual',ctx.runtime.parsed.currentWave||'—')+'</div><div class="actions"><button class="primary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'start\\')">Start</button><button class="warnbtn" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'pause\\')">Pause</button><button class="secondary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'resume\\')">Resume</button><button class="danger" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'replay\\')">Replay</button></div></div>'
      +'<div class="panel"><div class="head"><div><h2>Gates Pendentes & Checkpoints</h2></div></div>'+list(pendingGates,'Sem gates pendentes.')+'<h3>Checkpoints</h3>'+list(checkpoints,'Sem checkpoints registrados.')+'</div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Trace Operacional</h2><div class="small muted">Últimos eventos em OXE-EVENTS.ndjson</div></div></div>'+list(trace,'Sem eventos registrados.')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Verify & Evidências</h2></div></div><div class="raw">'+esc(ctx.verify.summary||'VERIFY.md ausente.')+'</div></div>'
    +'</div></div></div>'
    +'<div class="view'+(tab==='sessions'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Sessão Ativa</h2></div></div><div class="grid2">'+kv('ID',(ctx.sessions.current&&ctx.sessions.current.id)||'—')+kv('Nome',(ctx.sessions.current&&ctx.sessions.current.name)||ctx.activeSession||'—')+kv('Status',(ctx.sessions.current&&ctx.sessions.current.status)||'—')+kv('Última Atividade',(ctx.sessions.current&&ctx.sessions.current.lastActivity)||'—')+'</div></div>'
      +'<div class="panel"><div class="head"><div><h2>Semântica Multi-Runtime & Context Packs</h2></div></div><div class="grid2">'+kv('Semântica',ctx.context&&ctx.context.semantics&&ctx.context.semantics.ok?'alinhada':'drift')+kv('Workflow Primário',(ctx.context&&ctx.context.quality&&ctx.context.quality.primaryWorkflow)||'dashboard')+'</div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Sessões Registradas</h2></div></div>'+list(sessions,'SESSIONS.md ausente ou vazio.')+'</div>'
    +'</div></div></div>';
  }
  function setTab(next){tab=next;if(ctx)render();}
  function toggleAuto(){autoOn=!autoOn;document.getElementById('auto-btn').textContent='Auto: '+(autoOn?'ON':'OFF');if(timer){clearInterval(timer);timer=null;}if(autoOn)timer=setInterval(()=>{refresh().catch(()=>{});},10000);}
  async function openSession(p){session=p||null;await refresh();tab='sessions';render();}
  async function changeReview(status){const note=prompt('Justificativa curta para o novo estado do plano:',status==='approved'?'Plano aprovado para execução.':'');if(note==null)return;await api('/api/review/status',{method:'POST',body:JSON.stringify({status,note,author:'user',activeSession:session})});await refresh();}
  async function addComment(){const target=document.getElementById('comment-target').value||'plan';const type=document.getElementById('comment-type').value||'note';const text=document.getElementById('comment-text').value.trim();if(!text)return alert('Escreva um comentário.');await api('/api/review/comment',{method:'POST',body:JSON.stringify({target,type,text,author:'user',activeSession:session})});document.getElementById('comment-text').value='';await refresh();}
  async function resolveComment(id){await api('/api/review/comment-status',{method:'POST',body:JSON.stringify({commentId:id,status:'resolved',activeSession:session})});await refresh();}
  async function runtimeAction(action){if(runtimeDisabled())return;const reason=prompt('Motivo da transição:',action==='start'?'iniciar execução':'');if(reason==null)return;await api('/api/runtime/action',{method:'POST',body:JSON.stringify({action,reason,activeSession:session})});await refresh();}
  async function runtimeGateResolve(gateId,decision){if(runtimeDisabled())return;const needsReason=decision==='reject'||decision==='waive';const reason=needsReason?prompt('Justificativa obrigatória para '+decision+':',''):'';if(needsReason&&(!reason||!reason.trim()))return alert('Justificativa obrigatória.');await api('/api/runtime/gates/resolve',{method:'POST',body:JSON.stringify({gateId,decision,actor:'dashboard',reason:reason&&reason.trim()?reason.trim():undefined,activeSession:session})});await refresh();}
  window.setTab=setTab;window.toggleAuto=toggleAuto;window.refresh=refresh;window.openSession=openSession;window.changeReview=changeReview;window.addComment=addComment;window.resolveComment=resolveComment;window.runtimeAction=runtimeAction;window.runtimeGateResolve=runtimeGateResolve;
  refresh().then(()=>{if(autoOn)timer=setInterval(()=>{refresh().catch(()=>{});},10000);}).catch((err)=>{app.innerHTML='<div class="panel"><h2>Erro</h2><div class="small">'+esc(err.message)+'</div></div>';});
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

      if (req.method === 'GET' && (reqUrl.pathname === '/api/context' || reqUrl.pathname === '/api/state')) {
        const activeSession = reqUrl.searchParams.get('session') || opts.activeSession || null;
        sendJson(res, 200, {
          oxeDashboardStateSchema: 2,
          generated_at: new Date().toISOString(),
          ...loadDashboardContext(root, { activeSession }),
          dashboard: { readOnly: Boolean(opts.readOnly), version: 'v2' },
        });
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
