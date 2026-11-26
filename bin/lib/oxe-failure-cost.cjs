'use strict';

/**
 * 1.21.2 (coordination, 14/11): the cost of failure, measured from the project's own records — never estimated. The
 * question was "how much of the slow flow is the tool"; the answer has to be a reproducible number, so the next nights
 * show whether G30, G30b/G36 and G24 bring it down.
 *
 *   `oxe-cc report failure-cost [--since <data|ISO>] [--gap-minutes 30] [--json]`
 *
 * From OXE-EVENTS.ndjson and changes.ndjson only:
 *   - discarded attempts: an attempt followed by RetryScheduled (its cause: the retry reason), the last attempt of a
 *     task that ended WorkItemBlocked (its failure_class), and a task completed then redone after a CR named it (the
 *     first completion's attempts, cause: the CR's class) — each with its ExecutorUsage cost;
 *   - stopped time: gaps with no event inside a run longer than --gap-minutes (default 30), named by the last event
 *     before the gap, plus the paused spans (RunPaused → the next event);
 *   - per cause: occurrences, US$, tasks, CRs; totals: US$ discarded / US$ spent and the hours stopped.
 * `failure_cost.fixes` in .oxe/config.json maps a cause to the OXB/commit that fixed it ("fix" column); unmapped: "—".
 */

const at = (e) => Date.parse((e && (e.timestamp || e.at)) || '') || 0;
const round2 = (n) => Math.round(n * 100) / 100;

function report(events, changes = [], options = {}) {
  const since = options.since ? Date.parse(options.since) : 0;
  const gapMs = (Number(options.gapMinutes) > 0 ? Number(options.gapMinutes) : 30) * 60_000;
  const evs = (events || []).filter((e) => e && (!since || at(e) >= since)).sort((a, b) => at(a) - at(b));
  const crs = (changes || []).filter((c) => c && /^CR-/i.test(String(c.id || '')) && (!c.kind || c.kind === 'cr') && (!since || Date.parse(c.at || '') >= since));
  const causes = new Map();
  const add = (cause, usd, task, cr) => {
    const c = causes.get(cause) || { cause, occurrences: 0, usd: 0, tasks: new Set(), crs: new Set() };
    c.occurrences += 1;
    c.usd += usd;
    if (task) c.tasks.add(task);
    if (cr) c.crs.add(cr);
    causes.set(cause, c);
  };
  // attempts per (run, task): their costs in order, and how each ended
  let spent = 0;
  const byTask = new Map(); // task -> [{ run, attempt, usd, end }]
  const key = (e) => e.work_item_id || (e.payload && e.payload.task) || null;
  for (const e of evs) {
    const task = key(e);
    if (!task) continue;
    const list = byTask.get(task) || [];
    if (e.type === 'ExecutorUsage') {
      const usd = Number(e.payload && e.payload.cost_usd) || 0;
      spent += usd;
      // several usage lines of one attempt (turn timeouts) add to the same attempt
      const n = Number(e.payload && e.payload.attempt) || 1;
      const last = list[list.length - 1];
      if (last && last.run === e.run_id && last.attempt === n && !last.end) last.usd += usd;
      else list.push({ run: e.run_id || null, attempt: n, usd, end: null, at: at(e) });
    } else if (e.type === 'RetryScheduled') {
      const open = [...list].reverse().find((a) => !a.end);
      if (open) open.end = { kind: 'retry', cause: String((e.payload && e.payload.reason) || 'retry'), at: at(e) };
    } else if (e.type === 'WorkItemBlocked' || e.type === 'WorkItemFailed') {
      const open = [...list].reverse().find((a) => !a.end);
      if (open) open.end = { kind: 'blocked', cause: String((e.payload && (e.payload.failure_class || e.payload.reason)) || 'blocked'), at: at(e) };
    } else if (e.type === 'WorkItemCompleted') {
      const open = [...list].reverse().find((a) => !a.end);
      if (open) open.end = { kind: 'done', at: at(e) };
    }
    byTask.set(task, list);
  }
  const crNaming = (task, from, to) => crs.find((c) => (c.tasks || []).map((x) => String(x).toUpperCase().replace(/^F\d+\//, '')).includes(task) && Date.parse(c.at || '') >= from && (!to || Date.parse(c.at || '') <= to));
  for (const [task, list] of byTask) {
    // a discarded attempt is attributed to the CR that named the task after it (the diagnosis: a test defect, a missing
    // scope), else to the runtime's failure class
    list.forEach((a, i) => {
      if (!a.end || a.end.kind === 'done') return;
      const next = list.slice(i + 1).find((x) => x.at > (a.end.at || a.at));
      const cr = crNaming(task, a.end.at || a.at, next ? next.at : null);
      add(cr ? `CR ${cr.class || 'cr'} (${a.end.cause})` : a.end.cause, a.usd, task, cr ? cr.id : null);
    });
    // completed, then attempted again later: the first completion was redone — by a CR naming the task if one was
    // recorded in between, else "redo"
    const doneIdx = list.findIndex((a) => a.end && a.end.kind === 'done');
    if (doneIdx >= 0 && list.slice(doneIdx + 1).some((a) => a.at > list[doneIdx].end.at)) {
      const doneAt = list[doneIdx].end.at;
      const later = list.slice(doneIdx + 1).find((a) => a.at > doneAt);
      // the phase prefix (F2/T6) normalised like crNaming (cross-review 15/11)
      const cr = crNaming(task, doneAt, later.at);
      const firstOfDone = list.slice(0, doneIdx + 1).filter((a) => a.end && a.end.kind === 'done').length ? list[doneIdx] : null;
      if (firstOfDone) add(cr ? `CR ${cr.class || 'cr'}` : 'redo', firstOfDone.usd, task, cr ? cr.id : null);
    }
  }
  // stopped time
  const stops = [];
  const byRun = new Map();
  for (const e of evs) { if (!e.run_id) continue; const l = byRun.get(e.run_id) || []; l.push(e); byRun.set(e.run_id, l); }
  for (const [run, l] of byRun) {
    for (let i = 1; i < l.length; i += 1) {
      const gap = at(l[i]) - at(l[i - 1]);
      // OxeSpace 15/11: a gap after VerificationStarted is a verify waiting on the CI (remote), not a stall
      if (gap > gapMs) stops.push({ run, after: l[i - 1].type, task: key(l[i - 1]), minutes: Math.round(gap / 60000), from: l[i - 1].timestamp || null, kind: /^Verification(Started|CheckStarted)$/.test(String(l[i - 1].type)) ? 'verifying' : 'stopped' });
    }
  }
  const fixes = (options.fixes && typeof options.fixes === 'object') ? options.fixes : {};
  // OxeSpace 15/11: the fixes map is matched by the cause as printed, then by its parts — "CR constraint (no_progress)"
  // tries "no_progress" and "constraint" — case-insensitive; the keys tried are reported (fix_keys)
  const fixKeys = (cause) => {
    const s = String(cause || '');
    const inner = /\(([^)]+)\)\s*$/.exec(s);
    const cls = /^CR\s+(\S+)/.exec(s);
    return [...new Set([s, inner && inner[1], cls && cls[1]].filter(Boolean))];
  };
  const lowerFixes = new Map(Object.entries(fixes).map(([k, v]) => [k.toLowerCase(), v]));
  const fixFor = (cause) => { for (const k of fixKeys(cause)) { const v = fixes[k] != null ? fixes[k] : lowerFixes.get(k.toLowerCase()); if (v != null) return v; } return null; };
  const rows = [...causes.values()].map((c) => ({ cause: c.cause, occurrences: c.occurrences, usd: round2(c.usd), tasks: [...c.tasks].sort(), crs: [...c.crs].sort(), fix: fixFor(c.cause), fix_keys: fixKeys(c.cause) }))
    .sort((a, b) => b.usd - a.usd || b.occurrences - a.occurrences);
  const discarded = round2(rows.reduce((s, r) => s + r.usd, 0));
  const pct = spent > 0 ? Math.round((discarded / spent) * 1000) / 10 : 0;
  const hours = (list) => Math.round((list.reduce((s, x) => s + x.minutes, 0) / 60) * 10) / 10;
  return {
    since: options.since || null,
    spent_usd: round2(spent),
    discarded_usd: discarded,
    // a percentage (kept for compatibility); the explicit forms make sums across worktrees unambiguous
    discarded_share: pct,
    discarded_share_pct: pct,
    discarded_ratio: spent > 0 ? Math.round((discarded / spent) * 10000) / 10000 : 0,
    stopped_hours: hours(stops.filter((s) => s.kind !== 'verifying')),
    verifying_hours: hours(stops.filter((s) => s.kind === 'verifying')),
    causes: rows,
    stops: stops.sort((a, b) => b.minutes - a.minutes),
    crs: crs.map((c) => ({ id: c.id, class: c.class, status: c.status, tasks: c.tasks || [], summary: c.summary || '' })),
  };
}

function render(r) {
  const lines = [
    `Custo de falha${r.since ? ` desde ${r.since}` : ''}: US$ ${r.discarded_usd.toFixed(2)} descartados de US$ ${r.spent_usd.toFixed(2)} gastos (${r.discarded_share}%) · ${r.stopped_hours} h paradas${r.verifying_hours ? ` · ${r.verifying_hours} h em verify (CI)` : ''}`,
    '',
    '| Causa | Vezes | US$ | Tarefas | CRs | Conserto |',
    '|---|---|---|---|---|---|',
    ...r.causes.map((c) => `| ${c.cause} | ${c.occurrences} | ${c.usd.toFixed(2)} | ${c.tasks.join(', ') || '—'} | ${c.crs.join(', ') || '—'} | ${c.fix || '—'} |`),
  ];
  if (r.stops.length) {
    lines.push('', '| Run | Parado (min) | Depois de | Tarefa |', '|---|---|---|---|', ...r.stops.slice(0, 15).map((s) => `| ${s.run} | ${s.minutes} | ${s.after} | ${s.task || '—'} |`));
  }
  return lines.join('\n');
}

module.exports = { report, render };
