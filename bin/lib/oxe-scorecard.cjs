'use strict';

/**
 * 1.21 · Maturity scorecard. "Mature" is not "never fails": it is a set of measurable targets the runtime computes
 * from its own records (events, change requests, budget ledgers) and a release requires on real projects.
 *
 *   first_attempt_rate        completed tasks that passed on attempt 1                  ≥ 0.80
 *   turns_on_finished_work    turns paid for a task after it had already completed      = 0
 *   budget_overruns           ledgers whose usage passed the declared ceiling           = 0
 *   crs_closed_without_proof  CRs resolved without a green frozen test or gate          = 0
 *   post_green_crs            defect/constraint CRs opened after their phase's green    = 0
 *                             verify (CI, review or UAT caught what the verify passed)
 *
 * Purity (`--json`, read commands) is a static property covered by the test suite, not by events.
 */

const fs = require('fs');
const path = require('path');

const TARGETS = {
  first_attempt_rate: { op: '>=', value: 0.8 },
  turns_on_finished_work: { op: '=', value: 0 },
  budget_overruns: { op: '=', value: 0 },
  crs_closed_without_proof: { op: '=', value: 0 },
  post_green_crs: { op: '=', value: 0 },
};

function meets(metric, value) {
  const t = TARGETS[metric];
  if (value == null) return null;
  return t.op === '>=' ? value >= t.value : value === t.value;
}

function readLedgers(projectRoot) {
  const dir = path.join(projectRoot, '.oxe', 'runs');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.budget.json'));
  } catch {
    return [];
  }
  return names.map((n) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** Folds the CR log (records + status lines) into the current state of each CR. */
function foldChanges(lines) {
  const byId = new Map();
  for (const line of lines || []) {
    if (!line || !line.id) continue;
    if (line.kind === 'cr') byId.set(line.id, { ...line });
    else if (line.kind === 'status' && byId.has(line.id)) Object.assign(byId.get(line.id), { status: line.status, resolution: line.resolution || null, resolved_at: line.at });
  }
  return [...byId.values()];
}

/**
 * @param {{ events: object[], changeLines: object[], ledgers: object[] }} input
 */
function computeScorecard(input) {
  const events = Array.isArray(input.events) ? input.events : [];
  const changes = foldChanges(input.changeLines);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];

  // first-attempt rate and turns paid after a task had completed (same run)
  const completedAt = new Map();
  let completed = 0;
  let firstAttempt = 0;
  let turnsOnFinished = 0;
  for (const e of events) {
    const key = `${e.run_id || ''}::${e.work_item_id || ''}`;
    if (e.type === 'WorkItemCompleted' && e.work_item_id) {
      completed += 1;
      const attempt = e.payload && (e.payload.attempt_number ?? e.payload.attempt);
      if (Number(attempt) === 1) firstAttempt += 1;
      if (!completedAt.has(key)) completedAt.set(key, e.timestamp || '');
    } else if (e.type === 'ExecutorUsage' && e.work_item_id && completedAt.has(key)) {
      turnsOnFinished += Number(e.payload && e.payload.turns) || 0;
    }
  }

  const overruns = ledgers.filter((l) => (l.limit_turns != null && l.used_turns > l.limit_turns) || (l.limit_usd != null && l.used_usd > l.limit_usd + 1e-9)).length;

  const resolved = changes.filter((cr) => cr.status === 'resolved');
  const withoutProof = resolved.filter((cr) => !/teste de aceite|gate do projeto/i.test(String(cr.resolution || ''))).length;

  // a phase's green verify is the last VerificationCompleted passed before the CR, in that phase's run
  const greens = events.filter((e) => e.type === 'VerificationCompleted' && e.payload && e.payload.status === 'passed').map((e) => e.timestamp || '');
  const firstGreen = greens.length ? greens.sort()[0] : null;
  const postGreen = changes.filter((cr) => (cr.class === 'defect' || cr.class === 'constraint') && !cr.gate && firstGreen && String(cr.at || '') > firstGreen).length;

  const metrics = {
    first_attempt_rate: completed ? Math.round((firstAttempt / completed) * 100) / 100 : null,
    turns_on_finished_work: turnsOnFinished,
    budget_overruns: overruns,
    crs_closed_without_proof: withoutProof,
    post_green_crs: postGreen,
  };
  const results = Object.entries(metrics).map(([metric, value]) => ({ metric, value, target: `${TARGETS[metric].op} ${TARGETS[metric].value}`, ok: meets(metric, value) }));
  return {
    oxeScorecardSchema: 1,
    generated_at: new Date().toISOString(),
    sample: { completed_tasks: completed, change_requests: changes.length, resolved_crs: resolved.length, budget_ledgers: ledgers.length, events: events.length },
    metrics: results,
    ok: results.every((r) => r.ok !== false),
  };
}

function scorecardForProject(projectRoot, readEvents) {
  const events = typeof readEvents === 'function' ? readEvents() : [];
  let changeLines = [];
  try {
    changeLines = fs.readFileSync(path.join(projectRoot, '.oxe', 'program', 'changes.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    changeLines = [];
  }
  return computeScorecard({ events, changeLines, ledgers: readLedgers(projectRoot) });
}

module.exports = { TARGETS, computeScorecard, scorecardForProject, foldChanges };
