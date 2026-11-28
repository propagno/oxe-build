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
  const normalized = String(specMd || '').replace(/\r\n/g, '\n');
  const objective = (((normalized.match(/(?:^|\n)##\s*Objetivo\s*\n+([\s\S]*?)(?=\n##\s|\n#[^#]|$)/i) || [null, ''])[1]) || '').trim().split('\n')[0].trim() || null;
  const criteria = [];
  const seen = new Set();
  const m = normalized.match(/(?:^|\n)##\s*Crit[eé]rios[^\n]*aceite[^\n]*\n+([\s\S]*?)(?=\n##\s|\n#[^#]|$)/i);
  if (m) {
    const tables = parseMarkdownTables(m[1]);
    if (tables.length) {
      for (const row of tables[0].rows) {
        const idRaw = row.ID || row.Id || row['Critério'] || '';
        const idMatch = String(idRaw).match(/^(A\d+(?:\.\d+)?|G\d+)$/i);
        if (!idMatch) continue;
        const id = idMatch[1].toUpperCase();
        if (seen.has(id)) continue;
        seen.add(id);
        criteria.push({
          id,
          criterion: row['Critério'] || row.Criterio || row.Criterion || row['Descrição'] || '',
          risk: row.Risco || row.Risk || '',
          howToVerify: row['Como verificar'] || row['Verificação'] || row.Verify || row.Verificacao || '',
        });
      }
    }
    if (!criteria.length) {
      for (const row of m[1].split('\n').filter((l) => l.startsWith('|'))) {
        const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2 && /^(?:A\d+(?:\.\d+)?|G\d+)$/i.test(cells[0])) {
          const id = cells[0].toUpperCase();
          if (seen.has(id)) continue;
          seen.add(id);
          criteria.push({ id, criterion: cells[1] || '', risk: cells.length >= 4 ? cells[2] : '', howToVerify: cells[cells.length - 1] || '' });
        }
      }
    }
  }
  if (!criteria.length) {
    for (const line of normalized.split('\n')) {
      const bm = line.match(/^\s*-\s+\*\*(A\d+(?:\.\d+)?)\b[^*]*\*\*\s*[:—-]?\s*(.+)$/);
      if (!bm) continue;
      const id = bm[1].toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      criteria.push({ id, criterion: bm[2].trim(), risk: '', howToVerify: '' });
    }
  }
  return { objective, criteria };
}

function sanitizeTemplateValue(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/`/g, '').trim();
  if (!cleaned || cleaned === '—' || /\|\s*[a-z_]+\s*\|/i.test(cleaned)) return null;
  return cleaned;
}

function parseRuntime(runtimeMd) {
  const agentTable = findTableByHeaders(runtimeMd, ['ID', 'Papel', 'Tarefas', 'Estado']);
  const checkpointTable = findTableByHeaders(runtimeMd, ['ID', 'Tipo', 'Escopo', 'Estado']);
  const waveRaw = sanitizeTemplateValue(firstMatch(runtimeMd, /\*\*Onda:\*\*\s*([^\n]+)/i));
  const waveNum = waveRaw && /^\d+$/.test(waveRaw) ? Number(waveRaw) : null;
  return {
    currentWave: waveNum != null ? waveNum : waveRaw,
    status: sanitizeTemplateValue(firstMatch(runtimeMd, /\*\*Estado:\*\*\s*([^\n]+)/i)),
    activeTasks: ((sanitizeTemplateValue(firstMatch(runtimeMd, /\*\*Tarefas ativas:\*\*\s*([^\n]+)/i)) || '').split(',').map((x) => x.trim()).filter(Boolean)),
    nextAction: sanitizeTemplateValue(firstMatch(runtimeMd, /\*\*Ação:\*\*\s*([^\n]+)/i)),
    nextReason: sanitizeTemplateValue(firstMatch(runtimeMd, /\*\*Motivo:\*\*\s*([^\n]+)/i)),
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
  const byId = new Map();
  const rank = { mentioned: 1, passed: 2, failed: 3 };
  const record = (id, status, summary) => {
    const prev = byId.get(id);
    if (!prev || (rank[status] || 0) >= (rank[prev.status] || 0)) {
      byId.set(id, { id, status, summary: summary || (prev ? prev.summary : '') });
    }
  };
  for (const table of parseMarkdownTables(md)) {
    for (const row of table.rows) {
      const idCandidate = row.Aceite || row.ID || row.Id || row['Critério'] || row['Criterio'] || '';
      const matches = String(idCandidate).match(/\bA\d+(?:\.\d+)?\b/gi) || [];
      if (!matches.length) continue;
      const st = normalizeEvidenceStatus(row.Status || row.Resultado || row.Result || row.Veredito || row['Passou?'] || '');
      const sum = row.Evidência || row.Evidencia || row['Evidências'] || row.Check || row.Resumo || row.Notas || '';
      for (const m of matches) record(m.toUpperCase(), st, sum);
    }
  }
  const checksTotal = Number(firstMatch(md, /\*\*Checks:\*\*\s*(\d+)/i)) || null;
  const checksPass = Number(firstMatch(md, /\*\*Pass:\*\*\s*(\d+)/i));
  const checksFail = Number(firstMatch(md, /\*\*Fail:\*\*\s*(\d+)/i));
  const coveragePct = Number(firstMatch(md, /\*\*Cobertura:\*\*\s*(\d+)%/i));
  return {
    criteria: Array.from(byId.values()),
    mentionedCriteria: Array.from(new Set((md.match(/\bA\d+\b/g) || []).map((x) => x.toUpperCase()))),
    failed: /\b(verify_failed|falhou|falha|reprovad)\b/i.test(md) || (Number.isFinite(checksFail) && checksFail > 0),
    passed: /\b(verify_complete|aprovad|passou|sucesso)\b/i.test(md) || /\*\*All passed:\*\*\s*sim/i.test(md),
    manifest: checksTotal != null ? {
      total: checksTotal,
      pass: Number.isFinite(checksPass) ? checksPass : 0,
      fail: Number.isFinite(checksFail) ? checksFail : 0,
      coveragePercent: Number.isFinite(coveragePct) ? coveragePct : null,
    } : null,
  };
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

function buildCoverageMatrix(spec, plan, verify, program = null) {
  const taskMap = new Map();
  for (const task of plan.tasks) {
    for (const criterion of task.aceite || []) {
      if (!taskMap.has(criterion)) taskMap.set(criterion, []);
      taskMap.get(criterion).push(task.id);
    }
  }
  const phaseByCriterion = new Map();
  if (program && Array.isArray(program.phases)) {
    for (const ph of program.phases) {
      for (const a of (ph.acceptance || [])) {
        phaseByCriterion.set(String(a).toUpperCase(), ph);
      }
    }
  }
  const verifyMap = new Map((verify.criteria || []).map((x) => [x.id, x]));
  return spec.criteria.map((c) => {
    const ph = phaseByCriterion.get(c.id) || null;
    const tasks = taskMap.get(c.id) || [];
    const closedPhase = ph && String(ph.status || '').toLowerCase() === 'closed';
    const rawVerify = verifyMap.has(c.id)
      ? verifyMap.get(c.id).status
      : (verify.mentionedCriteria || []).includes(c.id)
        ? 'mentioned'
        : closedPhase
          ? 'passed'
          : 'missing';
    return {
      id: c.id,
      criterion: c.criterion,
      risk: c.risk || '',
      verifyHow: c.howToVerify,
      phase: ph ? ph.id : null,
      phaseStatus: ph ? ph.status : null,
      tasks,
      planCovered: tasks.length > 0 || Boolean(ph),
      verifyStatus: rawVerify,
      verifySummary: verifyMap.has(c.id)
        ? verifyMap.get(c.id).summary
        : closedPhase
          ? `Fase ${ph.id} fechada e validada`
          : '',
    };
  });
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

function resolveFirstExisting(candidates) {
  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) return cand;
  }
  return candidates.find(Boolean) || null;
}

function readProgramState(projectRoot, activeSession) {
  const candidates = [];
  if (activeSession) {
    candidates.push(path.join(projectRoot, '.oxe', activeSession, 'program', 'PROGRAM.json'));
    candidates.push(path.join(projectRoot, '.oxe', activeSession, 'PROGRAM.json'));
  }
  candidates.push(path.join(projectRoot, '.oxe', 'program', 'PROGRAM.json'));
  const filePath = candidates.find((c) => fs.existsSync(c));
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const phases = Array.isArray(raw && raw.phases) ? raw.phases : [];
    const totalCount = phases.length;
    const closedCount = phases.filter((ph) => String(ph.status || '').toLowerCase() === 'closed').length;
    const activeCount = phases.filter((ph) => String(ph.status || '').toLowerCase() === 'active').length;
    const pendingCount = Math.max(0, totalCount - closedCount - activeCount);
    return {
      path: filePath,
      active_phase: raw.active_phase || null,
      phases,
      totalCount,
      closedCount,
      activeCount,
      pendingCount,
      allClosed: totalCount > 0 && closedCount === totalCount,
      pct: totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0,
    };
  } catch {
    return null;
  }
}

function buildHumanGuidance(ctx) {
  const collisions = ctx.agent_collisions || [];
  const pendingGates = (ctx.enterprise && ctx.enterprise.gateQueue && ctx.enterprise.gateQueue.pending) || [];
  const driftCount = (ctx.reevaluate && ctx.reevaluate.summary && ctx.reevaluate.summary.contract_drift) || 0;
  const syncCount = (ctx.reevaluate && ctx.reevaluate.summary && ctx.reevaluate.summary.mechanical_sync) || 0;
  const program = ctx.program || null;
  const wt = ctx.worktree_hygiene || {};
  const wtDirty = typeof wt.dirty === 'number' ? wt.dirty : Array.isArray(wt.dirty) ? wt.dirty.length : 0;
  const verifyManifest = (ctx.verify && ctx.verify.parsed && ctx.verify.parsed.manifest) || null;
  const criteriaTotal = (ctx.coverage || []).length;
  const criteriaPassed = (ctx.coverage || []).filter((c) => c.verifyStatus === 'passed').length;

  const checklist = [];
  if (program && program.totalCount > 0) {
    checklist.push({
      status: program.allClosed ? 'done' : 'active',
      text: `${program.closedCount}/${program.totalCount} fases do programa concluídas (${program.pct}%)`,
    });
  } else if (ctx.plan && ctx.plan.totalTasks > 0) {
    checklist.push({ status: 'active', text: `${ctx.plan.totalTasks} tarefa(s) planejadas em ${(ctx.plan.waves || []).length} onda(s)` });
  }
  if (criteriaTotal > 0) {
    checklist.push({
      status: criteriaPassed === criteriaTotal ? 'done' : 'active',
      text: `${criteriaPassed}/${criteriaTotal} critérios de aceite (A*) validados`,
    });
  }
  if (verifyManifest && verifyManifest.total > 0) {
    checklist.push({
      status: verifyManifest.fail === 0 ? 'done' : 'blocked',
      text: `${verifyManifest.pass}/${verifyManifest.total} checks de verificação aprovados${verifyManifest.coveragePercent != null ? ` (${verifyManifest.coveragePercent}% evidência)` : ''}`,
    });
  }
  checklist.push({
    status: collisions.length ? 'blocked' : 'done',
    text: collisions.length ? `${collisions.length} colisão(ões) de arquivos entre agentes` : 'Sem colisões entre agentes ativos',
  });
  if (wtDirty > 0 || wt.needs_gc) {
    checklist.push({
      status: 'warning',
      text: `${wt.total || 0} worktree(s) no repositório (${wtDirty} com alterações locais) — opcional revisar limpeza`,
    });
  }

  let tone = 'active';
  let badgeLabel = 'Em andamento';
  let headline = 'Acompanhe o próximo passo da trilha';
  let explanation = (ctx.nextStep && ctx.nextStep.reason) || 'Verifique o progresso nas fases e avance pelo CLI.';
  let command = (ctx.nextStep && ctx.nextStep.cursorCmd) || 'oxe-cc status';
  let ctaLabel = 'Ver Fases & Tarefas';
  let ctaTab = 'plan';

  if (collisions.length > 0) {
    tone = 'blocked';
    badgeLabel = 'Colisão detectada';
    headline = `Atenção: ${collisions.length} arquivo(s) editado(s) por dois agentes ao mesmo tempo`;
    explanation = 'Coordene os agentes antes de continuar para evitar sobrescrita de trabalho entre worktrees.';
    command = 'oxe-cc agents collisions';
    ctaLabel = 'Abrir Agentes & Colisões';
    ctaTab = 'agents';
  } else if (pendingGates.length > 0) {
    tone = 'warning';
    badgeLabel = 'Ação humana pendente';
    headline = `Há ${pendingGates.length} gate(s) aguardando sua aprovação`;
    explanation = 'O runtime pausou uma ação sensível. Aprove, dispense ou rejeite na aba de Execução.';
    command = 'oxe-cc runtime gates';
    ctaLabel = 'Resolver Gates Agora';
    ctaTab = 'execution';
  } else if (driftCount > 0) {
    tone = 'warning';
    badgeLabel = 'Drift na base';
    headline = `${driftCount} tarefa(s) pendente(s) sofreram drift contra a branch base`;
    explanation = 'Novos commits entraram na base e tocam arquivos planejados. Reavalie o impacto antes de executar ou promover.';
    command = 'oxe-cc reevaluate';
    ctaLabel = 'Ver Drift na Base';
    ctaTab = 'reevaluate';
  } else if (program && program.allClosed && (ctx.phase === 'verify_complete' || (ctx.verify && ctx.verify.parsed && ctx.verify.parsed.passed))) {
    tone = 'done';
    badgeLabel = 'Entrega concluída';
    headline = `Todas as ${program.totalCount} fases foram fechadas e verificadas`;
    explanation = 'Nenhuma pendência de implementação nesta sessão. Confira o resumo das fases ou rode os gates de envio/release quando estiver pronto.';
    command = 'oxe-cc ship status';
    ctaLabel = 'Revisar Fases Entregues';
    ctaTab = 'plan';
  } else if (program && program.active_phase) {
    const activePh = program.phases.find((ph) => ph.id === program.active_phase);
    tone = 'active';
    badgeLabel = `Fase ${program.active_phase} ativa`;
    headline = activePh ? `Em execução: ${activePh.id} — ${activePh.title}` : `Executando fase ${program.active_phase}`;
    explanation = 'Implemente as tarefas pendentes da fase atual e rode a verificação antes de fechar a fase.';
    command = 'oxe-cc runtime verify';
    ctaLabel = 'Abrir Fases & Tarefas';
    ctaTab = 'plan';
  } else if (ctx.phase === 'plan_ready' && ctx.planReviewStatus !== 'approved' && !ctx.isLean) {
    tone = 'active';
    badgeLabel = 'Aguardando aprovação';
    headline = 'Revise e aprove o plano antes de executar';
    explanation = 'Confira as tarefas e critérios de aceite abaixo e clique em Aprovar plano para liberar a execução.';
    command = 'oxe-cc plan lint';
    ctaLabel = 'Revisar Plano';
    ctaTab = 'plan';
  } else if (syncCount > 0) {
    tone = 'warning';
    badgeLabel = 'Sync recomendado';
    headline = `${syncCount} tarefa(s) precisa(m) de sincronização mecânica com a base`;
    explanation = 'Não há quebra de contrato, mas vale sincronizar recursos sequenciais antes do promote.';
    command = 'oxe-cc sync --dry-run';
    ctaLabel = 'Ver Drift na Base';
    ctaTab = 'reevaluate';
  } else if (!ctx.readiness.go && (ctx.readiness.blockers || []).length > 0) {
    tone = 'blocked';
    badgeLabel = 'Bloqueado';
    headline = 'Existem bloqueios impedindo o avanço';
    explanation = `Resolva os bloqueios apontados (${ctx.readiness.blockers.slice(0, 3).join(', ')}) antes de executar ou publicar.`;
    command = 'oxe-cc doctor --project';
    ctaLabel = 'Ver Diagnóstico';
    ctaTab = 'execution';
  }

  return { tone, badgeLabel, headline, explanation, command, ctaLabel, ctaTab, checklist };
}

function loadDashboardContext(projectRoot, opts = {}) {
  const globalPaths = health.oxePaths(projectRoot);
  const stateText = readTextIfExists(globalPaths.state) || '';
  const activeSession = opts.activeSession === undefined ? health.parseActiveSession(stateText) : opts.activeSession;
  const p = reviewPaths(projectRoot, activeSession || null);
  const rootScoped = reviewPaths(projectRoot, null);
  const report = health.buildHealthReport(projectRoot);
  const cfgMerged = health.loadOxeConfigMerged(projectRoot).config || {};
  const isLean = cfgMerged.profile === 'lean' || cfgMerged.plan_ceremony === 'lean';
  const resolvedSpecPath = resolveFirstExisting([
    activeSession ? path.join(projectRoot, '.oxe', activeSession, 'SPEC.md') : null,
    p.spec,
    rootScoped.spec,
  ]);
  const specText = resolvedSpecPath ? readTextIfExists(resolvedSpecPath) || '' : '';
  const planText = readScopedText(p.plan, rootScoped.plan);
  const verifyText = readScopedText(p.verify, rootScoped.verify);
  const runtimeText = readScopedText(p.runtime, rootScoped.runtime);
  const checkpointsText = readScopedText(p.checkpoints, rootScoped.checkpoints);
  const program = readProgramState(projectRoot, activeSession || null);
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
  const phaseCriteriaSet = new Set();
  if (program && Array.isArray(program.phases)) {
    for (const ph of program.phases) for (const a of (ph.acceptance || [])) phaseCriteriaSet.add(String(a).toUpperCase());
  }
  const ctx = {
    projectRoot: path.resolve(projectRoot),
    projectName: path.basename(path.resolve(projectRoot)),
    workspaceMode: report.workspaceMode || 'oxe_project',
    isLean,
    program,
    releaseReadiness: report.releaseReadiness || null,
    activeSession: activeSession || null,
    phase: report.phase || health.parseStatePhase(stateText),
    healthStatus: report.healthStatus,
    nextStep: report.next,
    planReviewStatus: report.planReviewStatus || 'draft',
    state: { path: globalPaths.state, raw: stateText, parsed: { phase: health.parseStatePhase(stateText), activeSession, runtimeStatus: sanitizeTemplateValue(firstMatch(stateText, /\*\*runtime_status:\*\*\s*([^\n]+)/i)) } },
    spec: { path: resolvedSpecPath || p.spec, raw: specText, objective: spec.objective, criteria: spec.criteria, uncoveredCriteria: spec.criteria.filter((c) => !plan.tasks.some((t) => (t.aceite || []).includes(c.id)) && !phaseCriteriaSet.has(c.id)) },
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
  ctx.coverage = buildCoverageMatrix(ctx.spec, ctx.plan, verify, program);
  ctx.calibration = computeCalibration(ctx.phase, ctx.plan.selfEvaluation.confidence, verify, ctx.readiness.threshold);
  const runtimeEffectiveStatus = ctx.runtime.parsed.status || (ctx.activeRun && ctx.activeRun.status) || null;
  const verifyDetail = verify.manifest
    ? `${verify.manifest.pass}/${verify.manifest.total} checks aprovados`
    : ctx.calibration.status;
  ctx.visual = {
    flow: { nodes: [{ label: 'STATE', status: 'done' }, { label: 'SPEC', status: ctx.spec.raw ? 'done' : 'pending' }, { label: 'PLAN', status: ctx.plan.raw ? 'done' : 'pending' }, { label: 'REVIEW', status: (ctx.planReviewStatus === 'approved' || (isLean && program && program.allClosed)) ? 'done' : /(rejected|needs_revision)/i.test(ctx.planReviewStatus) ? 'blocked' : 'active' }, { label: 'EXECUTE', status: runtimeEffectiveStatus === 'running' ? 'active' : (ctx.runtime.raw || ctx.activeRun) ? 'done' : 'pending' }, { label: 'CHECKPOINTS', status: ctx.readiness.checkpointPending ? 'active' : ctx.checkpoints.parsed.length ? 'done' : 'pending' }, { label: 'VERIFY', status: ctx.verify.raw ? 'done' : 'pending' }, { label: 'LESSONS', status: 'pending' }] },
    artifactGraph: [
      { id: 'state', label: 'STATE', path: ctx.state.path, detail: ctx.phase || 'índice global', status: 'done' },
      { id: 'spec', label: 'SPEC', path: ctx.spec.path, detail: ctx.spec.objective || 'contrato', status: ctx.spec.raw ? 'done' : 'pending' },
      { id: 'plan', label: 'PLAN', path: ctx.plan.path, detail: `${ctx.plan.totalTasks} tarefas`, status: ctx.plan.raw ? 'done' : 'pending' },
      {
        id: 'implementation-pack',
        label: 'IMPLEMENTATION PACK',
        path: ctx.executionRationality && ctx.executionRationality.implementationPack ? ctx.executionRationality.implementationPack.path : '—',
        detail: ctx.executionRationality && ctx.executionRationality.implementationPack ? `${ctx.executionRationality.implementationPack.taskCount || 0} contratos` : 'sem contrato',
        status: ctx.executionRationality && ctx.executionRationality.implementationPackReady ? 'done' : (isLean && program && program.allClosed) ? 'done' : 'blocked',
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
      { id: 'review', label: 'PLAN REVIEW', path: ctx.review.markdownPath, detail: isLean && ctx.planReviewStatus === 'draft' ? 'lean (testes congelados)' : ctx.planReviewStatus, status: (ctx.planReviewStatus === 'approved' || isLean) ? 'done' : 'active' },
      { id: 'runtime', label: 'RUNTIME', path: ctx.runtime.path, detail: runtimeEffectiveStatus || 'sem status', status: runtimeEffectiveStatus === 'completed' ? 'done' : (ctx.runtime.raw || ctx.activeRun) ? 'active' : 'pending' },
      { id: 'active-run', label: 'ACTIVE RUN', path: operational.operationalPaths(projectRoot, activeSession || null).activeRun, detail: ctx.activeRun && ctx.activeRun.run_id ? `${ctx.activeRun.run_id} · ${ctx.activeRun.status}` : 'sem run ativo', status: ctx.activeRun && ctx.activeRun.status === 'completed' ? 'done' : ctx.activeRun ? 'active' : 'pending' },
      { id: 'events', label: 'TRACE', path: operational.operationalPaths(projectRoot, activeSession || null).events, detail: `${ctx.tracing.summary.total} evento(s)`, status: ctx.tracing.summary.total ? 'done' : 'pending' },
      { id: 'checkpoints', label: 'CHECKPOINTS', path: ctx.checkpoints.path, detail: `${ctx.checkpoints.parsed.length} gates`, status: ctx.readiness.checkpointPending ? 'active' : 'pending' },
      { id: 'verify', label: 'VERIFY', path: ctx.verify.path, detail: verifyDetail, status: ctx.verify.raw ? 'done' : 'pending' },
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
  ctx.guidance = buildHumanGuidance(ctx);
  ctx.dashboard = { readOnly: false, version: 'v2' };
  return ctx;
}

function dashboardHtml() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>OXE Control Room</title><style>
  :root{
    --bg:#090d16;--bg2:#0d1322;--sidebar:#0d1526;--panel:#121b2e;--card:#162238;--card2:#1c2b47;
    --ink:#f8fafc;--ink2:#cbd5e1;--muted:#94a3b8;
    --line:#22314d;--line-strong:#35507e;
    --brand:#1d4ed8;--brand-hi:#2563eb;--brand-light:#60a5fa;--brand-soft:rgba(37,99,235,.16);--brand-glow:rgba(37,99,235,.28);
    --ok:#34d399;--okbg:rgba(16,185,129,.15);
    --warn:#fbbf24;--warnbg:rgba(245,158,11,.15);
    --bad:#fb7185;--badbg:rgba(244,63,94,.16);
    --shadow:0 14px 34px rgba(0,0,0,.35);--radius:14px
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(circle at top right,rgba(37,99,235,.16),transparent 42%),linear-gradient(180deg,var(--bg),var(--bg2));font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);min-height:100vh}
  .shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
  .nav{background:var(--sidebar);border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;height:100vh;overflow-y:auto}
  .brand-box{padding:14px;border-radius:var(--radius);background:linear-gradient(135deg,rgba(29,78,216,.36),rgba(13,21,38,.95));border:1px solid var(--brand-hi);box-shadow:0 0 22px var(--brand-glow)}
  .brand-title{font-size:17px;font-weight:900;letter-spacing:.01em;color:#fff;display:flex;align-items:center;justify-content:space-between}
  .brand-sub{font-size:12px;color:var(--ink2);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nav-group{display:grid;gap:5px}
  .nav-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);padding:0 10px;margin:2px 0;font-weight:700}
  .nav-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:9px 11px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--ink2);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:all .15s ease}
  .nav-btn:hover{background:rgba(37,99,235,.12);border-color:var(--line-strong);color:#fff}
  .nav-btn.active{background:linear-gradient(90deg,var(--brand),var(--brand-hi));border-color:var(--brand-light);color:#fff;font-weight:700;box-shadow:0 6px 16px var(--brand-glow)}
  .nav-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.11);color:#fff;font-weight:700}
  .nav-pill.alert{background:var(--badbg);color:var(--bad)}
  .nav-pill.warn{background:var(--warnbg);color:var(--warn)}
  .main{padding:24px 28px;max-width:1360px;width:100%;margin:0 auto}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px}
  .topbar h1{margin:0;font-size:24px;font-weight:900;color:#fff;letter-spacing:-.01em}
  .topbar-sub{font-size:13px;color:var(--muted);margin-top:4px}
  .topbar-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .hero{border-radius:16px;padding:22px 24px;margin-bottom:18px;border:1px solid var(--line-strong);box-shadow:var(--shadow);display:grid;gap:14px}
  .hero.done{background:linear-gradient(135deg,rgba(16,185,129,.15),rgba(29,78,216,.24));border-color:rgba(52,211,153,.45)}
  .hero.active{background:linear-gradient(135deg,rgba(37,99,235,.26),rgba(18,27,46,.96));border-color:rgba(96,165,250,.5)}
  .hero.warning{background:linear-gradient(135deg,rgba(245,158,11,.17),rgba(18,27,46,.96));border-color:rgba(251,191,36,.45)}
  .hero.blocked{background:linear-gradient(135deg,rgba(244,63,94,.20),rgba(18,27,46,.96));border-color:rgba(251,113,133,.5)}
  .hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  .hero-title{font-size:22px;font-weight:900;color:#fff;margin:6px 0 0;line-height:1.25}
  .hero-desc{font-size:14px;color:var(--ink2);line-height:1.5;max-width:780px}
  .cmd-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(9,13,22,.65);border:1px solid var(--line-strong);border-radius:11px;padding:10px 14px}
  .cmd-bar code{background:transparent;padding:0;font-size:13px;color:#93c5fd;font-weight:700;flex:1;min-width:180px}
  .signals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
  .signal{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:15px 16px;cursor:pointer;text-align:left;transition:all .15s ease;display:grid;gap:6px}
  .signal:hover{border-color:var(--brand-light);transform:translateY(-1px);background:var(--card)}
  .signal-val{font-size:18px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px}
  .layout{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}
  .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .stack,.list{display:grid;gap:14px;align-content:start}
  .panel,.item,.entry{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius)}
  .panel{padding:18px 20px;box-shadow:var(--shadow)}
  .item,.entry{padding:13px 15px;background:var(--card)}
  .view{display:none}.view.active{display:block}
  .label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}
  .muted{color:var(--muted)}.small{font-size:13px;color:var(--ink2);line-height:1.45}
  .head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px}
  .head h2{margin:0;font-size:16px;color:#fff;font-weight:800}
  h3{margin:14px 0 8px;font-size:13px;color:var(--brand-light);text-transform:uppercase;letter-spacing:.06em}
  .badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:4px 10px;font-size:11px;text-transform:uppercase;font-weight:800;letter-spacing:.04em;white-space:nowrap}
  .done{background:var(--okbg);color:var(--ok);border:1px solid rgba(52,211,153,.35)}
  .active{background:var(--brand-soft);color:var(--brand-light);border:1px solid rgba(96,165,250,.4)}
  .warning{background:var(--warnbg);color:var(--warn);border:1px solid rgba(251,191,36,.35)}
  .blocked{background:var(--badbg);color:var(--bad);border:1px solid rgba(251,113,133,.38)}
  .pending{background:rgba(148,163,184,.14);color:var(--ink2);border:1px solid var(--line)}
  .progress-wrap{background:#0b1120;border:1px solid var(--line);border-radius:999px;height:10px;overflow:hidden;margin:10px 0 14px}
  .progress-bar{height:100%;background:linear-gradient(90deg,var(--brand-hi),var(--ok));border-radius:999px;transition:width .3s ease}
  .phase-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
  .check-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--ink2)}
  .dot{width:9px;height:9px;border-radius:999px;margin-top:5px;flex-shrink:0}
  .dot.done{background:var(--ok)}.dot.active{background:var(--brand-light)}.dot.warning{background:var(--warn)}.dot.blocked{background:var(--bad)}
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
  .raw{white-space:pre-wrap;font-family:Consolas,"Cascadia Code",monospace;font-size:12px;background:#0a0f1c;color:var(--ink2);border:1px solid var(--line);border-radius:10px;padding:12px;max-height:260px;overflow:auto;margin-top:10px}
  .chip{display:inline-flex;border-radius:999px;padding:3px 9px;background:var(--brand-soft);color:var(--brand-light);border:1px solid rgba(96,165,250,.3);font-size:11px;font-weight:700;margin:3px 5px 0 0}
  code{background:#0c1322;color:#93c5fd;padding:2px 6px;border-radius:6px;font-family:Consolas,monospace;font-size:12px}
  details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  details summary{cursor:pointer;font-weight:700;font-size:13px;color:var(--brand-light);list-style:none;display:flex;justify-content:space-between;align-items:center}
  details summary::after{content:"▸";color:var(--muted)}
  details[open] summary::after{content:"▾"}
  @media (max-width:1180px){.signals{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}}
  @media (max-width:860px){.shell{grid-template-columns:1fr}.nav{position:static;height:auto}.signals,.grid2,.grid3{grid-template-columns:1fr}}
  </style></head><body>
  <div class="shell">
    <aside class="nav">
      <div class="brand-box">
        <div class="brand-title"><span>OXE Control Room</span><span class="nav-pill">v2</span></div>
        <div class="brand-sub" id="nav-project">Carregando…</div>
      </div>
      <div class="nav-group">
        <div class="nav-label">Acompanhar</div>
        <button class="nav-btn active" data-tab="overview" onclick="setTab('overview')"><span>Agora (Resumo)</span><span class="nav-pill" id="pill-go">—</span></button>
        <button class="nav-btn" data-tab="plan" onclick="setTab('plan')"><span>Fases & Tarefas</span><span class="nav-pill" id="pill-plan">0</span></button>
        <button class="nav-btn" data-tab="agents" onclick="setTab('agents')"><span>Agentes & Colisões</span><span class="nav-pill" id="pill-agents">0</span></button>
      </div>
      <div class="nav-group">
        <div class="nav-label">Diagnóstico</div>
        <button class="nav-btn" data-tab="reevaluate" onclick="setTab('reevaluate')"><span>Reavaliação & Drift</span><span class="nav-pill" id="pill-drift">0</span></button>
        <button class="nav-btn" data-tab="scorecard" onclick="setTab('scorecard')"><span>Scorecard & ROI</span><span class="nav-pill" id="pill-score">—</span></button>
        <button class="nav-btn" data-tab="worktrees" onclick="setTab('worktrees')"><span>Worktrees & Ambiente</span><span class="nav-pill" id="pill-wt">0</span></button>
        <button class="nav-btn" data-tab="execution" onclick="setTab('execution')"><span>Execução & Verify</span><span class="nav-pill" id="pill-gates">0</span></button>
        <button class="nav-btn" data-tab="sessions" onclick="setTab('sessions')"><span>Sessões & Técnico</span><span class="nav-pill" id="pill-sess">0</span></button>
      </div>
      <div class="item" style="margin-top:auto">
        <div class="label">Sessão Ativa</div>
        <div class="small" id="nav-session" style="margin-top:4px;font-weight:700;color:#fff;word-break:break-word">—</div>
        <div class="actions" style="margin-top:10px">
          <button class="primary" onclick="refresh()">Atualizar</button>
          <button class="secondary" id="auto-btn" onclick="toggleAuto()">Auto: ON</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1 id="top-title">Resumo da Sessão</h1>
          <div class="topbar-sub" id="top-sub">Sincronizando dados locais…</div>
        </div>
        <div class="topbar-meta">
          <span class="chip" id="chip-phase">status: —</span>
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
  const plain=(s)=>String(s||'').replace(/\\*\\*/g,'').replace(/\`/g,'');
  const cls=(s)=>{const v=String(s||'').toLowerCase();if(/(healthy|approved|done|closed|go|clean|well-calibrated|passed|ready|completed|no_impact|ok)/.test(v))return'done';if(/(running|in_review|active|mentioned|acceptable|controlled|replaying|planned)/.test(v))return'active';if(/(rejected|needs_revision|blocked|failed|no-go|overconfident|do_not_execute|aborted|waiting_approval|contract_drift|replan_recommended|broken)/.test(v))return'blocked';if(/(risk|warning|underconfident|needs_refinement|paused|mechanical_sync|stale)/.test(v))return'warning';return'pending';};
  const badge=(s,l)=>'<span class="badge '+cls(s)+'">'+esc(l||s||'pendente')+'</span>';
  const list=(items,empty)=>items&&items.length?'<div class="list">'+items.join('')+'</div>':'<div class="entry small muted">'+esc(empty)+'</div>';
  const kv=(k,v)=>'<div class="item"><div class="label">'+esc(k)+'</div><div class="small" style="margin-top:6px;font-weight:800;color:#fff;font-size:15px">'+esc(v)+'</div></div>';
  const phaseLabel=(p)=>{const m={verify_complete:'Verificado ✓',plan_ready:'Plano pronto',executing:'Em execução',verify_failed:'Falha no verify',spec_ready:'Spec pronta'};return m[String(p||'').toLowerCase()]||(p||'—');};
  const tabMeta={
    overview:{title:'Agora — Resumo da Sessão',sub:'O que está pronto, o que precisa da sua atenção e qual o próximo comando recomendado.'},
    plan:{title:'Fases, Tarefas & Critérios',sub:'Progresso real do programa (F1–F4), tarefas da fase atual e cobertura dos critérios de aceite A*.'},
    agents:{title:'Agentes & Colisões ao Vivo',sub:'Use esta aba quando houver vários agentes em paralelo para evitar edição simultânea dos mesmos arquivos.'},
    reevaluate:{title:'Reavaliação & Drift contra a Base',sub:'Verifica se commits novos na branch base afetam tarefas pendentes do plano atual.'},
    scorecard:{title:'Scorecard & Roteamento de Modelos',sub:'Distribuição de tarefas por tier (fast / balanced / powerful) e resumo de evidências.'},
    worktrees:{title:'Worktrees & Ambiente Local',sub:'Higiene das worktrees git do projeto e configuração detectada de stack, CI, ALM e MCP.'},
    execution:{title:'Execução, Gates & Verify',sub:'Status do run atual, aprovações pendentes, checks executados e trilha de eventos.'},
    sessions:{title:'Sessões & Detalhes Técnicos',sub:'Alterne entre sessões do projeto ou inspecione os artefatos internos de .oxe/ sob demanda.'},
  };
  const runtimeDisabled=()=>ctx&&ctx.dashboard&&ctx.dashboard.readOnly;
  async function api(url,opts={}){const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});if(!res.ok)throw new Error(await res.text());return res.json();}
  async function refresh(){ctx=await api('/api/state'+(session?'?session='+encodeURIComponent(session):''));render();}
  function copyCmd(cmd,btn){if(!cmd)return;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(cmd).then(()=>{const old=btn.textContent;btn.textContent='Copiado ✓';setTimeout(()=>{btn.textContent=old;},1400);}).catch(()=>{prompt('Copie o comando:',cmd);});}else{prompt('Copie o comando:',cmd);}}
  function numCount(v){return typeof v==='number'?v:Array.isArray(v)?v.length:0;}
  function updateNav(){
    document.querySelectorAll('.nav-btn').forEach((b)=>b.classList.toggle('active',b.dataset.tab===tab));
    const meta=tabMeta[tab]||tabMeta.overview;
    const sessShort=(ctx.activeSession||'raiz').replace(/^sessions\\//,'');
    document.getElementById('nav-project').textContent=(ctx.projectName||'Projeto')+' · '+sessShort;
    document.getElementById('nav-session').textContent=sessShort;
    document.getElementById('top-title').textContent=meta.title;
    document.getElementById('top-sub').textContent=meta.sub;
    document.getElementById('chip-phase').textContent=phaseLabel(ctx.phase);
    document.getElementById('chip-alm').textContent='ALM: '+((ctx.onboard_summary&&ctx.onboard_summary.alm_provider)||'none');
    document.getElementById('chip-ci').textContent='CI: '+((ctx.onboard_summary&&ctx.onboard_summary.ci_providers&&ctx.onboard_summary.ci_providers.join(', '))||'local');
    const g=ctx.guidance||{tone:'active',badgeLabel:'—'};
    document.getElementById('pill-go').textContent=g.tone==='done'?'OK':g.tone==='blocked'?'!':'•';
    const prog=ctx.program;
    document.getElementById('pill-plan').textContent=prog&&prog.totalCount?prog.closedCount+'/'+prog.totalCount:String((ctx.plan&&ctx.plan.totalTasks)||0);
    const agPill=document.getElementById('pill-agents');
    const colCount=(ctx.agent_collisions||[]).length;
    agPill.textContent=colCount?colCount+'!':String((ctx.active_agents||[]).length);
    agPill.className='nav-pill'+(colCount?' alert':'');
    const drCount=(ctx.reevaluate&&ctx.reevaluate.summary&&ctx.reevaluate.summary.contract_drift)||0;
    const drPill=document.getElementById('pill-drift');
    drPill.textContent=String(drCount);
    drPill.className='nav-pill'+(drCount?' warn':'');
    document.getElementById('pill-score').textContent=ctx.scorecard_routing&&ctx.scorecard_routing.auto_route?'AUTO':'STD';
    document.getElementById('pill-wt').textContent=String((ctx.worktree_hygiene&&ctx.worktree_hygiene.total)||0);
    document.getElementById('pill-gates').textContent=String((ctx.enterprise&&ctx.enterprise.gateQueue&&ctx.enterprise.gateQueue.pending&&ctx.enterprise.gateQueue.pending.length)||0);
    document.getElementById('pill-sess').textContent=String((ctx.sessions&&ctx.sessions.items&&ctx.sessions.items.length)||0);
  }
  function render(){
    updateNav();
    const g=ctx.guidance||{tone:'active',badgeLabel:'Status',headline:'Sessão carregada',explanation:'',command:'oxe-cc status',ctaLabel:'Ver Fases',ctaTab:'plan',checklist:[]};
    const prog=ctx.program||null;
    const agentsLive=ctx.active_agents||[];
    const collisions=ctx.agent_collisions||[];
    const messages=ctx.agent_messages||[];
    const wt=ctx.worktree_hygiene||{total:0,secondary:0,dirty:0,clean_merged:0,prunable:0,nested_agent:0,protected_junction_targets:0,warnings:[]};
    const wtDirty=numCount(wt.dirty);
    const wtOrphans=numCount(wt.prunable)+numCount(wt.clean_merged)+numCount(wt.orphans);
    const reev=ctx.reevaluate||{overall_status:'unavailable',summary:{no_impact:0,mechanical_sync:0,contract_drift:0},tasks:[]};
    const scr=ctx.scorecard_routing||{auto_route:false,tiers:{fast:0,balanced:0,powerful:0},scorecard:null};
    const ob=ctx.onboard_summary||{stacks:[],ci_providers:[],alm_provider:'none',env_ok:true};
    const gateQueue=(ctx.enterprise&&ctx.enterprise.gateQueue)||{pending:[],stalePending:[],resolvedRecent:[]};
    const pendingGateCount=(gateQueue.pending||[]).length;
    const blockerCount=(ctx.readiness&&ctx.readiness.blockers?ctx.readiness.blockers.length:0)+pendingGateCount;
    const driftCount=(reev.summary&&reev.summary.contract_drift)||0;
    const syncCount=(reev.summary&&reev.summary.mechanical_sync)||0;
    const driftLabel=driftCount?driftCount+' drift(s)':syncCount?syncCount+' sync':reev.overall_status==='clean'?'Alinhado':'Sem pendências';
    const driftTone=driftCount?'blocked':syncCount?'warning':'done';
    const wtTone=wtDirty>0||wt.needs_gc?'warning':'done';
    const verifyManifest=(ctx.verify&&ctx.verify.parsed&&ctx.verify.parsed.manifest)||null;

    const phaseRows=prog&&prog.phases&&prog.phases.length?prog.phases.map((ph)=>{
      const st=String(ph.status||'pending').toLowerCase();
      const stText=st==='closed'?'Concluída':st==='active'?'Ativa':'Pendente';
      return '<div class="phase-row"><div><div style="font-weight:800;color:#fff">'+esc(ph.id)+' — '+esc(plain(ph.title))+'</div><div class="small muted" style="margin-top:3px">'+esc(plain(ph.scope||''))+'</div><div style="margin-top:6px">'+(ph.acceptance||[]).map((a)=>'<span class="chip">'+esc(a)+'</span>').join('')+'</div></div>'+badge(st,stText)+'</div>';
    }):[];

    const checklistHtml=(g.checklist||[]).map((c)=>'<div class="check-row"><span class="dot '+esc(c.status)+'"></span><span>'+esc(c.text)+'</span></div>');
    const waves=(ctx.plan.waves||[]).map((w)=>'<div class="item"><div class="head"><div><strong>Onda '+esc(w.wave)+'</strong><div class="small muted">'+esc(w.taskIds.length)+' tarefa(s)</div></div>'+badge(String(ctx.runtime.parsed.currentWave)===String(w.wave)?'running':'done',String(ctx.runtime.parsed.currentWave)===String(w.wave)?'em execução':'registrada')+'</div>'+w.tasks.map((t)=>'<div class="entry" style="margin-top:8px"><div style="font-weight:700;color:#fff">'+esc(t.id)+' — '+esc(plain(t.title))+'</div><div class="small muted" style="margin-top:4px">Verify: <code>'+esc(t.verifyCommand||'—')+'</code></div><div style="margin-top:6px">'+(t.aceite||[]).map((x)=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div></div>').join('')+'</div>');
    const coverage=(ctx.coverage||[]).map((c)=>{
      const stText=c.verifyStatus==='passed'?'Validado':c.verifyStatus==='failed'?'Falhou':c.verifyStatus==='mentioned'?'Citado':'Pendente';
      return '<div class="item"><div class="head"><div><strong>'+esc(c.id)+'</strong>'+(c.phase?' <span class="chip">'+esc(c.phase)+'</span>':'')+'</div>'+badge(c.verifyStatus,stText)+'</div><div class="small">'+esc(plain(c.criterion))+'</div><div class="small muted" style="margin-top:6px">'+(c.verifySummary?esc(plain(c.verifySummary)):'Verificação: '+esc(plain(c.verifyHow||'pendente')))+'</div></div>';
    });
    const comments=(ctx.review.comments||[]).map((c)=>'<div class="item"><div class="small muted">'+esc(c.target)+' · '+esc(c.type)+' · '+esc(c.status)+' · '+esc(c.author)+'</div><div style="margin-top:6px">'+esc(c.text)+'</div>'+(c.status!=='resolved'?'<div class="actions"><button class="secondary" onclick="resolveComment(\\''+esc(c.id)+'\\')">Resolver</button></div>':'')+'</div>');
    const reviewBody='<div class="grid2"><div><div class="actions"><button class="primary" onclick="changeReview(\\'approved\\')">Aprovar plano</button><button class="warnbtn" onclick="changeReview(\\'needs_revision\\')">Pedir revisão</button><button class="secondary" onclick="changeReview(\\'in_review\\')">Em revisão</button><button class="danger" onclick="changeReview(\\'rejected\\')">Rejeitar</button></div><div class="form"><input id="comment-target" placeholder="Alvo (ex.: F2, T1)"/><select id="comment-type"><option value="note">Nota</option><option value="risk">Risco</option><option value="question">Dúvida</option><option value="approval">Aprovação</option></select><textarea id="comment-text" rows="3" placeholder="Escreva um comentário para o time…"></textarea><button class="primary" onclick="addComment()">Adicionar comentário</button></div></div><div><h3>Comentários</h3>'+list(comments,'Sem comentários registrados.')+'</div></div>';
    const reviewNeedsFocus=!ctx.isLean&&ctx.phase==='plan_ready'&&ctx.planReviewStatus!=='approved';

    const activeAgentsCards=agentsLive.map((a)=>'<div class="item"><div class="head"><div><strong>'+esc(a.agent_id)+'</strong><div class="small muted">'+esc(a.provider||'—')+' · '+esc(a.role||'executor')+' · branch: '+esc(a.branch||'—')+'</div></div>'+badge('active',a.task||'ativo')+'</div><div class="small">Worktree: <code>'+esc(a.worktree||'—')+'</code></div><div style="margin-top:6px">'+((a.write_set||[]).length?(a.write_set||[]).map((f)=>'<span class="chip">'+esc(f)+'</span>').join(''):'<span class="small muted">write_set vazio</span>')+'</div></div>');
    const collisionCards=collisions.map((c)=>'<div class="item" style="border-color:rgba(251,113,133,.55)"><div class="head"><strong>'+esc(c.file)+'</strong>'+badge('blocked','colisão')+'</div><div class="small">Agentes: <strong>'+esc((c.agents||[]).join(' × '))+'</strong></div><div class="small muted" style="margin-top:4px">Tarefas: '+esc((c.tasks||[]).filter(Boolean).join(', ')||'—')+'</div></div>');
    const inboxCards=messages.slice().reverse().map((m)=>'<div class="entry"><div class="head"><strong>'+esc(m.from)+' → '+esc(m.to)+'</strong>'+badge('active',m.topic||'geral')+'</div><div class="small">'+esc(m.body)+'</div><div class="small muted" style="margin-top:4px">'+esc(m.at||'')+'</div></div>');
    const reevTasks=(reev.tasks||[]).map((t)=>'<div class="item"><div class="head"><strong>'+esc(t.id)+' — '+esc(plain(t.title||''))+'</strong>'+badge(t.classification,t.classification)+'</div><div class="small">Ação sugerida: <code>'+esc(t.recommended_action||'—')+'</code></div>'+((t.overlapping_files&&t.overlapping_files.length)?'<div style="margin-top:6px">'+t.overlapping_files.map((f)=>'<span class="chip">'+esc(f)+'</span>').join('')+'</div>':'')+'</div>');
    const pendingGates=(gateQueue.pending||[]).map((gItem)=>'<div class="entry"><div class="head"><strong>'+esc(gItem.gate_id)+'</strong>'+badge(gItem.status||'pending')+'</div><div class="small muted">Escopo: '+esc(gItem.scope||'—')+' · Tarefa: '+esc(gItem.work_item_id||'—')+'</div><div class="actions"><button class="primary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gItem.gate_id)+'\\',\\'approve\\')">Aprovar</button><button class="warnbtn" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gItem.gate_id)+'\\',\\'waive\\')">Dispensar</button><button class="danger" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeGateResolve(\\''+esc(gItem.gate_id)+'\\',\\'reject\\')">Rejeitar</button></div></div>');
    const checkpoints=(ctx.checkpoints.parsed||[]).map((c)=>'<div class="item"><div class="head"><strong>'+esc(c.id)+'</strong>'+badge(c.status)+'</div><div class="small muted">'+esc(c.type)+' · '+esc(c.phase||'—')+' · '+esc(c.scope||'—')+'</div><div class="small" style="margin-top:4px">'+esc(c.notes||'—')+'</div></div>');
    const trace=((ctx.tracing&&ctx.tracing.events)||[]).slice(-10).reverse().map((e)=>'<div class="entry"><div class="head"><strong>'+esc(e.type)+'</strong>'+badge('active',e.timestamp?e.timestamp.slice(11,19):'—')+'</div><div class="small muted">run='+esc(e.run_id||'—')+(e.work_item_id||e.task_id?' · task='+esc(e.work_item_id||e.task_id):'')+'</div></div>');
    const sessions=(ctx.sessions.items||[]).map((s)=>'<div class="item"><div class="head"><div><strong>'+esc(s.id)+' · '+esc(s.name)+'</strong><div class="small muted">'+esc(s.lastActivity)+'</div></div>'+badge(s.status)+'</div><div class="small">'+esc(plain(s.summary||'—'))+'</div><div class="actions"><button class="secondary" onclick="openSession(\\''+esc(s.path)+'\\')">Abrir esta sessão</button></div></div>');
    const graph=(ctx.visual.artifactGraph||[]).map((n)=>'<div class="item"><div class="head"><strong>'+esc(n.label)+'</strong>'+badge(n.status)+'</div><div class="small">'+esc(plain(n.detail||'—'))+'</div></div>');
    const repo=Object.entries(ctx.repositoryContext||{}).map(([k,v])=>'<div class="item"><strong>'+esc(k.toUpperCase())+'</strong><div class="small" style="margin-top:6px">'+esc(plain(v.summary||'Sem resumo.'))+'</div></div>');
    const activeRun=ctx.activeRun||{};

    app.innerHTML=''
    +'<div class="view'+(tab==='overview'?' active':'')+'">'
      +'<div class="hero '+esc(g.tone)+'">'
        +'<div class="hero-top"><div><div class="label">O que fazer agora</div><div class="hero-title">'+esc(g.headline)+'</div></div>'+badge(g.tone,g.badgeLabel)+'</div>'
        +'<div class="hero-desc">'+esc(g.explanation)+'</div>'
        +'<div class="cmd-bar"><code>'+esc(g.command)+'</code><button class="secondary" onclick="copyCmd(\\''+esc(g.command)+'\\',this)">Copiar comando</button><button class="primary" onclick="setTab(\\''+esc(g.ctaTab)+'\\')">'+esc(g.ctaLabel)+'</button></div>'
      +'</div>'
      +'<div class="signals">'
        +'<button class="signal" onclick="setTab(\\'execution\\')"><div class="label">Bloqueios & Gates</div><div class="signal-val"><span>'+esc(blockerCount===0?'Nenhum':blockerCount+' pendente(s)')+'</span>'+badge(blockerCount?'blocked':'done',blockerCount?'atenção':'OK')+'</div><div class="small muted">'+(verifyManifest?esc(verifyManifest.pass+'/'+verifyManifest.total+' checks verdes'):'Clique para abrir Execução')+'</div></button>'
        +'<button class="signal" onclick="setTab(\\'agents\\')"><div class="label">Agentes & Colisões</div><div class="signal-val"><span>'+esc(agentsLive.length+' ativo(s)')+'</span>'+badge(collisions.length?'blocked':'done',collisions.length?collisions.length+' colisão':'0 colisões')+'</div><div class="small muted">'+(messages.length?esc(messages.length+' mensagem(ns) no inbox'):'Nenhum conflito de arquivo')+'</div></button>'
        +'<button class="signal" onclick="setTab(\\'reevaluate\\')"><div class="label">Drift na Base</div><div class="signal-val"><span>'+esc(driftLabel)+'</span>'+badge(driftTone,driftTone==='done'?'OK':'revisar')+'</div><div class="small muted">Base: '+esc(reev.base||'—')+'</div></button>'
        +'<button class="signal" onclick="setTab(\\'worktrees\\')"><div class="label">Worktrees</div><div class="signal-val"><span>'+esc(wt.total||0)+' total</span>'+badge(wtTone,wtDirty?wtDirty+' suja(s)':'limpas')+'</div><div class="small muted">'+(wtDirty?'Clique para ver higiene':'Nenhuma pendência')+'</div></button>'
      +'</div>'
      +'<div class="layout">'
        +'<div class="panel"><div class="head"><div><h2>Progresso da Entrega</h2><div class="small muted">'+esc(plain(ctx.spec&&ctx.spec.objective||'Objetivo não encontrado na SPEC.'))+'</div></div>'+(prog&&prog.totalCount?badge(prog.allClosed?'done':'active',prog.pct+'%'):'')+'</div>'
          +(prog&&prog.totalCount?'<div class="progress-wrap"><div class="progress-bar" style="width:'+esc(prog.pct)+'%"></div></div><div class="list">'+phaseRows.join('')+'</div>':list(waves,'Nenhum plano carregado nesta sessão.'))
        +'</div>'
        +'<div class="panel"><div class="head"><div><h2>Checklist da Sessão</h2><div class="small muted">Leitura rápida de saúde e prontidão</div></div></div><div class="list">'+checklistHtml.join('')+'</div></div>'
      +'</div>'
    +'</div>'

    +'<div class="view'+(tab==='plan'?' active':'')+'"><div class="stack">'
      +(prog&&prog.totalCount?'<div class="panel"><div class="head"><div><h2>Fases do Programa</h2><div class="small muted">'+esc(prog.closedCount)+' de '+esc(prog.totalCount)+' fases concluídas</div></div>'+badge(prog.allClosed?'done':'active',prog.pct+'%')+'</div><div class="list">'+phaseRows.join('')+'</div></div>':'')
      +'<div class="layout">'
        +'<div class="panel"><div class="head"><div><h2>Critérios de Aceite (SPEC → Verify)</h2><div class="small muted">'+esc((ctx.coverage||[]).length)+' critério(s) rastreados</div></div></div><div class="list">'+(coverage.length?coverage.join(''):'<div class="entry small muted">Nenhum critério A* encontrado na SPEC.</div>')+'</div></div>'
        +'<div class="stack">'
          +'<div class="panel"><div class="head"><div><h2>Tarefas da Fase Atual (PLAN.md)</h2><div class="small muted">'+esc(ctx.plan.totalTasks)+' tarefa(s) registradas</div></div></div>'+list(waves,'PLAN.md ausente ou sem tarefas.')+'</div>'
          +(reviewNeedsFocus?'<div class="panel"><div class="head"><div><h2>Revisão & Aprovação do Plano</h2></div>'+badge(ctx.planReviewStatus)+'</div>'+reviewBody+'</div>':'<details><summary>Revisão manual e comentários do plano ('+esc((ctx.review.comments||[]).length)+')</summary><div style="margin-top:12px">'+reviewBody+'</div></details>')
        +'</div>'
      +'</div>'
    +'</div></div>'

    +'<div class="view'+(tab==='agents'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Agentes Ativos Agora</h2><div class="small muted">Leases registrados automaticamente em execuções paralelas</div></div>'+badge(agentsLive.length?'active':'pending',agentsLive.length+' ativo(s)')+'</div>'+list(activeAgentsCards,'Nenhum agente em execução paralela neste momento.')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Colisões de Arquivos (Write-Set)</h2><div class="small muted">Alerta imediato se dois agentes editarem o mesmo arquivo</div></div>'+badge(collisions.length?'blocked':'done',collisions.length?collisions.length+' colisão':'sem colisões')+'</div>'+list(collisionCards,'Zero colisões detectadas.')+'</div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Inbox entre Worktrees</h2><div class="small muted">Mensagens trocadas via oxe-cc agents send / inbox</div></div>'+badge('active',messages.length+' msg(s)')+'</div>'+list(inboxCards,'Nenhuma mensagem registrada no inbox.')+'</div>'
    +'</div></div></div>'

    +'<div class="view'+(tab==='reevaluate'?' active':'')+'"><div class="panel"><div class="head"><div><h2>Reavaliação contra a Branch Base</h2><div class="small muted">Base: '+esc(reev.base||'—')+' · Commits upstream: '+esc(reev.upstream_commits_count||0)+'</div></div>'+badge(driftTone,driftLabel)+'</div><div class="grid3" style="margin-bottom:14px">'+kv('Sem impacto',String((reev.summary&&reev.summary.no_impact)||0))+kv('Sync mecânico',String(syncCount))+kv('Drift de contrato',String(driftCount))+'</div>'+list(reevTasks,'Nenhuma tarefa pendente sofreu drift contra a branch base.')+'</div></div>'

    +'<div class="view'+(tab==='scorecard'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Distribuição de Modelos & Roteamento</h2><div class="small muted">Tier atribuído às tarefas do plano atual</div></div>'+badge(scr.auto_route?'done':'active',scr.auto_route?'auto_route ON':'auto_route OFF')+'</div><div class="grid3">'+kv('Fast',String((scr.tiers&&scr.tiers.fast)||0))+kv('Balanced',String((scr.tiers&&scr.tiers.balanced)||0))+kv('Powerful',String((scr.tiers&&scr.tiers.powerful)||0))+'</div><details style="margin-top:14px"><summary>Ver JSON técnico do scorecard</summary><div class="raw">'+esc(JSON.stringify(scr.scorecard||{note:'Sem telemetria de scorecard acumulada ainda.'},null,2))+'</div></details></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Qualidade & Evidências</h2><div class="small muted">Resumo da última verificação</div></div></div><div class="grid2">'+kv('Checks executados',String((verifyManifest&&verifyManifest.total)||(ctx.enterprise&&ctx.enterprise.verificationSummary&&ctx.enterprise.verificationSummary.total)||0))+kv('Cobertura de evidência',verifyManifest&&verifyManifest.coveragePercent!=null?verifyManifest.coveragePercent+'%':(ctx.enterprise&&ctx.enterprise.evidenceCoverage&&ctx.enterprise.evidenceCoverage.coverage_percent!=null?ctx.enterprise.evidenceCoverage.coverage_percent+'%':'—'))+kv('Riscos residuais',String((ctx.enterprise&&ctx.enterprise.residualRiskSummary&&ctx.enterprise.residualRiskSummary.total)||0))+kv('Promoção',(ctx.enterprise&&ctx.enterprise.promotionSummary&&ctx.enterprise.promotionSummary.status)||'—')+'</div></div>'
    +'</div></div></div>'

    +'<div class="view'+(tab==='worktrees'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Higiene de Worktrees</h2><div class="small muted">Para inspecionar ou limpar: <code>oxe-cc gc-worktrees --dry-run</code></div></div>'+badge(wtTone,wtDirty?wtDirty+' com alterações':'saudável')+'</div><div class="grid3">'+kv('Total',String(wt.total||0))+kv('Com alterações (sujas)',String(wtDirty))+kv('Limpáveis / órfãs',String(wtOrphans))+'</div>'+(wt.nested_agent?'<div class="small muted" style="margin-top:10px">Nota: '+esc(wt.nested_agent)+' worktree(s) aninhada(s) de agente detectada(s) (ex.: <code>.claude/worktrees</code>).</div>':'')+'</div>'
      +'<div class="panel"><div class="head"><div><h2>Ambiente Detectado (Onboard & MCP)</h2><div class="small muted">Configuração local-first sem acoplamento a provedor único</div></div></div><div class="grid2">'+kv('Stacks',(ob.stacks||[]).join(', ')||'—')+kv('CI',(ob.ci_providers||[]).join(', ')||'local')+kv('ALM',ob.alm_provider||'none')+kv('MCP nativo','oxe-cc mcp')+'</div></div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Resumo do Repositório</h2><div class="small muted">Base de conhecimento em .oxe/codebase/</div></div></div><div class="list">'+(repo.length?repo.join(''):'<div class="entry small muted">Nenhum mapa de codebase encontrado.</div>')+'</div></div>'
    +'</div></div></div>'

    +'<div class="view'+(tab==='execution'?' active':'')+'"><div class="layout"><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Execução & Run Atual</h2><div class="small muted">Controle direto do runtime quando uma execução está em curso</div></div>'+badge(activeRun.status||'pending')+'</div><div class="grid3">'+kv('Run ID',activeRun.run_id||'—')+kv('Status',activeRun.status||'sem run')+kv('Checks Verify',verifyManifest?verifyManifest.pass+'/'+verifyManifest.total+' OK':'—')+'</div><div class="actions"><button class="primary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'start\\')">Start</button><button class="warnbtn" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'pause\\')">Pause</button><button class="secondary" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'resume\\')">Resume</button><button class="danger" '+(runtimeDisabled()?'disabled':'')+' onclick="runtimeAction(\\'replay\\')">Replay</button></div></div>'
      +'<div class="panel"><div class="head"><div><h2>Gates Pendentes & Checkpoints</h2></div></div>'+list(pendingGates,'Nenhum gate aguardando aprovação.')+'<h3>Checkpoints</h3>'+list(checkpoints,'Nenhum checkpoint registrado.')+'</div>'
    +'</div><div class="stack">'
      +'<div class="panel"><div class="head"><div><h2>Últimos Eventos</h2><div class="small muted">Trilha recente em OXE-EVENTS.ndjson</div></div></div>'+list(trace,'Nenhum evento registrado.')+'</div>'
      +'<details><summary>Ver relatório bruto VERIFY.md</summary><div class="raw">'+esc(ctx.verify.summary||'VERIFY.md ausente.')+'</div></details>'
    +'</div></div></div>'

    +'<div class="view'+(tab==='sessions'?' active':'')+'"><div class="stack">'
      +'<div class="layout">'
        +'<div class="panel"><div class="head"><div><h2>Sessão Atual</h2></div></div><div class="grid2">'+kv('ID',(ctx.sessions.current&&ctx.sessions.current.id)||'—')+kv('Nome',(ctx.sessions.current&&ctx.sessions.current.name)||ctx.activeSession||'—')+kv('Status',(ctx.sessions.current&&ctx.sessions.current.status)||'—')+kv('Perfil',ctx.isLean?'lean':'standard')+'</div></div>'
        +'<div class="panel"><div class="head"><div><h2>Trocar de Sessão</h2><div class="small muted">Selecione outra entrega registrada no projeto</div></div></div>'+list(sessions,'Nenhuma sessão registrada em SESSIONS.md.')+'</div>'
      +'</div>'
      +'<details><summary>Mapa técnico de artefatos (.oxe/) — '+esc(graph.length)+' itens</summary><div class="grid3" style="margin-top:12px">'+graph.join('')+'</div></details>'
    +'</div></div>';
  }
  function setTab(next){tab=next;if(ctx)render();}
  function toggleAuto(){autoOn=!autoOn;document.getElementById('auto-btn').textContent='Auto: '+(autoOn?'ON':'OFF');if(timer){clearInterval(timer);timer=null;}if(autoOn)timer=setInterval(()=>{refresh().catch(()=>{});},10000);}
  async function openSession(p){session=p||null;tab='overview';await refresh();}
  async function changeReview(status){const note=prompt('Justificativa curta para o novo estado do plano:',status==='approved'?'Plano aprovado para execução.':'');if(note==null)return;await api('/api/review/status',{method:'POST',body:JSON.stringify({status,note,author:'user',activeSession:session})});await refresh();}
  async function addComment(){const target=document.getElementById('comment-target').value||'plan';const type=document.getElementById('comment-type').value||'note';const text=document.getElementById('comment-text').value.trim();if(!text)return alert('Escreva um comentário.');await api('/api/review/comment',{method:'POST',body:JSON.stringify({target,type,text,author:'user',activeSession:session})});document.getElementById('comment-text').value='';await refresh();}
  async function resolveComment(id){await api('/api/review/comment-status',{method:'POST',body:JSON.stringify({commentId:id,status:'resolved',activeSession:session})});await refresh();}
  async function runtimeAction(action){if(runtimeDisabled())return;const reason=prompt('Motivo da transição:',action==='start'?'iniciar execução':'');if(reason==null)return;await api('/api/runtime/action',{method:'POST',body:JSON.stringify({action,reason,activeSession:session})});await refresh();}
  async function runtimeGateResolve(gateId,decision){if(runtimeDisabled())return;const needsReason=decision==='reject'||decision==='waive';const reason=needsReason?prompt('Justificativa obrigatória para '+decision+':',''):'';if(needsReason&&(!reason||!reason.trim()))return alert('Justificativa obrigatória.');await api('/api/runtime/gates/resolve',{method:'POST',body:JSON.stringify({gateId,decision,actor:'dashboard',reason:reason&&reason.trim()?reason.trim():undefined,activeSession:session})});await refresh();}
  window.setTab=setTab;window.toggleAuto=toggleAuto;window.refresh=refresh;window.openSession=openSession;window.copyCmd=copyCmd;window.changeReview=changeReview;window.addComment=addComment;window.resolveComment=resolveComment;window.runtimeAction=runtimeAction;window.runtimeGateResolve=runtimeGateResolve;
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
