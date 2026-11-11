'use strict';

/**
 * OXB-125: the executor's question channel. When the contract is ambiguous the executor calls `ask_orchestrator`
 * ({question, options, default, blocking}) instead of guessing. The orchestrator answers here, in this order:
 *   1. a person already answered the same question (questions.ndjson) → that answer;
 *   2. an active decision (decisions.ndjson) names one of the options and shares the question's terms → that option,
 *      with the decision id as the source;
 *   3. blocking, or the question touches a term in `execute.interrupt_on` → queued as Q-n; the task stops with
 *      `waiting_answer` (no retry) until `oxe-cc runtime questions answer Q-n --answer "…"`;
 *   4. otherwise → the executor's default, recorded as a provisional decision (by: executor) a person can revise.
 * Everything lands in `.oxe/program/questions.ndjson` (append-only).
 */

const fs = require('fs');
const path = require('path');
const decisions = require('./oxe-decisions.cjs');

const FILE = (programDir) => path.join(programDir, 'questions.ndjson');
const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'em', 'no', 'na', 'um', 'uma', 'que', 'para', 'por', 'com', 'se', 'the', 'of', 'to', 'and', 'or', 'in', 'is', 'should', 'deve', 'qual', 'which', 'what', 'how', 'como']);
const terms = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9_]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function list(programDir) {
  let raw = '';
  try { raw = fs.readFileSync(FILE(programDir), 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind === 'question') byId.set(r.id, { ...r });
      else if (r.kind === 'answer' && byId.has(r.id)) Object.assign(byId.get(r.id), { status: 'answered', answer: r.answer, answered_by: r.by, answered_at: r.at, decision: r.decision || null });
    } catch { /* */ }
  }
  return [...byId.values()];
}

function append(programDir, rec) {
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(FILE(programDir), `${JSON.stringify(rec)}\n`, 'utf8');
}

function nextId(existing) {
  return `Q-${existing.reduce((m, q) => { const hit = /^Q-(\d+)$/.exec(String(q.id)); return hit ? Math.max(m, Number(hit[1])) : m; }, 0) + 1}`;
}

/** The decision that answers the question: names one option and shares ≥ 2 terms (or 1 when the question is short). */
function fromDecisions(q, ds) {
  const qt = terms(q.question);
  for (const d of ds.filter((x) => x && x.status !== 'revoked' && x.status !== 'superseded')) {
    const body = `${d.title || ''} ${d.text || ''}`;
    const bt = terms(body);
    const shared = [...qt].filter((w) => bt.has(w)).length;
    if (shared < Math.min(2, qt.size)) continue;
    const lower = norm(body);
    const hits = (q.options || []).filter((o) => o && lower.includes(norm(o)));
    if (hits.length === 1) return { answer: hits[0], source: d.id };
  }
  return null;
}

function resolve(programDir, q, options = {}) {
  const existing = list(programDir);
  const at = new Date().toISOString();
  const same = existing.find((x) => norm(x.question) === norm(q.question) && x.status === 'answered');
  if (same) return { answer: same.answer, source: same.id, provisional: false };
  const byDecision = fromDecisions(q, decisions.list(programDir));
  if (byDecision) {
    const id = nextId(existing);
    append(programDir, { kind: 'question', id, ...q, run_id: options.runId || null, at, status: 'answered' });
    append(programDir, { kind: 'answer', id, answer: byDecision.answer, by: `decision:${byDecision.source}`, decision: byDecision.source, at });
    return { ...byDecision, provisional: false, id };
  }
  const interrupt = (options.interruptOn || []).map((t) => String(t).toLowerCase());
  const qt = terms(q.question);
  const forced = interrupt.find((t) => qt.has(t) || norm(q.question).includes(t));
  const pending = existing.find((x) => norm(x.question) === norm(q.question) && x.status === 'waiting');
  if (q.blocking || forced || !q.default) {
    if (pending) return { wait: true, id: pending.id };
    const id = nextId(existing);
    append(programDir, { kind: 'question', id, ...q, run_id: options.runId || null, at, status: 'waiting', why: q.blocking ? 'blocking' : forced ? `interrupt_on:${forced}` : 'sem default' });
    return { wait: true, id };
  }
  const id = nextId(existing);
  const d = decisions.add(programDir, { title: `${q.question} → ${q.default}`, text: `Provisória: o executor seguiu o default sem resposta nos artefatos. Opções: ${(q.options || []).join(' | ')}`, phase: options.phase || null, by: 'executor (provisória)' });
  append(programDir, { kind: 'question', id, ...q, run_id: options.runId || null, at, status: 'answered' });
  append(programDir, { kind: 'answer', id, answer: q.default, by: 'executor:default', decision: d.id, provisional: true, at });
  return { answer: q.default, source: d.id, provisional: true, id };
}

function answer(programDir, id, text, by, phase) {
  const q = list(programDir).find((x) => x.id === id);
  if (!q) throw new Error(`pergunta ${id} não existe`);
  if (q.status === 'answered') throw new Error(`${id} já foi respondida: ${q.answer}`);
  const a = String(text || '').trim();
  if (!a) throw new Error('informe a resposta (--answer "…")');
  const d = decisions.add(programDir, { title: `${q.question} → ${a}`, text: `Resposta a ${id}${q.task ? ` (${q.task})` : ''}`, phase: phase || null, by: by || 'usuário' });
  append(programDir, { kind: 'answer', id, answer: a, by: by || 'usuário', decision: d.id, at: new Date().toISOString() });
  return { id, answer: a, decision: d.id };
}

module.exports = { list, resolve, answer, fromDecisions, FILE };
