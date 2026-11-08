'use strict';

/**
 * OXE 1.20 — Dossiê vivo verificado.
 *
 * Projeta por fase `.oxe/dossier/<fase>/` no formato de um workflow de engenharia (context / architecture / techspec
 * com Prova / plan com diário / decisions / notes), a partir das fontes estruturadas (SPEC, ROADMAP, PLAN.json,
 * IMPLEMENTATION-PACK, run state, eventos, git). O bloco gerado fica entre marcadores; o texto humano fora deles
 * (análise, handoff "o que a próxima fase deve saber") é preservado a cada regeneração.
 *
 * Verificações (drift): arquivos tocados fora do contrato, contrato não tocado, prova não executada, critério
 * manual sem sign-off, handoff vazio.
 */

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- oxe:dossier:begin -->';
const END = '<!-- oxe:dossier:end -->';
const HANDOFF_HEADING = '## O que a próxima fase deve saber';
const HANDOFF_PLACEHOLDER = '(preencher antes do `program close`)';

function cell(value) {
  return String(value == null ? '—' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
}

function table(headers, rows) {
  if (!rows.length) return '_(nenhum)_';
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

function money(value) {
  return typeof value === 'number' ? `US$ ${value.toFixed(2)}` : '—';
}

function dateOf(iso) {
  return iso ? String(iso).slice(0, 16).replace('T', ' ') : '—';
}

/** Seção `## Título` de um markdown (até o próximo `## `). */
function section(markdown, title) {
  const text = String(markdown || '');
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im');
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

/** Linhas `- **D-NN ...` / `D-NN:` da SPEC como decisões. */
function decisionsFromSpec(specText) {
  const out = [];
  for (const m of String(specText || '').matchAll(/^\s*-\s+\*\*(D-\d+)\s*([^*]*)\*\*:?\s*([\s\S]*?)(?=^\s*-\s+\*\*D-\d+|^\s*$|^#)/gm)) {
    out.push({ id: m[1], title: m[2].trim().replace(/:$/, ''), text: m[3].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** Diário por tarefa a partir dos eventos da run. */
function taskJournal(plan, events, checkResults) {
  const byTask = new Map();
  for (const task of plan.tasks || []) {
    byTask.set(task.id, { task, attempts: [], verifies: [], retries: [], status: 'pendente', finishedAt: null, startedAt: null });
  }
  for (const e of events) {
    const entry = byTask.get(e.work_item_id);
    if (!entry) continue;
    const p = e.payload || {};
    if (e.type === 'AttemptStarted' && !entry.startedAt) entry.startedAt = e.timestamp;
    if (e.type === 'ExecutorUsage') entry.attempts.push({ attempt: p.attempt, turns: p.turns || 0, cost: typeof p.cost_usd === 'number' ? p.cost_usd : 0, success: p.success, error: p.error || null, tools: p.tools || {} });
    if (e.type === 'VerificationCompleted' && p.status) entry.verifies.push(p.status);
    if (e.type === 'RetryScheduled') entry.retries.push(p.reason || 'retry');
    if (e.type === 'WorkItemCompleted') { entry.status = 'concluída'; entry.finishedAt = e.timestamp; }
    if (e.type === 'WorkItemBlocked' && e.work_item_id) { entry.status = 'bloqueada'; entry.finishedAt = e.timestamp; }
  }
  const testsByCriterion = new Map();
  // Só os checks de aceite congelado contam (check-a* repete os mesmos testes pelo comando da tarefa).
  for (const r of checkResults || []) {
    const m = /^check-accept-(a\d+)$/i.exec(r.check_id || '');
    if (m) testsByCriterion.set(m[1].toUpperCase(), (testsByCriterion.get(m[1].toUpperCase()) || 0) + (r.tests_executed || 0));
  }
  return [...byTask.values()].map((entry) => {
    const turns = entry.attempts.reduce((s, a) => s + a.turns, 0);
    const cost = entry.attempts.reduce((s, a) => s + a.cost, 0);
    const tests = (entry.task.aceite || []).reduce((s, ref) => s + (testsByCriterion.get(ref) || 0), 0);
    const failedVerifies = entry.verifies.filter((v) => v !== 'passed' && v !== 'pass').length;
    return { ...entry, turns, cost, tests, failedVerifies };
  });
}

/** Arquivos do contrato (pack exact_paths) × arquivos tocados (git) → drift de arquitetura. */
/** Glob (`**`, `*`, `?`) or path prefix. */
function globMatch(file, pattern) {
  const p = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  if (!/[*?]/.test(p)) return file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`);
  const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')}$`);
  return re.test(file);
}

function architectureDrift(pack, plan, changes, hashFile, options = {}) {
  const norm = (p) => String(p).replace(/\\/g, '/');
  const contracted = new Map();
  // O contrato é o pack (exact_paths) mais os arquivos declarados nas tarefas do plano.
  for (const t of pack && Array.isArray(pack.tasks) ? pack.tasks : []) {
    for (const p of Array.isArray(t.exact_paths) ? t.exact_paths : []) contracted.set(norm(p), String(t.id || t.task_id));
  }
  for (const t of (plan && plan.tasks) || []) {
    for (const p of t.files || []) if (!contracted.has(norm(p))) contracted.set(norm(p), t.id);
  }
  const frozen = new Map();
  for (const a of (plan && plan.acceptanceTests) || []) {
    for (const f of a.files || []) frozen.set(norm(typeof f === 'string' ? f : f.path), typeof f === 'string' ? null : f.sha256 || null);
  }
  const touched = new Map((changes || []).map((c) => [norm(c.path), c.status]));
  const candidates = [...touched.keys()].filter((p) => !contracted.has(p) && !frozen.has(p) && !p.startsWith('.oxe/'));
  // OXB-080: frozen tests the planner committed ahead of time for a LATER phase (added/modified under the acceptance
  // test directory, not part of this plan) are "parked", not drift; an audited waiver (--accept-drift) covers the rest.
  const parkedGlobs = Array.isArray(options.parkedGlobs) ? options.parkedGlobs : [];
  const waivedGlobs = Array.isArray(options.waivedGlobs) ? options.waivedGlobs : [];
  const parked = candidates.filter((p) => touched.get(p) !== 'D' && parkedGlobs.some((g) => globMatch(p, g)));
  const waived = candidates.filter((p) => !parked.includes(p) && waivedGlobs.some((g) => globMatch(p, g)));
  const outside = candidates.filter((p) => !parked.includes(p) && !waived.includes(p));
  const untouched = [...contracted.keys()].filter((p) => !touched.has(p));
  // Aceite "alterado" = hash atual diferente do congelado no compile (não "aparece no diff": o planner o commita).
  const frozenChanged = [...frozen.entries()]
    .filter(([p, sha]) => sha && typeof hashFile === 'function' && hashFile(p) !== sha)
    .map(([p]) => p);
  return { contracted, touched, outside, untouched, frozenChanged, parked, waived };
}

function handoffFilled(humanText) {
  const body = section(humanText, 'O que a próxima fase deve saber');
  return Boolean(body && !body.includes(HANDOFF_PLACEHOLDER) && body.replace(/[-*_\s]/g, '').length > 20);
}

/**
 * @param {{
 *   phase: { id: string, title: string, requirements?: string[], acceptance?: string[], scope?: string|null, status?: string } | null,
 *   specText: string, roadmapText?: string, plan: any, pack: any, run: any, events: any[],
 *   changes: Array<{status: string, path: string}>, decisions?: any[], notes?: any[], signoffs?: any[],
 * }} input
 */
function buildDossier(input) {
  const phase = input.phase || { id: 'run', title: 'Execução', acceptance: [] };
  const plan = input.plan || { tasks: [], acceptanceTests: [] };
  const run = input.run || {};
  const checks = Array.isArray(run.verification_check_results) ? run.verification_check_results : [];
  const checkById = new Map(checks.map((c) => [c.check_id, c]));
  const criteria = [];
  for (const m of String(input.specText || '').matchAll(/^\|\s*(A\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)) criteria.push({ id: m[1], text: m[2], how: m[3] });
  const inPhase = (id) => !(phase.acceptance && phase.acceptance.length) || phase.acceptance.includes(id);
  const phaseCriteria = criteria.filter((c) => inPhase(c.id));
  const decisions = [...decisionsFromSpec(input.specText), ...(input.decisions || [])];
  const journal = taskJournal(plan, input.events || [], checks);
  const drift = architectureDrift(input.pack, plan, input.changes, input.hashFile, { parkedGlobs: input.parkedGlobs, waivedGlobs: input.waivedGlobs });
  const signoffs = input.signoffs || [];

  // --- techspec: critério → teste congelado → prova → resultado
  const proofRows = [];
  const proofIssues = [];
  const manualPending = [];
  for (const c of phaseCriteria) {
    const accept = (plan.acceptanceTests || []).find((a) => a.criterion === c.id);
    const acceptCheck = checkById.get(`check-accept-${c.id.toLowerCase()}`);
    const criterionCheck = checkById.get(`check-${c.id.toLowerCase()}`);
    const isManual = criterionCheck && criterionCheck.status === 'skip' && criterionCheck.skip_reason === 'needs_structured_check';
    const signed = signoffs.find((s) => (s.criteria || []).includes(c.id));
    let result = acceptCheck ? `${acceptCheck.status}${acceptCheck.tests_executed ? ` (${acceptCheck.tests_executed} testes)` : ''}` : criterionCheck ? criterionCheck.status : 'não verificado';
    if (acceptCheck && acceptCheck.error) result += ` — ${acceptCheck.error}`;
    if (acceptCheck && /proof_not_executed/.test(acceptCheck.error || '')) proofIssues.push(`${c.id}: ${acceptCheck.error}`);
    if (isManual && !signed) { manualPending.push(c.id); result = 'ADIADO — UAT/sign-off pendente'; }
    if (isManual && signed) result = `aceito por ${signed.by} em ${dateOf(signed.at)}`;
    const files = accept ? accept.files.map((f) => (typeof f === 'string' ? f : f.path)).join(', ') : '—';
    const proves = accept && accept.proves && accept.proves.length ? accept.proves.join(' · ') : accept ? 'arquivo inteiro' : '—';
    proofRows.push([c.id, c.text, files, proves, result]);
  }

  const totals = journal.reduce((acc, j) => ({ turns: acc.turns + j.turns, cost: acc.cost + j.cost, attempts: acc.attempts + j.attempts.length }), { turns: 0, cost: 0, attempts: 0 });

  const files = {};
  files['context.md'] = [
    `# Contexto — ${phase.id} · ${phase.title}`,
    '',
    `> Fase ${phase.id} (${phase.status || '—'}) · requisitos ${(phase.requirements || []).join(', ') || '—'} · critérios ${(phase.acceptance || []).join(', ') || '—'}`,
    phase.scope ? `> Escopo: ${phase.scope}` : '',
    '',
    '## Objetivo',
    section(input.specText, 'Objetivo') || '—',
    '',
    '## Critérios de aceite da fase',
    table(['ID', 'Critério', 'Como verificar'], phaseCriteria.map((c) => [c.id, c.text, c.how])),
    '',
    '## Decisões consolidadas',
    table(['ID', 'Decisão', 'Detalhe'], decisions.map((d) => [d.id, d.title || d.decision || '', d.text || d.reason || ''])),
    '',
    '## Riscos e perguntas em aberto',
    section(input.specText, 'Riscos') || '—',
    '',
    '## Fora de escopo',
    section(input.specText, 'Fora de escopo') || '—',
  ].filter((l) => l !== null).join('\n');

  const contractRows = [...drift.contracted.entries()].map(([p, task]) => [p, task, drift.touched.has(p) ? (drift.touched.get(p) === 'A' || drift.touched.get(p) === '??' ? 'Novo' : 'Editado') : 'não tocado']);
  files['architecture.md'] = [
    `# Arquitetura — ${phase.id} · ${phase.title}`,
    '',
    '## Componentes do contrato (IMPLEMENTATION-PACK × diff real)',
    table(['Arquivo', 'Tarefa', 'Situação'], contractRows),
    '',
    '## Fora do contrato (tocados sem estar no pack)',
    drift.outside.length ? drift.outside.map((p) => `- \`${p}\` (${drift.touched.get(p)})`).join('\n') : '_(nenhum)_',
    '',
    '## Testes congelados estacionados (para fases seguintes)',
    drift.parked.length ? drift.parked.map((p) => `- \`${p}\` (${drift.touched.get(p)})`).join('\n') : '_(nenhum)_',
    '',
    '## Fora do contrato aceitos (--accept-drift, registrado)',
    drift.waived.length ? drift.waived.map((p) => `- \`${p}\` (${drift.touched.get(p)})`).join('\n') : '_(nenhum)_',
    '',
    '## Testes de aceite congelados alterados',
    drift.frozenChanged.length ? drift.frozenChanged.map((p) => `- \`${p}\``).join('\n') : '_(nenhum — íntegros)_',
  ].join('\n');

  files['techspec.md'] = [
    `# Techspec — o que deve ser verdade (${phase.id})`,
    '',
    'Cada critério é provado por um teste de aceite **escrito antes da execução e congelado**; "Prova" lista os testes que precisam aparecer como aprovados na saída do runner.',
    '',
    table(['Critério', 'O que deve ser verdade', 'Teste congelado', 'Prova', 'Resultado'], proofRows),
  ].join('\n');

  const diaryBlocks = journal.map((j) => {
    const lines = [`### ${j.task.id} — ${j.task.title} [${j.status}]`, `- **Arquivos:** ${(j.task.files || []).map((f) => `\`${f}\``).join(', ') || '—'}`];
    j.attempts.forEach((a, index) => {
      const tools = Object.entries(a.tools).map(([k, v]) => `${k}×${v}`).join(', ');
      // Numeração sequencial: execuções retomadas (recover) reiniciam o contador do runtime.
      const restarted = index > 0 && a.attempt <= j.attempts[index - 1].attempt ? ' (execução retomada)' : '';
      lines.push(`- Tentativa ${index + 1}${restarted}: ${a.success ? 'executor concluiu' : 'executor falhou'} · ${a.turns} turnos · ${money(a.cost)}${tools ? ` · ${tools}` : ''}${a.error ? ` · erro: ${String(a.error).slice(0, 160)}` : ''}`);
    });
    if (j.failedVerifies) lines.push(`- ⚠ ${j.failedVerifies} verificação(ões) da tarefa reprovada(s) antes de concluir`);
    lines.push(`> **Feito (${dateOf(j.finishedAt)})**: ${j.attempts.length} tentativa(s), ${j.turns} turnos, ${money(j.cost)}${j.tests ? `, ${j.tests} testes de aceite executados` : ''}.`);
    return lines.join('\n');
  });
  files['plan.md'] = [
    `# Plano e diário — ${phase.id} · ${phase.title}`,
    '',
    `> Run \`${run.run_id || '—'}\` · status **${run.status || '—'}** · ${totals.attempts} tentativas · ${totals.turns} turnos · ${money(totals.cost)}`,
    '',
    ...diaryBlocks.flatMap((b) => [b, '']),
    '## Adiados',
    manualPending.length ? manualPending.map((id) => `- **${id}** — critério manual/UAT sem sign-off (\`oxe-cc runtime signoff --phase ${phase.id} --criteria ${id}\`)`).join('\n') : '_(nenhum)_',
  ].join('\n');

  files['decisions.md'] = [
    `# Decisões — ${phase.id}`,
    '',
    'Registro append-only: uma decisão nova substitui (`supersedes`) a anterior; nunca se edita a antiga.',
    '',
    table(['ID', 'Decisão', 'Detalhe', 'Data', 'Dono'], decisions.map((d) => [d.id, d.title || d.decision || '', d.text || d.reason || '', d.at ? dateOf(d.at) : '—', d.by || '—'])),
  ].join('\n');

  files['notes.md'] = [
    `# Notas de implementação — ${phase.id}`,
    '',
    'Desvios, surpresas e trade-offs registrados durante a execução (append-only, revisar antes do close).',
    '',
    (input.notes || []).length ? input.notes.map((n) => `- ${dateOf(n.at)} · ${n.task || '—'} · ${n.text}`).join('\n') : '_(nenhuma)_',
  ].join('\n');

  const issues = [];
  if (drift.outside.length) issues.push(`architecture_drift: tocados fora do contrato: ${drift.outside.join(', ')}`);
  if (drift.frozenChanged.length) issues.push(`acceptance_changed: ${drift.frozenChanged.join(', ')}`);
  issues.push(...proofIssues.map((p) => `proof_not_executed: ${p}`));
  const pending = manualPending.map((id) => `signoff_pending: ${id}`);
  return { files, issues, pending, untouched: drift.untouched, totals };
}

/** Escreve preservando o texto humano fora dos marcadores; plan.md ganha a seção de handoff humana. */
function writeDossierFile(filePath, generated, { withHandoff = false } = {}) {
  const block = `${BEGIN}\n${generated.trimEnd()}\n${END}`;
  let existing = null;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    existing = null;
  }
  let next;
  if (existing && existing.includes(BEGIN) && existing.includes(END)) {
    next = `${existing.slice(0, existing.indexOf(BEGIN))}${block}${existing.slice(existing.indexOf(END) + END.length)}`;
  } else {
    const human = withHandoff ? `\n\n${HANDOFF_HEADING}\n\n${HANDOFF_PLACEHOLDER}\n` : '\n';
    next = `${block}${human}`;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, 'utf8');
  return next;
}

function humanPart(text) {
  const t = String(text || '');
  if (!t.includes(BEGIN) || !t.includes(END)) return t;
  return `${t.slice(0, t.indexOf(BEGIN))}${t.slice(t.indexOf(END) + END.length)}`;
}

module.exports = { buildDossier, writeDossierFile, humanPart, handoffFilled, section, decisionsFromSpec, architectureDrift, BEGIN, END, HANDOFF_HEADING, HANDOFF_PLACEHOLDER };
