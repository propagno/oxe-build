'use strict';

/**
 * OXB-112: decisions as first-class ids — `D-<fase>-<n>` (e.g. D-F2-3), in `.oxe/program/decisions.ndjson`
 * (append-only, the same file spikes write D-SPIKE-Tn to). Tasks cite them in PLAN.json `decisions`; a decision with a
 * `check` command has its evidence verified at the phase verify (an implicit gate `decision-<id>`); the lint points at
 * tasks citing unknown decisions and at decisions of the phase no task cites.
 */

const fs = require('fs');
const path = require('path');

const DECISION_ID_RE = /^D-(?:(?:F\d+|SPIKE)-)?[A-Za-z0-9]+$/;
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
      if (r && r.kind === 'decision_status' && byId.has(r.id)) Object.assign(byId.get(r.id), { status: r.status, status_reason: r.reason, status_at: r.at });
    } catch { /* */ }
  }
  return [...byId.values()];
}

function nextId(existing, phase) {
  const p = phase ? String(phase).toUpperCase() : '';
  const re = p ? new RegExp(`^D-${p}-(\\d+)$`) : /^D-(\d+)$/;
  const max = existing.reduce((m, d) => { const hit = re.exec(String(d.id)); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);
  return p ? `D-${p}-${max + 1}` : `D-${max + 1}`;
}

function add(programDir, input = {}) {
  const title = String(input.title || '').trim();
  if (title.length < 4) throw new Error('informe a decisão em uma frase (--title "…")');
  const existing = list(programDir);
  const record = {
    kind: 'decision',
    id: nextId(existing, input.phase),
    title,
    text: String(input.text || '').trim() || null,
    phase: input.phase || null,
    criteria: (Array.isArray(input.criteria) ? input.criteria : String(input.criteria || '').split(',')).map((c) => c.trim().toUpperCase()).filter(Boolean),
    check: input.check ? String(input.check) : null,
    by: String(input.by || '').trim() || 'usuário',
    at: new Date().toISOString(),
    status: 'active',
  };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(FILE(programDir), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** Lint: unknown decisions cited by tasks (error), decisions of the phase no task cites (warning). */
function lintDecisions(doc, decisions, phase) {
  const errors = [];
  const warnings = [];
  const known = new Set(decisions.map((d) => d.id));
  const cited = new Set();
  for (const t of (doc && doc.tasks) || []) {
    for (const id of (t && t.decisions) || []) {
      cited.add(id);
      if (!known.has(id)) errors.push(`${t.id}: cita a decisão ${id}, que não existe (oxe-cc decision list; registre com oxe-cc decision add)`);
    }
  }
  for (const d of decisions) {
    if (d.status && d.status !== 'active') continue;
    if (/^D-SPIKE-/.test(d.id)) continue;
    if (phase && d.phase && d.phase !== phase) continue;
    if (!cited.has(d.id)) warnings.push(`decisão ${d.id} ("${String(d.title).slice(0, 60)}") não é citada por nenhuma tarefa — cite em PLAN.json "decisions" na tarefa que a implementa`);
  }
  return { errors, warnings };
}

/** Phase-verify gates for the decisions with a `check`, of the phase or cited by its tasks. */
function decisionGates(decisions, doc, phase) {
  const cited = new Set(((doc && doc.tasks) || []).flatMap((t) => (t && t.decisions) || []));
  return decisions
    .filter((d) => d.check && (!d.status || d.status === 'active') && (cited.has(d.id) || (phase && d.phase === phase)))
    .map((d) => ({ id: `decision-${d.id}`, when: 'phase_verify', command: d.check, description: `evidência da decisão ${d.id}: ${d.title}`, on_fail: 'cr_defect' }));
}

module.exports = { DECISION_ID_RE, list, add, nextId, lintDecisions, decisionGates, FILE };
