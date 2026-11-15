'use strict';

/**
 * OXB-112: decisions as first-class ids — `D-<fase>-<n>` (e.g. D-F2-3), in `.oxe/program/decisions.ndjson`
 * (append-only, the same file spikes write D-SPIKE-Tn to). Tasks cite them in PLAN.json `decisions`; a decision with a
 * `check` command has its evidence verified at the phase verify (an implicit gate `decision-<id>`); the lint points at
 * tasks citing unknown decisions and at decisions of the phase no task cites.
 */

const fs = require('fs');
const path = require('path');

const DECISION_ID_RE = /^D-(?:(?:F\d+(?:\.\d+)?|SPIKE)-)?[A-Za-z0-9]+$/;
const FILE = (programDir) => path.join(programDir, 'decisions.ndjson');

function list(programDir) {
  let raw = '';
  try { raw = fs.readFileSync(FILE(programDir), 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && r.kind === 'decision' && r.id) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
      if (r && r.kind === 'decision_status' && byId.has(r.id)) Object.assign(byId.get(r.id), { status: r.status, status_reason: r.reason, status_at: r.at, superseded_by: r.status === 'superseded' ? (r.superseded_by || null) : null });
    } catch { /* */ }
  }
  return [...byId.values()];
}

function nextId(existing, phase) {
  const p = phase ? String(phase).toUpperCase().replace(/[^A-Z0-9.]/g, '') : '';
  const re = p ? new RegExp(`^D-${p.replace(/\./g, '\\.')}-(\\d+)$`) : /^D-(\d+)$/;
  const max = existing.reduce((m, d) => { const hit = re.exec(String(d.id)); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);
  return p ? `D-${p}-${max + 1}` : `D-${max + 1}`;
}

const LINK_RE = /^(https?:\/\/\S+|#\d+|(?:PR|pr)[-#]?\d+|CR-[\w-]+|D-[\w-]+|[\w.-]+\/[\w.-]+#\d+)$/;

/**
 * OXB-182: the alternatives that lost — "texto::motivo[::por::link]" (or objects). The rejection is the author's by
 * default; attributing it to someone else needs a link (issue, PR, CR or another decision).
 */
function parseAlternatives(list, author) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : list ? [list] : []) {
    const a = typeof raw === 'string' ? (([text, reason, by, link]) => ({ text, reason, by, link }))(raw.split('::').map((x) => x.trim())) : { ...raw };
    if (!a.text || String(a.text).length < 3) throw new Error(`alternativa sem texto: ${JSON.stringify(raw)}`);
    if (!a.reason || String(a.reason).length < 4) throw new Error(`alternativa "${a.text}": informe o motivo técnico da recusa (texto::motivo)`);
    const by = a.by ? String(a.by) : author;
    if (by !== author && !(a.link && LINK_RE.test(String(a.link)))) throw new Error(`alternativa "${a.text}": a recusa atribuída a ${by} (não ao autor ${author}) exige um link — issue, PR, CR ou decisão (texto::motivo::por::link)`);
    out.push({ text: String(a.text), reason: String(a.reason), by, link: a.link ? String(a.link) : null });
  }
  return out;
}

const TERM_STOP = new Set(['para', 'com', 'que', 'uma', 'dos', 'das', 'the', 'and', 'with', 'from', 'usar', 'use', 'via']);
const terms = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !TERM_STOP.has(w)));

/** OXB-182: a task whose text matches an alternative already rejected (≥ 60% of the alternative's terms, ≥ 3). */
function rejectedApproachWarnings(doc, decisions) {
  const out = [];
  for (const d of decisions.filter((x) => Array.isArray(x.alternatives) && x.alternatives.length && (!x.status || x.status === 'active'))) {
    for (const alt of d.alternatives) {
      const at = terms(alt.text);
      if (at.size < 3) continue;
      for (const t of (doc && doc.tasks) || []) {
        const tt = terms(`${t.title || ''} ${t.description || ''} ${t.approach || ''}`);
        const hit = [...at].filter((w) => tt.has(w)).length;
        if (hit / at.size >= 0.6) out.push(`${t.id}: propõe "${alt.text}", alternativa já recusada em ${d.id} (${alt.reason}; por ${alt.by}) — reveja a decisão ou cite por que mudou`);
      }
    }
  }
  return out;
}

/** US-n ids of a list or a comma string. */
function storyIds(v) {
  return [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((c) => String(c).trim().toUpperCase()).filter((c) => /^US-\d+$/.test(c)))];
}

function add(programDir, input = {}) {
  const title = String(input.title || '').trim();
  if (title.length < 4) throw new Error('informe a decisão em uma frase (--title "…")');
  const author = String(input.by || '').trim() || 'usuário';
  const alternatives = parseAlternatives(input.alternatives || input.alt, author);
  const existing = list(programDir);
  const supersedes = input.supersedes ? String(input.supersedes).trim() : null;
  if (supersedes) {
    const old = existing.find((d) => d.id === supersedes);
    if (!old) throw new Error(`--supersedes ${supersedes}: decisão inexistente (oxe-cc decision list)`);
    if (old.status && old.status !== 'active') throw new Error(`--supersedes ${supersedes}: a decisão já está ${old.status}`);
  }
  const record = {
    kind: 'decision',
    id: input.id && DECISION_ID_RE.test(String(input.id)) && !existing.some((d) => d.id === input.id) ? String(input.id) : nextId(existing, input.phase),
    title,
    text: String(input.text || '').trim() || null,
    phase: input.phase || null,
    criteria: (Array.isArray(input.criteria) ? input.criteria : String(input.criteria || '').split(',')).map((c) => c.trim().toUpperCase()).filter(Boolean),
    // the user stories the decision touches (US-n): the ADR lists them, and a card reaches its decisions through them
    ...(storyIds(input.stories).length ? { stories: storyIds(input.stories) } : {}),
    check: input.check ? String(input.check) : null,
    by: String(input.by || '').trim() || 'usuário',
    at: input.at ? String(input.at) : new Date().toISOString(),
    status: 'active',
    // ADR sections: why the decision was needed and what it costs (both optional; the title and text carry the rest).
    ...(input.context ? { context: String(input.context).trim() } : {}),
    ...(input.consequences ? { consequences: String(input.consequences).trim() } : {}),
    ...(supersedes ? { supersedes } : {}),
    ...(input.source ? { source: String(input.source) } : {}),
    ...(alternatives.length ? { alternatives } : {}),
  };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(FILE(programDir), `${JSON.stringify(record)}\n`, 'utf8');
  if (supersedes) setStatus(programDir, supersedes, { status: 'superseded', by: record.by, reason: `substituída por ${record.id}`, superseded_by: record.id });
  return record;
}

const STATUSES = ['active', 'superseded', 'retired'];

/**
 * A decision changes status by an appended `decision_status` record (the ledger stays append-only): `superseded`
 * (by another decision, named), `retired` (no longer applies, with the reason) or back to `active`.
 */
function setStatus(programDir, id, input = {}) {
  const status = String(input.status || '').trim();
  if (!STATUSES.includes(status)) throw new Error(`status inválido "${status}" (use ${STATUSES.join(' | ')})`);
  const existing = list(programDir);
  const d = existing.find((x) => x.id === id);
  if (!d) throw new Error(`decisão ${id} inexistente (oxe-cc decision list)`);
  const reason = String(input.reason || '').trim();
  if (status !== 'active' && reason.length < 4) throw new Error(`informe o motivo (--reason "…") para marcar ${id} como ${status}`);
  const superseded_by = input.superseded_by ? String(input.superseded_by) : null;
  if (status === 'superseded' && superseded_by && !existing.some((x) => x.id === superseded_by)) throw new Error(`a decisão substituta ${superseded_by} não existe`);
  const rec = { kind: 'decision_status', id, status, reason: reason || null, by: String(input.by || '').trim() || 'usuário', at: new Date().toISOString(), ...(superseded_by ? { superseded_by } : {}) };
  fs.appendFileSync(FILE(programDir), `${JSON.stringify(rec)}\n`, 'utf8');
  return rec;
}

/**
 * The decisions of a DISCUSS.md table (| D-01 | decisão | data | impacto |) brought into the ledger, keeping their ids
 * (plans cite them as "Decisão vinculada: D-01"). A row marked "(revertida por D-NN)" comes in superseded by D-NN.
 * An id already in the ledger with the same title is skipped; with another title it is reported, never overwritten.
 */
function importDiscuss(programDir, discussText, options = {}) {
  const rows = [];
  for (const line of String(discussText || '').split(/\r?\n/)) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
    const rawId = (cells[1] || '').replace(/\*/g, '').trim().toUpperCase();
    if (cells.length < 4 || !/^D-\d+$/.test(rawId)) continue;
    const [, , text, date, impact] = cells;
    const id = rawId;
    if (!text || /^\(descrição/.test(text)) continue;
    const reverted = /revertida por \*?\*?(D-\d+)\*?\*?/i.exec(line);
    rows.push({ id, title: text.replace(/\*?\(revertida por \*?\*?D-\d+\*?\*?\)\*?/i, '').replace(/[*_]/g, '').trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : null, impact: impact || null, reverted_by: reverted ? reverted[1].toUpperCase() : null });
  }
  const imported = [];
  const skipped = [];
  const conflicts = [];
  for (const r of rows) {
    const existing = list(programDir).find((d) => d.id === r.id);
    if (existing) { (existing.title === r.title ? skipped : conflicts).push(r.id); continue; }
    if (r.title.length < 4) { skipped.push(r.id); continue; }
    imported.push(add(programDir, { id: r.id, title: r.title, text: r.impact ? `Impacto no plano: ${r.impact}` : null, phase: options.phase || null, by: options.by || 'DISCUSS.md', at: r.date ? `${r.date}T00:00:00.000Z` : undefined, source: 'DISCUSS.md' }));
  }
  for (const r of rows.filter((x) => x.reverted_by)) {
    const d = list(programDir).find((x) => x.id === r.id);
    if (d && (!d.status || d.status === 'active') && list(programDir).some((x) => x.id === r.reverted_by)) setStatus(programDir, r.id, { status: 'superseded', reason: `revertida por ${r.reverted_by} (DISCUSS.md)`, by: 'DISCUSS.md', superseded_by: r.reverted_by });
  }
  return { imported: imported.map((d) => d.id), skipped, conflicts };
}

/** Lint: unknown decisions cited by tasks (error), decisions of the phase no task cites (warning). */
function lintDecisions(doc, decisions, phase) {
  const errors = [];
  const warnings = [];
  const known = new Map(decisions.map((d) => [d.id, d]));
  const cited = new Set();
  for (const t of (doc && doc.tasks) || []) {
    for (const id of (t && t.decisions) || []) {
      cited.add(id);
      const d = known.get(id);
      if (!d) errors.push(`${t.id}: cita a decisão ${id}, que não existe (oxe-cc decision list; registre com oxe-cc decision add)`);
      else if (!(t.done || t.status === 'done') && d.status && d.status !== 'active') warnings.push(`${t.id}: cita ${id}, que está ${d.status === 'superseded' ? `substituída${d.superseded_by ? ` por ${d.superseded_by}` : ''}` : 'aposentada'}${d.status_reason ? ` (${d.status_reason})` : ''} — cite a decisão vigente`);
    }
  }
  for (const d of decisions) {
    if (d.status && d.status !== 'active') continue;
    if (/^D-SPIKE-/.test(d.id)) continue;
    if (phase && d.phase && d.phase !== phase) continue;
    if (!cited.has(d.id)) warnings.push(`decisão ${d.id} ("${String(d.title).slice(0, 60)}") não é citada por nenhuma tarefa — cite em PLAN.json "decisions" na tarefa que a implementa`);
  }
  warnings.push(...rejectedApproachWarnings(doc, decisions));
  return { errors, warnings };
}

/** Phase-verify gates for the decisions with a `check`, of the phase or cited by its tasks. */
function decisionGates(decisions, doc, phase) {
  const cited = new Set(((doc && doc.tasks) || []).flatMap((t) => (t && t.decisions) || []));
  return decisions
    .filter((d) => d.check && (!d.status || d.status === 'active') && (cited.has(d.id) || (phase && d.phase === phase)))
    .map((d) => ({ id: `decision-${d.id}`, when: 'phase_verify', command: d.check, description: `evidência da decisão ${d.id}: ${d.title}`, on_fail: 'cr_defect' }));
}

module.exports = { parseAlternatives, rejectedApproachWarnings, DECISION_ID_RE, list, add, setStatus, importDiscuss, STATUSES, nextId, lintDecisions, decisionGates, FILE };
