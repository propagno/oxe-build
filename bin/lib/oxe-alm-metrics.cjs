'use strict';

/**
 * 1.21.2 — `oxe-cc alm metrics`: the board in numbers, so the bottleneck is seen with a figure — time in each column,
 * lead time (created → released), cycle time (development started → released), throughput per week and how many
 * cards sit in each column now, with optional WIP limits (alm.wip, warning only). Pure: the caller fetches the cards
 * and their status changelog.
 */

const DAY = 86_400_000;

/** The status intervals of one card: from its creation (first status) to now. */
function timeline(issue, now) {
  const changes = [...(issue.changes || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out = [];
  let status = changes.length ? changes[0].from || issue.status : issue.status;
  let since = Date.parse(issue.created);
  for (const c of changes) {
    const at = Date.parse(c.at);
    if (status) out.push({ status, from: since, to: at });
    status = c.to;
    since = at;
  }
  if (status) out.push({ status, from: since, to: now, open: true });
  return out;
}

const quant = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q + 0.5))];
};
const days = (ms) => (ms == null ? null : Math.round((ms / DAY) * 10) / 10);
/** ISO 8601 week (the week of the Thursday). */
const isoWeek = (t) => {
  const s = new Date(t);
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/**
 * @param {Array<{ key: string, created: string, status: string, changes: Array<{at, from, to}> }>} issues
 * @param {{ states: object, wip?: object, stages: string[] }} cfg   states: canonical stage → column name
 */
function compute(issues, cfg, options = {}) {
  const now = options.now != null ? options.now : Date.now();
  const stageOf = new Map();
  for (const s of cfg.stages) if (cfg.states[s]) stageOf.set(String(cfg.states[s]).toLowerCase(), s);
  const order = cfg.stages.filter((s) => cfg.states[s]).map((s) => cfg.states[s]);
  const doneName = cfg.states.released || cfg.states.integrated || null;
  const devName = cfg.states.in_progress || null;
  const perColumn = new Map();
  const wipNow = new Map();
  const leads = [];
  const cycles = [];
  const throughput = new Map();
  const cards = [];
  for (const issue of issues) {
    const tl = timeline(issue, now);
    for (const seg of tl) {
      const k = seg.status;
      if (!perColumn.has(k)) perColumn.set(k, []);
      perColumn.get(k).push(seg.to - seg.from);
    }
    const cur = tl.length ? tl[tl.length - 1].status : issue.status;
    wipNow.set(cur, (wipNow.get(cur) || 0) + 1);
    const enter = (name) => { const seg = name ? tl.find((s) => s.status.toLowerCase() === String(name).toLowerCase()) : null; return seg ? seg.from : null; };
    const done = enter(doneName);
    const started = enter(devName);
    const created = Date.parse(issue.created);
    if (done != null) {
      leads.push(done - created);
      if (started != null && started <= done) cycles.push(done - started);
      const w = isoWeek(done);
      throughput.set(w, (throughput.get(w) || 0) + 1);
    }
    cards.push({ key: issue.key, status: cur, stage: stageOf.get(String(cur).toLowerCase()) || null, age_days: days(now - (tl.length ? tl[tl.length - 1].from : created)), lead_days: done != null ? days(done - created) : null, cycle_days: done != null && started != null ? days(done - started) : null });
  }
  const columns = [...new Set([...order, ...perColumn.keys(), ...wipNow.keys()])].map((name) => {
    const xs = perColumn.get(name) || [];
    const stage = stageOf.get(String(name).toLowerCase()) || null;
    const limit = stage && cfg.wip ? cfg.wip[stage] : null;
    const n = wipNow.get(name) || 0;
    return { column: name, stage, now: n, wip_limit: limit || null, over_wip: Boolean(limit && n > limit), passed: xs.length, median_days: days(quant(xs, 0.5)), p85_days: days(quant(xs, 0.85)), total_days: days(xs.reduce((a, b) => a + b, 0)) };
  });
  // the bottleneck: the column (not the end ones) where cards spend the most time at the median, among those with traffic
  const middle = columns.filter((c) => c.passed >= 2 && c.column !== doneName && c.stage !== 'intake');
  const bottleneck = middle.sort((a, b) => (b.median_days || 0) - (a.median_days || 0))[0] || null;
  const weeks = [...throughput.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, n]) => ({ week, done: n }));
  return {
    cards: cards.length,
    columns,
    lead_time: { done: leads.length, median_days: days(quant(leads, 0.5)), p85_days: days(quant(leads, 0.85)) },
    cycle_time: { done: cycles.length, median_days: days(quant(cycles, 0.5)), p85_days: days(quant(cycles, 0.85)) },
    throughput: weeks,
    bottleneck: bottleneck ? { column: bottleneck.column, median_days: bottleneck.median_days } : null,
    warnings: columns.filter((c) => c.over_wip).map((c) => `${c.column}: ${c.now} card(s), acima do limite de WIP ${c.wip_limit}`),
    unmapped: columns.filter((c) => !c.stage && c.now).map((c) => c.column),
    card_list: cards,
  };
}

/** The changelog of a Jira issue (search/jql with expand=changelog) to {at, from, to} status changes. */
function changesFromJira(issue) {
  const histories = (issue.changelog && issue.changelog.histories) || [];
  const out = [];
  for (const h of histories) for (const it of h.items || []) if (it.field === 'status') out.push({ at: h.created, from: it.fromString, to: it.toString, fromId: it.from || null, toId: it.to || null });
  return out;
}

/** "434 card(s)", or "300 de 434 card(s) (amostra parcial)" when the fetch stopped before the end. */
function cardsLabel(m) {
  if (m.truncated && m.total != null && m.total > m.cards) return `${m.cards} de ${m.total} card(s) (amostra parcial: os números valem só para esses)`;
  return `${m.cards} card(s)`;
}

function renderMarkdown(m, ctx = {}) {
  const l = [`# Métricas do quadro${ctx.project ? ` — ${ctx.project}` : ''}`, '', `${cardsLabel(m)}${ctx.jql ? ` · \`${ctx.jql}\`` : ''} · gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];
  l.push(`- **Lead time** (criado → ${ctx.doneName || 'lançado'}): mediana ${m.lead_time.median_days ?? '—'} d · p85 ${m.lead_time.p85_days ?? '—'} d (${m.lead_time.done} card(s))`);
  l.push(`- **Cycle time** (em desenvolvimento → ${ctx.doneName || 'lançado'}): mediana ${m.cycle_time.median_days ?? '—'} d · p85 ${m.cycle_time.p85_days ?? '—'} d (${m.cycle_time.done} card(s))`);
  if (m.bottleneck) l.push(`- **Gargalo:** ${m.bottleneck.column} (mediana de ${m.bottleneck.median_days} d por card)`);
  for (const w of m.warnings) l.push(`- **WIP:** ${w}`);
  l.push('', '## Colunas', '', '| Coluna | Etapa | Agora | Limite | Passaram | Mediana (d) | p85 (d) |', '|---|---|---|---|---|---|---|');
  for (const c of m.columns) l.push(`| ${c.column} | ${c.stage || '—'} | ${c.now}${c.over_wip ? ' ⚠' : ''} | ${c.wip_limit ?? '—'} | ${c.passed} | ${c.median_days ?? '—'} | ${c.p85_days ?? '—'} |`);
  if (m.throughput.length) l.push('', '## Vazão por semana', '', '| Semana | Concluídos |', '|---|---|', ...m.throughput.map((w) => `| ${w.week} | ${w.done} |`));
  if (m.unmapped.length) l.push('', `Colunas sem etapa mapeada em alm.states: ${m.unmapped.join(', ')}`);
  return `${l.join('\n')}\n`;
}

/**
 * A column renamed on the board keeps its id: the changelog still carries the old name ("A fazer" → now "Backlog").
 * The names are taken from the id, with the current name of each id seen on the cards.
 */
function renameByStatusId(issues) {
  const nameOf = new Map();
  for (const i of issues) if (i.statusId) nameOf.set(String(i.statusId), i.status);
  for (const i of issues) {
    for (const c of i.changes || []) {
      if (c.fromId && nameOf.has(String(c.fromId))) c.from = nameOf.get(String(c.fromId));
      if (c.toId && nameOf.has(String(c.toId))) c.to = nameOf.get(String(c.toId));
    }
  }
  return issues;
}

module.exports = { renameByStatusId, compute, timeline, changesFromJira, renderMarkdown, cardsLabel, isoWeek };
