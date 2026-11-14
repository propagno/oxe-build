'use strict';

/**
 * 1.21.2 — grooming of a Jira card (user request 14/11: "exercite o grooming também … é um exercício importante para
 * medir a qualidade do input e output"). Each card has its own grill (`grill … --card OXE-n`, .oxe/alm/grill/OXE-n/);
 * this module renders the card's "Grooming (OXE)" comment (questions, recommended answers, answers with their source)
 * and measures the quality of the input (the original card) and of the output (the spec).
 *
 * Answer sources, as the coordination tags them: "decisão registrada …" (a user decision already on record),
 * "coordenação …" (a technical judgment of the coordination), "sem base …" (left to the user), or a fact found in the
 * card or the code (grill fact). Pure functions.
 */

const MARKER = 'Grooming (OXE)';

const sourceKind = (q) => {
  if (q.decided_by === 'code') return /card|coment[áa]rio|descri/i.test(String(q.source || '')) ? 'card' : 'code';
  const s = String(q.answer_source || '').toLowerCase();
  if (/decis[ãa]o registrada|decis[ãa]o do usu[áa]rio/.test(s)) return 'user_decision';
  if (/coordena/.test(s)) return 'coordination';
  if (/sem base/.test(s)) return 'no_basis';
  if (q.status === 'deferred') return 'no_basis';
  if (q.status === 'decided') return q.decided_by === 'recommended' ? 'recommended' : 'other';
  return 'open';
};

/** The text of the card's grooming comment. */
function renderComment(key, status) {
  const L = [`${MARKER} — ${key}`, ''];
  const all = status.questions || [];
  // a fact (what the card or the code already says) is not a question: listed apart, never counted as one
  const facts = all.filter((q) => q.decided_by === 'code');
  const qs = all.filter((q) => q.decided_by !== 'code');
  const answered = qs.filter((q) => q.status === 'decided').length;
  const openQs = qs.filter((q) => q.status === 'open' || q.status === 'reopened').length;
  // OXB-G12: facts first, apart, each with its source; they are never questions and never "em aberto"
  if (facts.length) {
    L.push(`Fatos (fonte): ${facts.length} — o que o card, o código e os documentos já respondem, sem perguntar`);
    for (const f of facts) L.push(`- ${f.stale ? '[card defasado] ' : ''}${f.answer || f.question}${f.source ? ` — fonte: ${f.source}` : ''}`);
    L.push('');
  }
  L.push(qs.length ? `Perguntas: ${qs.length} (${answered} respondida(s), ${openQs} em aberto${qs.length - answered - openQs ? `, ${qs.length - answered - openQs} adiada(s)` : ''})` : 'Perguntas: nenhuma (os fatos acima respondem o card).');
  L.push('');
  for (const q of qs) {
    L.push(`${key}/${q.id} (${q.branch}) ${q.question}`);
    if (q.recommended) L.push(`- Recomendada: ${q.recommended}${q.why ? ` — ${q.why}` : ''}`);
    if (q.status === 'decided') L.push(`- Resposta: ${q.answer}${q.answer_source ? ` [${q.answer_source}]` : ' [fonte não registrada]'}`);
    else if (q.status === 'deferred') L.push(`- Adiada: ${q.reason || 'sem motivo'} (vira suposição no spec)`);
    else L.push('- Aguardando resposta');
    L.push('');
  }
  L.push(openQs ? `${openQs} pergunta(s) aguardando resposta.` : 'Todas respondidas: o card segue para o refine.');
  return L.join('\n');
}

/**
 * Quality per card and in total. `cards`: [{ key, status (grill status), criteria (refined CA list) | null, lint (refine
 * lint result) | null }].
 */
function report(cards) {
  const rows = cards.map((c) => {
    const qs = (c.status && c.status.questions) || [];
    const by = { card: 0, code: 0, user_decision: 0, coordination: 0, no_basis: 0, recommended: 0, other: 0, open: 0 };
    for (const q of qs) by[sourceKind(q)] += 1;
    // a question the card or the code already answered is grill noise (it should have been a fact, not asked)
    const noise = qs.filter((q) => q.decided_by !== 'code' && /\b(card|c[óo]digo|descri[çc][ãa]o)\s+(j[áa]\s+)?(diz|dizia|responde|respondia|mostra|faz|tem)\b/i.test(String(q.answer_source || ''))).length;
    return {
      key: c.key,
      // asked questions only; a fact (from the card or the code) was answered without asking
      questions: qs.filter((q) => q.decided_by !== 'code').length,
      facts_from_card: by.card,
      facts_from_code: by.code,
      // input quality: the card asks for what the code already does (a fact marked --stale)
      stale_vs_code: qs.some((q) => q.decided_by === 'code' && q.stale),
      // grill depth: facts the grooming did not find, found later (planning, execution, HML)
      found_late: qs.filter((q) => q.decided_by === 'code' && q.late).map((q) => q.late_at || 'depois'),
      answered_by_user_decision: by.user_decision,
      answered_by_coordination: by.coordination,
      no_basis: by.no_basis,
      recommended_accepted: by.recommended,
      // the quality of the grill's recommendation: answered with it, or with another answer
      rec_kept: qs.filter((q) => q.status === 'decided' && q.decided_by === 'recommended').length,
      rec_changed: qs.filter((q) => q.status === 'decided' && q.decided_by === 'user' && q.recommended).length,
      open: by.open,
      noise,
      criteria: c.criteria ? c.criteria.length : null,
      criteria_with_test: c.criteria ? c.criteria.filter((x) => x.test && !/a confirmar/i.test(x.test)).length : null,
      lint_ok: c.lint ? c.lint.ok : null,
      lint_errors: c.lint ? c.lint.errors.length : null,
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const total = { cards: rows.length, questions: sum('questions'), facts: sum('facts_from_card') + sum('facts_from_code'), user_decision: sum('answered_by_user_decision'), coordination: sum('answered_by_coordination'), no_basis: sum('no_basis'), open: sum('open'), noise: sum('noise'), stale: rows.filter((r) => r.stale_vs_code).length, found_late: rows.reduce((a, r) => a + r.found_late.length, 0), rec_kept: sum('rec_kept'), rec_changed: sum('rec_changed'), criteria: sum('criteria'), lint_failed: rows.filter((r) => r.lint_ok === false).length };
  return { total, rows };
}

function renderReport(r, ctx = {}) {
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const t = r.total;
  const L = ['# Qualidade do grooming', '', `${t.cards} card(s) · gerado em ${ctx.at || new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];
  L.push('## Resumo', '');
  L.push(`- **Perguntas:** ${t.questions} (${t.cards ? (t.questions / t.cards).toFixed(1) : 0} por card).`);
  L.push(`- **Respondidas pelo próprio card ou pelo código** (fatos, sem perguntar): ${t.facts}. **Ruído** (perguntado, mas o card ou o código já respondia): ${t.noise}.`);
  L.push(`- **Por decisão registrada do usuário:** ${t.user_decision} (${pct(t.user_decision, t.questions)}). **Por julgamento da coordenação:** ${t.coordination} (${pct(t.coordination, t.questions)}). **Sem base (para o usuário):** ${t.no_basis} (${pct(t.no_basis, t.questions)}). **Em aberto:** ${t.open}.`);
  L.push(`- **Card defasado em relação ao código** (pede o que o código já faz): ${t.stale} card(s)${t.stale ? ` (${r.rows.filter((x) => x.stale_vs_code).map((x) => x.key).join(', ')})` : ''}.`);
  L.push(`- **Profundidade do grill** (fato que o grooming não achou e apareceu depois): ${t.found_late}${t.found_late ? ` (${r.rows.filter((x) => x.found_late.length).map((x) => `${x.key}: no ${x.found_late.join(', ')}`).join('; ')})` : ''}.`);
  L.push(`- **Qualidade da recomendação do grill:** ${t.rec_kept} respondida(s) com a recomendada, ${t.rec_changed} com outra resposta (${pct(t.rec_changed, t.rec_kept + t.rec_changed)} trocadas).`);
  L.push(`- **Saída:** ${t.criteria} critério(s) de aceite nos specs; ${t.lint_failed} card(s) com o lint do refine reprovado (retrabalho).`);
  L.push('', '## Por card', '', '| Card | Perguntas | Fatos (card/código) | Decisão do usuário | Coordenação | Sem base | Aberto | Ruído | Defasado | Achado tarde | Recomendada mantida/trocada | CA (com teste) | Lint |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of r.rows) L.push(`| ${x.key} | ${x.questions} | ${x.facts_from_card}/${x.facts_from_code} | ${x.answered_by_user_decision} | ${x.answered_by_coordination} | ${x.no_basis} | ${x.open} | ${x.noise} | ${x.stale_vs_code ? 'sim' : '—'} | ${x.found_late.length ? x.found_late.join(', ') : '—'} | ${x.rec_kept}/${x.rec_changed} | ${x.criteria == null ? '—' : `${x.criteria} (${x.criteria_with_test})`} | ${x.lint_ok == null ? '—' : x.lint_ok ? 'ok' : `${x.lint_errors} erro(s)`} |`);
  L.push('', 'Input = o card original (quanto ele já respondia); output = o spec (critérios com teste, lint). Tempo por etapa: oxe-cc alm metrics.');
  return `${L.join('\n')}\n`;
}

module.exports = { MARKER, renderComment, report, renderReport, sourceKind };
