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
 *   manual_interventions_per_phase                                                        ≤ 1
 *                             a person stepping in on the flow, per phase started: a task marked done or reopened
 *                             by hand (plan done / plan reopen), a defect / plan-review / drift waiver, a CR
 *                             resolved or withdrawn by hand. Can someone build with the recommended commands alone?
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
  manual_interventions_per_phase: { op: '<=', value: 1 },
};

/** Events that mean a person had to step in on the flow (the recorded ones). */
const INTERVENTION_EVENTS = new Set(['PlanTaskMarkedDone', 'PlanTaskReopened', 'PlanReviewWaived', 'DefectWaived', 'DriftWaived']);
function isIntervention(e) {
  if (!e || !e.type) return null;
  if (INTERVENTION_EVENTS.has(e.type)) return e.type;
  if (e.type === 'ChangeResolved' && e.payload && e.payload.manual) return 'ChangeResolvedManually';
  return null;
}

function meets(metric, value) {
  const t = TARGETS[metric];
  if (value == null) return null;
  if (t.op === '>=') return value >= t.value;
  if (t.op === '<=') return value <= t.value;
  return value === t.value;
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
  // `since` (ISO date/time): measure only the work done from then on — e.g. a project's history from before 1.21.
  const since = input.since ? new Date(input.since).toISOString() : null;
  const after = (ts) => !since || String(ts || '') >= since;
  const events = (Array.isArray(input.events) ? input.events : []).filter((e) => after(e.timestamp));
  const changes = foldChanges(input.changeLines).filter((cr) => after(cr.at));
  const ledgers = (Array.isArray(input.ledgers) ? input.ledgers : []).filter((l) => after(l.updated_at || l.started_at));

  // 1.21.1 (OXB-054): first-attempt rate PER TASK over every execute of the run. A task counts as first-attempt only if
  // its first terminal outcome is a completion of attempt 1 with no failed attempt before it; a task that failed and
  // was later closed (retry, another execute, or `plan done`) counts as a failure. Only completions used to enter the
  // denominator, so a phase where half the tasks failed three times still read 0.95. Work delivered by another path
  // (verify_only / external dependency) is reported apart, never in the rate.
  const completedAt = new Map();
  const outcome = new Map(); // run::task → 'first' | 'late' | 'failed'
  const failedBefore = new Set();
  const NOT_ATTEMPTED = new Set(['external_dependency', 'budget_exhausted', 'pending_gate', 'policy_denied', 'quota_exceeded', 'paused_environment', 'paused_quota']);
  let completed = 0;
  let external = 0;
  let turnsOnFinished = 0;
  for (const e of events) {
    if (!e.work_item_id) continue;
    const key = `${e.run_id || ''}::${e.work_item_id}`;
    const p = e.payload || {};
    if (e.type === 'ExecutorUsage') {
      if (completedAt.has(key)) turnsOnFinished += Number(p.turns) || 0;
      if (p.success === false && !completedAt.has(key)) failedBefore.add(key);
    } else if (e.type === 'RetryScheduled') {
      if (!completedAt.has(key)) failedBefore.add(key);
    } else if (e.type === 'WorkItemBlocked') {
      if (NOT_ATTEMPTED.has(p.reason) || p.max_attempts == null) continue;
      failedBefore.add(key);
      if (!outcome.has(key)) outcome.set(key, 'failed');
    } else if (e.type === 'WorkItemCompleted') {
      if (p.completed_by === 'verify_only') {
        external += 1;
        if (!completedAt.has(key)) completedAt.set(key, e.timestamp || '');
        continue;
      }
      completed += 1;
      const attempt = Number(p.attempt_number ?? p.attempt);
      if (!outcome.has(key)) outcome.set(key, attempt === 1 && !failedBefore.has(key) ? 'first' : 'late');
      if (!completedAt.has(key)) completedAt.set(key, e.timestamp || '');
    }
  }
  const judged = [...outcome.values()];
  const firstAttempt = judged.filter((v) => v === 'first').length;

  const overruns = ledgers.filter((l) => (l.limit_turns != null && l.used_turns > l.limit_turns) || (l.limit_usd != null && l.used_usd > l.limit_usd + 1e-9)).length;

  const resolved = changes.filter((cr) => cr.status === 'resolved');
  const withoutProof = resolved.filter((cr) => !/teste de aceite|gate do projeto/i.test(String(cr.resolution || ''))).length;

  // a phase's green verify is the last VerificationCompleted passed before the CR, in that phase's run
  const greens = events.filter((e) => e.type === 'VerificationCompleted' && e.payload && e.payload.status === 'passed').map((e) => e.timestamp || '');
  const firstGreen = greens.length ? greens.sort()[0] : null;
  const postGreen = changes.filter((cr) => (cr.class === 'defect' || cr.class === 'constraint') && !cr.gate && firstGreen && String(cr.at || '') > firstGreen).length;

  // interventions per phase started (at least one: a project without a program is one phase of work)
  const interventions = {};
  for (const e of events) { const kind = isIntervention(e); if (kind) interventions[kind] = (interventions[kind] || 0) + 1; }
  const interventionCount = Object.values(interventions).reduce((a, b) => a + b, 0);
  const phasesStarted = new Set(events.filter((e) => e.type === 'PhaseStarted').map((e) => (e.payload && e.payload.phase) || '?')).size || 1;

  const metrics = {
    first_attempt_rate: judged.length ? Math.round((firstAttempt / judged.length) * 100) / 100 : null,
    turns_on_finished_work: turnsOnFinished,
    budget_overruns: overruns,
    crs_closed_without_proof: withoutProof,
    post_green_crs: postGreen,
    manual_interventions_per_phase: Math.round((interventionCount / phasesStarted) * 100) / 100,
  };
  const results = Object.entries(metrics).map(([metric, value]) => ({ metric, value, target: `${TARGETS[metric].op} ${TARGETS[metric].value}`, ok: meets(metric, value) }));
  return {
    oxeScorecardSchema: 1,
    generated_at: new Date().toISOString(),
    since,
    sample: {
      completed_tasks: completed,
      tasks_judged: judged.length,
      tasks_failed: judged.filter((v) => v === 'failed').length,
      tasks_completed_late: judged.filter((v) => v === 'late').length,
      external_deliveries: external,
      change_requests: changes.length,
      resolved_crs: resolved.length,
      budget_ledgers: ledgers.length,
      events: events.length,
      phases_started: phasesStarted,
      manual_interventions: interventionCount,
      interventions_by_kind: interventions,
    },
    metrics: results,
    ok: results.every((r) => r.ok !== false),
  };
}

function scorecardForProject(projectRoot, readEvents, options = {}) {
  const events = typeof readEvents === 'function' ? readEvents() : [];
  let changeLines = [];
  try {
    changeLines = fs.readFileSync(path.join(projectRoot, '.oxe', 'program', 'changes.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    changeLines = [];
  }
  return computeScorecard({ events, changeLines, ledgers: readLedgers(projectRoot), since: options.since || null });
}

module.exports = { TARGETS, computeScorecard, scorecardForProject, foldChanges };
