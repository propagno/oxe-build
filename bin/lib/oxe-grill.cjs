'use strict';

/**
 * 1.21.2 — the grill: the spec's discovery as a decision tree walked one question at a time, each with a recommended
 * answer, until no branch that shapes the v1 is left open. The agent runs the conversation; this module keeps it
 * honest and resumable — every question, answer, fact found in the code, deferral, glossary term and contradiction is
 * an append-only record (grill.ndjson), the state is replayed from it, and `close` refuses while a blocking branch is
 * open, unconfirmed or contradicted. Pure functions over a directory; the CLI glue lives in oxe-operational.
 *
 * Files (next to the SPEC: .oxe/grill/ or .oxe/<session>/spec/grill/):
 *   grill.ndjson — the records;  GRILL.md — the readable projection (rewritten on every change).
 */

const fs = require('fs');
const path = require('path');

/** The tree, in dependency order. `blocking`: must be decided and confirmed before close (per demand type). */
const BRANCHES = [
  { id: 'problem', title: 'Problema e outcome', deps: [], asks: 'qual dor, de quem, como é hoje, qual resultado observável define sucesso' },
  { id: 'personas', title: 'Personas e jornadas', deps: ['problem'], asks: 'quem usa, em que contexto, qual jornada principal e quais secundárias' },
  { id: 'scope', title: 'Escopo (dentro e fora)', deps: ['problem', 'personas'], asks: 'o que entra na v1, o que fica explicitamente fora, o que é v2' },
  { id: 'flows', title: 'Fluxos e estados', deps: ['scope'], asks: 'passos de cada fluxo obrigatório, estados (loading/empty/error/success), transições' },
  { id: 'rules', title: 'Regras de negócio e dados (glossário)', deps: ['flows'], asks: 'regras, cálculos, validações, entidades e campos, termos do domínio com definição única' },
  { id: 'edges', title: 'Bordas e erros', deps: ['flows', 'rules'], asks: 'limites, vazio, concorrência, falhas externas, o que o sistema NÃO pode fazer' },
  { id: 'nfr', title: 'Requisitos não funcionais', deps: ['scope'], asks: 'desempenho, segurança, privacidade/LGPD, acessibilidade, observabilidade, compatibilidade' },
  { id: 'integrations', title: 'Integrações e setup externo', deps: ['scope'], asks: 'sistemas, contratos, credenciais, contas, ambientes, quem provê cada pré-condição' },
  { id: 'rollout', title: 'Rollout, migração e rollback', deps: ['scope', 'integrations'], asks: 'como entra em produção, dados a migrar, feature flag, como voltar atrás' },
  { id: 'metrics', title: 'Métricas (M-n)', deps: ['problem'], asks: 'como medir o outcome, linha de base, meta, onde a métrica é coletada' },
  { id: 'risks', title: 'Riscos (P0/P1/P2)', deps: ['edges', 'nfr', 'integrations', 'rollout'], asks: 'o que pode dar errado, impacto, probabilidade, mitigação; P0/P1 pedem RFC' },
];
const BRANCH_IDS = BRANCHES.map((b) => b.id);

/** Branches that must close per demand type; the others stay available (asked when relevant), not blocking. */
const BLOCKING_BY_TYPE = {
  feature: BRANCH_IDS,
  ui: BRANCH_IDS,
  integração: BRANCH_IDS,
  integracao: BRANCH_IDS,
  migração: BRANCH_IDS,
  migracao: BRANCH_IDS,
  dados: BRANCH_IDS,
  segurança: BRANCH_IDS,
  seguranca: BRANCH_IDS,
  infra: ['problem', 'scope', 'flows', 'edges', 'nfr', 'integrations', 'rollout', 'risks'],
  bugfix: ['problem', 'scope', 'flows', 'edges', 'rollout', 'risks'],
  refactor: ['problem', 'scope', 'flows', 'edges', 'nfr', 'rollout', 'risks'],
  investigação: ['problem', 'scope', 'risks'],
  investigacao: ['problem', 'scope', 'risks'],
};
const TYPES = Object.keys(BLOCKING_BY_TYPE);

const dirFor = (specFile) => path.join(path.dirname(specFile), 'grill');
const fileOf = (dir) => path.join(dir, 'grill.ndjson');

function readRecords(dir) {
  let raw = '';
  try { raw = fs.readFileSync(fileOf(dir), 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function append(dir, rec) {
  fs.mkdirSync(dir, { recursive: true });
  const full = { ...rec, at: rec.at || new Date().toISOString() };
  fs.appendFileSync(fileOf(dir), `${JSON.stringify(full)}\n`, 'utf8');
  return full;
}

/** The descendants of a branch in the tree (branches that depend on it, transitively). */
function dependents(branch) {
  const out = new Set();
  const walk = (b) => { for (const x of BRANCHES) if (x.deps.includes(b) && !out.has(x.id)) { out.add(x.id); walk(x.id); } };
  walk(branch);
  return [...out];
}

/** Replays the records into the current state. */
function replay(records) {
  const st = { started: false, type: null, title: null, questions: new Map(), confirmed: new Set(), terms: new Map(), noTerms: false, conflicts: new Map(), closed: null, seq: 0, cseq: 0, log: [] };
  for (const r of records) {
    if (r.t === 'start') {
      if (st.started) {
        st.questions.clear();
        st.confirmed.clear();
        st.terms.clear();
        st.noTerms = false;
        st.conflicts.clear();
      }
      st.started = true;
      st.type = r.type;
      st.title = r.title || null;
      st.closed = null;
      continue;
    }
    if (r.t === 'ask' || r.t === 'fact') {
      st.seq = Math.max(st.seq, Number(String(r.id).replace(/\D/g, '')) || 0);
      st.questions.set(r.id, {
        id: r.id, branch: r.branch, question: r.question || r.text, options: r.options || [], recommended: r.recommended || null, why: r.why || null,
        affects: r.affects || [], depends: r.depends || [], decision: Boolean(r.decision),
        status: r.t === 'fact' ? 'decided' : 'open', answer: r.t === 'fact' ? r.text : null, decided_by: r.t === 'fact' ? 'code' : null, source: r.source || null, by: null, history: [], ...(r.stale ? { stale: true } : {}),
      });
      if (r.t === 'fact' || r.t === 'ask') st.confirmed.delete(r.branch);
      continue;
    }
    const q = r.id ? st.questions.get(r.id) : null;
    if (r.t === 'answer' && q) {
      const changed = q.status === 'decided' && q.answer !== r.answer;
      if (q.answer != null) q.history.push({ answer: q.answer, decided_by: q.decided_by, at: r.at });
      q.answer = r.answer; q.decided_by = r.decided_by; q.by = r.by || null; q.status = 'decided';
      if (r.source) q.answer_source = r.source;
      if (r.decision != null) q.decision = Boolean(r.decision);
      // an answer that changed reopens what was decided on top of it: the questions that name it, the dependent branches
      if (changed) {
        for (const other of st.questions.values()) {
          if (other.id !== q.id && other.depends.includes(q.id) && other.status === 'decided') { other.status = 'reopened'; other.reopened_by = q.id; }
        }
        st.confirmed.delete(q.branch);
        for (const b of dependents(q.branch)) st.confirmed.delete(b);
      }
      for (const c of st.conflicts.values()) if (!c.resolved && c.ids.includes(q.id)) c.resolved = { by: 'answer', id: q.id, at: r.at };
      st.closed = null;
      continue;
    }
    // a fact that shows the card is behind the code (the code already does what the card asks): grooming input quality
    if (r.t === 'mark' && q) { if (r.stale != null) q.stale = Boolean(r.stale); if (r.late != null) { q.late = Boolean(r.late); q.late_at = r.late_at || null; } continue; }
    if (r.t === 'defer' && q) { q.status = 'deferred'; q.reason = r.reason; st.confirmed.delete(q.branch); continue; }
    if (r.t === 'confirm') { st.confirmed.add(r.branch); continue; }
    if (r.t === 'term') {
      if (r.none) st.noTerms = true;
      else st.terms.set(String(r.term).toLowerCase(), { term: r.term, definition: r.definition, synonyms: r.synonyms || [], source: r.source || null });
      continue;
    }
    if (r.t === 'conflict') { st.cseq += 1; st.conflicts.set(r.cid, { id: r.cid, ids: r.ids, note: r.note, resolved: null }); st.closed = null; continue; }
    if (r.t === 'resolve' && st.conflicts.has(r.cid)) { st.conflicts.get(r.cid).resolved = { by: 'note', note: r.note, at: r.at }; continue; }
    if (r.t === 'close') { st.closed = { at: r.at, by: r.by }; continue; }
  }
  return st;
}

function blockingOf(st) {
  return BLOCKING_BY_TYPE[st.type] || BRANCH_IDS;
}

/** Coverage per branch and what blocks the close. */
function status(dir) {
  const st = replay(readRecords(dir));
  const blocking = blockingOf(st);
  const branches = BRANCHES.map((b) => {
    const qs = [...st.questions.values()].filter((q) => q.branch === b.id);
    const open = qs.filter((q) => q.status === 'open' || q.status === 'reopened');
    const decided = qs.filter((q) => q.status === 'decided');
    const depsOk = b.deps.every((d) => !blocking.includes(d) || st.confirmed.has(d));
    return {
      id: b.id, title: b.title, blocking: blocking.includes(b.id), deps: b.deps, asks: b.asks,
      questions: qs.length, decided: decided.length, deferred: qs.filter((q) => q.status === 'deferred').length, open: open.map((q) => q.id),
      confirmed: st.confirmed.has(b.id), ready: depsOk,
    };
  });
  const blockers = [];
  if (!st.started) blockers.push('grill não iniciado (oxe-cc grill start --type <tipo>)');
  for (const b of branches.filter((x) => x.blocking)) {
    if (b.open.length) blockers.push(`${b.id}: pergunta(s) em aberto ${b.open.join(', ')}`);
    else if (!b.decided) blockers.push(`${b.id}: nenhuma decisão registrada (${b.asks})`);
    else if (!b.confirmed) blockers.push(`${b.id}: falta o playback confirmado pelo usuário (oxe-cc grill confirm ${b.id})`);
  }
  for (const c of st.conflicts.values()) if (!c.resolved) blockers.push(`${c.id}: contradição entre ${c.ids.join(' e ')} — ${c.note || 'sem nota'} (responda de novo uma delas ou oxe-cc grill resolve ${c.id} --note "…")`);
  if (blocking.includes('rules') && !st.terms.size && !st.noTerms) blockers.push('glossário vazio: registre os termos do domínio (oxe-cc grill term "<termo>" --definition "…") ou declare que não há (--none)');
  const next = branches.find((b) => (b.open.length || !b.confirmed) && b.ready && (b.blocking || b.questions)) || null;
  return {
    started: st.started, type: st.type, title: st.title, closed: st.closed,
    branches, blockers, next_branch: next ? next.id : null,
    assumptions: [...st.questions.values()].filter((q) => q.status === 'deferred').map((q) => ({ id: q.id, branch: q.branch, question: q.question, reason: q.reason || null })),
    decisions: [...st.questions.values()].filter((q) => q.decision && q.status === 'decided').map((q) => ({ id: q.id, branch: q.branch, question: q.question, answer: q.answer, alternatives: q.options.filter((o) => o !== q.answer), why: q.why, decided_by: q.decided_by, affects: q.affects })),
    terms: [...st.terms.values()],
    questions: [...st.questions.values()],
    conflicts: [...st.conflicts.values()],
  };
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Jira / ALM item kinds the refine and the intake use, mapped to the grill's own (OxeSpace 14/11: `grill start
 * --type task --card OXE-137` was refused). A task is generic work: it gets the feature tree, the most complete.
 */
const KIND_ALIASES = { story: 'feature', 'história': 'feature', historia: 'feature', task: 'feature', tarefa: 'feature', subtask: 'feature', epic: 'feature', 'épico': 'feature', bug: 'bugfix', defect: 'bugfix', defeito: 'bugfix', spike: 'investigação', investigacao: 'investigação', migracao: 'migração', integracao: 'integração', seguranca: 'segurança' };

function start(dir, input = {}) {
  const raw = String(input.type || 'feature').toLowerCase();
  const type = BLOCKING_BY_TYPE[raw] ? raw : KIND_ALIASES[raw] || raw;
  if (!BLOCKING_BY_TYPE[type]) throw new Error(`tipo "${input.type}" desconhecido (feature | bugfix | refactor | investigação | migração | integração | infra | dados | ui | segurança; do ALM: story | task | bug | epic | spike)`);
  const st = replay(readRecords(dir));
  if (st.started && !input.restart) return { resumed: true, type: st.type, ...status(dir) };
  append(dir, { t: 'start', type, title: input.title || null });
  return { resumed: false, type, ...status(dir) };
}

const branchOf = (b) => {
  const id = String(b || '').toLowerCase();
  if (!BRANCH_IDS.includes(id)) throw new Error(`ramo "${b}" desconhecido (${BRANCH_IDS.join(' | ')})`);
  return id;
};
// options / synonyms: "a | b | c" (or ";"), so an option can carry commas
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/\s*[|;]\s*/)).map((s) => String(s).trim()).filter(Boolean);
const ids = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim().toUpperCase()).filter(Boolean);

function requireStarted(dir) {
  const st = replay(readRecords(dir));
  if (!st.started) throw new Error('grill não iniciado: oxe-cc grill start --type <feature|bugfix|ui|…>');
  return st;
}

/** Records the question the agent is about to ask (with the recommended answer). */
function ask(dir, input = {}) {
  const st = requireStarted(dir);
  const branch = branchOf(input.branch);
  const question = String(input.question || '').trim();
  if (question.length < 8) throw new Error('informe a pergunta (--question "…")');
  if (!input.recommended) throw new Error('toda pergunta do grill traz a resposta recomendada (--recommended "…" --why "…")');
  const options = list(input.options);
  const id = `Q-${st.seq + 1}`;
  const deps = ids(input.depends);
  for (const d of deps) if (!st.questions.has(d)) throw new Error(`--depends ${d}: pergunta inexistente`);
  append(dir, { t: 'ask', id, branch, question, options, recommended: String(input.recommended).trim(), why: input.why ? String(input.why).trim() : null, affects: ids(input.affects), depends: deps, decision: Boolean(input.decision) });
  return { id, branch, question, options, recommended: String(input.recommended).trim(), why: input.why ? String(input.why).trim() : null };
}

/** The user's answer: "ok" / "recomendada" takes the recommended one; a number picks an option; any other text is used as is. */
function answer(dir, id, input = {}) {
  const st = requireStarted(dir);
  const q = st.questions.get(String(id).toUpperCase());
  if (!q) throw new Error(`${id}: pergunta inexistente (oxe-cc grill status)`);
  const raw = String(input.text != null ? input.text : input.choice != null ? input.choice : '').trim();
  if (!raw) throw new Error('informe a resposta (--choice ok|<n> ou --text "…")');
  let value = raw;
  let decidedBy = 'user';
  if (/^(ok|sim|recomendad[ao]|rec)$/i.test(raw)) { value = q.recommended; decidedBy = 'recommended'; } else if (/^\d+$/.test(raw) && q.options[Number(raw) - 1]) value = q.options[Number(raw) - 1];
  if (value === q.recommended && decidedBy === 'user') decidedBy = 'recommended';
  append(dir, { t: 'answer', id: q.id, answer: value, decided_by: decidedBy, by: input.by || null, ...(input.source ? { source: String(input.source) } : {}), ...(input.decision != null ? { decision: Boolean(input.decision) } : {}) });
  const after = status(dir);
  const reopened = after.questions.filter((x) => x.status === 'reopened' && x.reopened_by === q.id).map((x) => x.id);
  return { id: q.id, answer: value, decided_by: decidedBy, source: input.source ? String(input.source) : null, changed: q.status === 'decided' && q.answer !== value, reopened, next_branch: after.next_branch };
}

/** An answer the code / artifacts already give: recorded with its source, never asked. */
function fact(dir, input = {}) {
  const st = requireStarted(dir);
  const branch = branchOf(input.branch);
  const text = String(input.text || '').trim();
  if (text.length < 4) throw new Error('informe o fato (--text "…")');
  if (!input.source) throw new Error('um fato do grill cita a fonte (--source "src/x.ts:12" ou "SPEC.md")');
  const id = `Q-${st.seq + 1}`;
  append(dir, { t: 'fact', id, branch, question: input.question ? String(input.question) : text, text, source: String(input.source), affects: ids(input.affects), decision: Boolean(input.decision), ...(input.stale ? { stale: true } : {}) });
  return { id, branch, text, source: String(input.source) };
}

/** Marks a recorded fact: --stale = the card is behind the code (it asks for what the code already does). */
function mark(dir, id, input = {}) {
  const st = requireStarted(dir);
  const q = st.questions.get(String(id).toUpperCase());
  if (!q) throw new Error(`${id}: pergunta ou fato inexistente`);
  if (q.decided_by !== 'code') throw new Error(`${q.id}: só um fato (grill fact) pode ser marcado (card defasado ou achado tarde)`);
  // --late <etapa>: a fact the grooming did not find, found later (planning, execution, HML): grill depth
  if (input.late) {
    append(dir, { t: 'mark', id: q.id, late: true, late_at: String(input.late) === 'true' ? null : String(input.late) });
    return { id: q.id, late: true, late_at: String(input.late) === 'true' ? null : String(input.late) };
  }
  append(dir, { t: 'mark', id: q.id, stale: input.stale !== false });
  return { id: q.id, stale: input.stale !== false };
}

function defer(dir, id, input = {}) {
  const st = requireStarted(dir);
  const q = st.questions.get(String(id).toUpperCase());
  if (!q) throw new Error(`${id}: pergunta inexistente`);
  if (!input.reason) throw new Error('adiar exige o motivo (--reason "…"): vira suposição explícita na SPEC');
  append(dir, { t: 'defer', id: q.id, reason: String(input.reason) });
  return { id: q.id, deferred: true };
}

/** The playback of a branch, confirmed by the user. */
function confirm(dir, branch, input = {}) {
  requireStarted(dir);
  const b = branchOf(branch);
  const s = status(dir).branches.find((x) => x.id === b);
  if (s.open.length) throw new Error(`${b}: responda ou adie ${s.open.join(', ')} antes do playback`);
  if (!s.decided && !input.empty) throw new Error(`${b}: nenhuma decisão registrada — pergunte (${s.asks}) ou confirme que não se aplica (--empty)`);
  if (!s.ready) {
    const all = status(dir).branches;
    throw new Error(`${b}: confirme antes ${s.deps.filter((d) => all.find((x) => x.id === d).blocking && !all.find((x) => x.id === d).confirmed).join(', ')}`);
  }
  // "does not apply" is itself a recorded answer, so the coverage stays measured
  if (input.empty && !s.decided) {
    append(dir, { t: 'fact', id: `Q-${replay(readRecords(dir)).seq + 1}`, branch: b, question: `${b}: não se aplica`, text: input.reason ? `não se aplica: ${input.reason}` : 'não se aplica a esta demanda', source: 'usuário' });
  }
  // Bench B06/B09: branches were confirmed with no playback shown to the user. The confirmation carries the playback
  // (the 3-5 line summary the user confirmed); "does not apply" (--empty) needs none.
  const playback = String(input.playback || '').trim();
  if (!input.empty && playback.length < 20) throw new Error(`${b}: confirmar um ramo exige o playback que o usuário confirmou (--playback "resumo do ramo em 3-5 linhas"). Mostre o resumo, espere o OK e só então confirme.`);
  append(dir, { t: 'confirm', branch: b, by: input.by || null, ...(playback ? { playback } : {}) });
  return { branch: b, confirmed: true, next_branch: status(dir).next_branch };
}

function term(dir, input = {}) {
  requireStarted(dir);
  if (input.none) { append(dir, { t: 'term', none: true }); return { none: true }; }
  const t = String(input.term || '').trim();
  if (!t) throw new Error('informe o termo: oxe-cc grill term "<termo>" --definition "…" [--synonyms "a|b"]');
  if (!input.definition || String(input.definition).trim().length < 4) throw new Error(`${t}: informe a definição (--definition "…")`);
  const synonyms = list(input.synonyms);
  append(dir, { t: 'term', term: t, definition: String(input.definition).trim(), synonyms, source: input.source || null });
  return { term: t, synonyms };
}

function conflict(dir, input = {}) {
  const st = requireStarted(dir);
  const qs = ids(input.ids);
  if (qs.length < 2) throw new Error('uma contradição envolve duas perguntas: oxe-cc grill conflict Q-3,Q-7 --note "…"');
  for (const q of qs) if (!st.questions.has(q)) throw new Error(`${q}: pergunta inexistente`);
  const cid = `C-${st.cseq + 1}`;
  append(dir, { t: 'conflict', cid, ids: qs, note: input.note ? String(input.note) : null });
  return { id: cid, ids: qs };
}

function resolve(dir, cid, input = {}) {
  const st = requireStarted(dir);
  const c = st.conflicts.get(String(cid).toUpperCase());
  if (!c) throw new Error(`${cid}: contradição inexistente`);
  if (!input.note) throw new Error('informe como foi resolvida (--note "…")');
  append(dir, { t: 'resolve', cid: c.id, note: String(input.note) });
  return { id: c.id, resolved: true };
}

function close(dir, input = {}) {
  const s = status(dir);
  if (s.blockers.length) throw Object.assign(new Error(`grill ainda aberto:\n  - ${s.blockers.join('\n  - ')}`), { blockers: s.blockers });
  append(dir, { t: 'close', by: input.by || null });
  return { closed: true, decisions: s.decisions.length, assumptions: s.assumptions.length, terms: s.terms.length };
}

// ── projections ──────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function renderMarkdown(s) {
  const out = ['# Grill — sessão de descoberta', '', `Tipo: **${s.type || '—'}**${s.title ? ` · ${s.title}` : ''} · ${s.closed ? `fechado em ${s.closed.at.slice(0, 10)}` : 'aberto'}`, '', '<!-- gerado por oxe-cc grill; não edite: o registro é .oxe/grill/grill.ndjson -->', ''];
  out.push('## Cobertura', '', '| Ramo | Obrigatório | Decididas | Em aberto | Adiadas | Playback |', '|---|---|---|---|---|---|');
  for (const b of s.branches) out.push(`| ${b.title} | ${b.blocking ? 'sim' : 'não'} | ${b.decided} | ${b.open.join(', ') || '—'} | ${b.deferred || '—'} | ${b.confirmed ? '✓' : '—'} |`);
  out.push('');
  if (s.blockers.length) out.push('## O que falta para fechar', '', ...s.blockers.map((b) => `- ${b}`), '');
  for (const b of s.branches) {
    const qs = s.questions.filter((q) => q.branch === b.id);
    if (!qs.length) continue;
    out.push(`## ${b.title}`, '');
    for (const q of qs) {
      const st = { decided: q.decided_by === 'code' ? 'fato do código' : q.decided_by === 'recommended' ? 'recomendada aceita' : 'decidida pelo usuário', open: 'em aberto', reopened: `reaberta por ${q.reopened_by}`, deferred: 'adiada' }[q.status];
      out.push(`- **${q.id}** ${q.question}${q.decision ? ' _(decisão → ADR)_' : ''}`);
      if (q.recommended) out.push(`  - Recomendada: ${q.recommended}${q.why ? ` — ${q.why}` : ''}`);
      if (q.answer != null) out.push(`  - Resposta: ${q.answer} (${st}${q.source ? `; fonte: ${q.source}` : ''})`);
      else out.push(`  - Situação: ${st}${q.reason ? ` — ${q.reason}` : ''}`);
      if (q.affects.length) out.push(`  - Afeta: ${q.affects.join(', ')}`);
    }
    out.push('');
  }
  if (s.terms.length) out.push('## Glossário', '', '| Termo | Definição | Sinônimos proibidos |', '|---|---|---|', ...s.terms.map((t) => `| ${esc(t.term)} | ${esc(t.definition)} | ${esc(t.synonyms.join(', ')) || '—'} |`), '');
  if (s.assumptions.length) out.push('## Suposições (perguntas adiadas)', '', ...s.assumptions.map((a) => `- ${a.id} (${a.branch}): ${a.question}${a.reason ? ` — ${a.reason}` : ''}`), '');
  return `${out.join('\n')}\n`;
}

function writeProjection(dir) {
  const s = status(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'GRILL.md'), renderMarkdown(s), 'utf8');
  return s;
}

const GLOSSARY_BEGIN = '<!-- oxe:glossary:begin -->';
const GLOSSARY_END = '<!-- oxe:glossary:end -->';

/** .oxe/GLOSSARY.md: the grill's terms between markers; human text outside them is kept. */
function writeGlossary(file, terms) {
  const table = ['| Termo | Definição | Sinônimos proibidos | Fonte |', '|---|---|---|---|', ...terms.map((t) => `| ${esc(t.term)} | ${esc(t.definition)} | ${esc(t.synonyms.join(', ')) || '—'} | ${esc(t.source || 'grill')} |`)].join('\n');
  const block = `${GLOSSARY_BEGIN}\n${table}\n${GLOSSARY_END}`;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
  const bIdx = text ? text.indexOf(GLOSSARY_BEGIN) : -1;
  const eIdx = text ? text.indexOf(GLOSSARY_END) : -1;
  if (!text) text = `# Glossário do domínio\n\nUm termo, uma definição. SPEC, PRD, código e testes usam o termo da primeira coluna; os sinônimos proibidos não aparecem.\n\n${block}\n`;
  else if (bIdx >= 0 && eIdx > bIdx) text = `${text.slice(0, bIdx)}${block}${text.slice(eIdx + GLOSSARY_END.length)}`;
  else text = `${text.replace(/\s*$/, '')}\n\n${block}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return { file, terms: terms.length };
}

/** Terms of GLOSSARY.md (any table with Termo | Definição …). */
function readGlossary(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const cells = trimmed.startsWith('|')
      ? trimmed.replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
      : null;
    if (!cells || cells.length < 2 || /^termo$/i.test(cells[0]) || /^-{3,}$/.test(cells[0].replace(/:/g, ''))) continue;
    out.push({ term: cells[0], definition: cells[1], synonyms: cells[2] && cells[2] !== '—' ? cells[2].split(',').map((s) => s.trim()).filter(Boolean) : [] });
  }
  return out;
}

/**
 * 1.21.2 (jornada, item 18): does what the grill closed ask for an RFC before the plan? A P0/P1 criterion in the SPEC
 * (the Risco column), a risk decided as P0/P1 in the risks branch, or a decision that brings a new component
 * (service, module, queue, database, dependency). Read only: the draft itself is `oxe-cc rfc new --title "…"`.
 * @param {ReturnType<typeof status>} s the grill status
 * @param {string} [specText]
 * @returns {{ needed: boolean, risky: string[], components: string[], reasons: string[], title: string }}
 */
const NEW_COMPONENT_RE = /\b(?:nov[oa]s?\s+(?:componente|servi[çc]o|m[óo]dulo|microsservi[çc]o|banco(?:\s+de\s+dados)?|fila|depend[êe]ncia|biblioteca|integra[çc][ãa]o|api|tabela)|(?:componente|servi[çc]o|m[óo]dulo)\s+nov[oa]|new\s+(?:component|service|module|queue|database|dependency))\b/i;
function rfcSuggestion(s, specText = '') {
  const out = { needed: false, risky: [], components: [], reasons: [], title: '' };
  if (!s || !s.closed) return out;
  try { out.risky = [...require('./oxe-risk-decision.cjs').criterionRisks(String(specText || '')).entries()].filter(([, r]) => /^P[01]$/.test(String(r))).map(([a]) => a); } catch { out.risky = []; }
  const decisions = Array.isArray(s.decisions) ? s.decisions : [];
  const riskDecided = decisions.filter((d) => d.branch === 'risks' && /\bP[01]\b/.test(`${d.answer || ''}`));
  out.components = decisions.filter((d) => NEW_COMPONENT_RE.test(`${d.question || ''} ${d.answer || ''}`)).map((d) => d.id);
  if (out.risky.length) out.reasons.push(`critério(s) de risco ${out.risky.join(', ')}`);
  if (riskDecided.length) out.reasons.push(`risco P0/P1 decidido no grill (${riskDecided.map((d) => d.id).join(', ')})`);
  if (out.components.length) out.reasons.push(`componente novo decidido no grill (${out.components.join(', ')})`);
  out.needed = out.reasons.length > 0;
  out.title = s.title ? String(s.title) : 'proposta técnica';
  return out;
}

module.exports = {
  BRANCHES, BRANCH_IDS, BLOCKING_BY_TYPE, TYPES, dirFor, readRecords, replay, status, start, ask, answer, fact, mark, defer, confirm, term, conflict, resolve, close,
  renderMarkdown, writeProjection, writeGlossary, readGlossary, dependents, rfcSuggestion,
};
