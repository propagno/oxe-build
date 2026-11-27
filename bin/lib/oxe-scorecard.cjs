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
function computeScorecard(input = {}) {
  // `since` (ISO date/time): measure only the work done from then on — e.g. a project's history from before 1.21.
  let since = null;
  if (input.since) {
    const d = new Date(input.since);
    if (Number.isNaN(d.getTime())) throw new Error(`scorecard: data --since inválida (${input.since})`);
    since = d.toISOString();
  }
  const after = (ts) => !since || String(ts || '') >= since;
  const allEvents = (Array.isArray(input.events) ? input.events : []).filter(Boolean);
  const phaseWindows = [];
  const knownPhases = new Set();
  for (const e of [...allEvents].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))) {
    if (e.type === 'PhaseStarted' && e.payload && e.payload.phase) {
      knownPhases.add(e.payload.phase);
      phaseWindows.push({ phase: e.payload.phase, at: String(e.timestamp || '') });
    }
  }
  const inferPhaseAt = (ts) => {
    const t = String(ts || '');
    let ph = null;
    for (const w of phaseWindows) {
      if (w.at <= t) ph = w.phase;
      else break;
    }
    return ph;
  };
  const events = allEvents.filter((e) => after(e.timestamp));
  const changes = foldChanges(input.changeLines).filter((cr) => after(cr.at));
  const ledgers = (Array.isArray(input.ledgers) ? input.ledgers : []).filter((l) => l && after(l.updated_at || l.started_at));

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
      if (p.completed_by === 'verify_only' || p.completed_by === 'external_delivery') {
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

  // a phase's green verify is the earliest VerificationCompleted passed in that phase; in multi-phase programs,
  // a CR filed in F2 before F2 has passed verification must not be blamed on F1's earlier green verify.
  const greenEvents = events.filter((e) => e.type === 'VerificationCompleted' && e.payload && e.payload.status === 'passed');
  const greenByPhase = new Map();
  for (const e of greenEvents) {
    const ts = String(e.timestamp || '');
    const ph = (e.payload && e.payload.phase) || inferPhaseAt(ts);
    if (ph) {
      knownPhases.add(ph);
      const prev = greenByPhase.get(ph);
      if (prev == null || ts < prev) greenByPhase.set(ph, ts);
    }
  }
  const greens = greenEvents.map((e) => String(e.timestamp || ''));
  const firstGreen = greens.length ? greens.sort()[0] : null;
  const postGreen = changes.filter((cr) => {
    if ((cr.class !== 'defect' && cr.class !== 'constraint') || cr.gate) return false;
    const at = String(cr.at || '');
    const crPhase = cr.phase || inferPhaseAt(at);
    if (crPhase && knownPhases.has(crPhase)) {
      return greenByPhase.has(crPhase) && at > greenByPhase.get(crPhase);
    }
    return Boolean(firstGreen && at > firstGreen);
  }).length;

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
      cost_by_tier: require('./oxe-model-tiers.cjs').costByTier(events), // OXB-131
    },
    metrics: results,
    ok: results.every((r) => r.ok !== false),
  };
}

function readNdjsonQuiet(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 1.22.2 (OXB-222-08): Offline CI rework & leadtime breakdown from local `.oxe/` records
 * (`ci.ndjson` + `events.ndjson` / `OXE-EVENTS.ndjson`). Zero network or `gh` calls.
 *
 * @param {string} projectRoot
 * @param {{ activeSession?: string|null, since?: string|null, events?: object[] }} [options]
 */
function computeLeadtimeAndCiMetrics(projectRoot, options = {}) {
  let since = null;
  if (options.since) {
    const d = new Date(options.since);
    if (Number.isNaN(d.getTime())) throw new Error(`scorecard: data --since inválida (${options.since})`);
    since = d.toISOString();
  }
  const after = (ts) => !since || String(ts || '') >= since;

  // 1. Collect CI records from session program dir (when set) and root `.oxe/program/ci.ndjson`
  const ciCandidates = [];
  if (options.activeSession) {
    ciCandidates.push(path.join(projectRoot, '.oxe', options.activeSession, 'program', 'ci.ndjson'));
  }
  ciCandidates.push(path.join(projectRoot, '.oxe', 'program', 'ci.ndjson'));
  const seenCiPaths = new Set();
  const ciRuns = [];
  for (const candidate of ciCandidates) {
    const resolved = path.resolve(candidate);
    if (seenCiPaths.has(resolved)) continue;
    seenCiPaths.add(resolved);
    for (const rec of readNdjsonQuiet(resolved)) {
      if (rec && typeof rec === 'object' && (!rec.kind || rec.kind === 'ci') && after(rec.at || rec.timestamp)) {
        ciRuns.push(rec);
      }
    }
  }

  // Group CI runs by phase
  const ciByPhase = new Map();
  for (const rec of ciRuns) {
    const ph = String(rec.phase || 'unknown');
    if (!ciByPhase.has(ph)) ciByPhase.set(ph, []);
    ciByPhase.get(ph).push(rec);
  }

  let firstPassGreenCount = 0;
  let ciReworkCycles = 0;
  const phaseCiSummary = new Map();
  for (const [phase, runs] of ciByPhase.entries()) {
    const sorted = [...runs].sort((a, b) => String(a.at || a.timestamp || '').localeCompare(String(b.at || b.timestamp || '')));
    const first = sorted[0];
    const concl = String((first && (first.conclusion || first.status)) || '').toLowerCase();
    const firstPassGreen = first
      ? (first.ok === true
        || concl === 'success'
        || concl === 'passed'
        || concl === 'green'
        || (!concl && sorted.length === 1))
      : false;
    const rework = Math.max(0, sorted.length - 1);
    if (firstPassGreen) firstPassGreenCount += 1;
    ciReworkCycles += rework;
    phaseCiSummary.set(phase, {
      ci_runs: sorted.length,
      first_pass_green: firstPassGreen,
      rework_cycles: rework,
    });
  }

  const phasesWithCi = ciByPhase.size;
  const firstPassRate = phasesWithCi > 0 ? Math.round((firstPassGreenCount / phasesWithCi) * 100) / 100 : null;

  // 2. Collect lifecycle events (passed-in + local ndjson files) and deduplicate
  const rawEvents = [];
  if (Array.isArray(options.events)) rawEvents.push(...options.events);
  const eventCandidates = [];
  if (options.activeSession) {
    eventCandidates.push(path.join(projectRoot, '.oxe', options.activeSession, 'events', 'events.ndjson'));
    eventCandidates.push(path.join(projectRoot, '.oxe', options.activeSession, 'OXE-EVENTS.ndjson'));
  }
  eventCandidates.push(path.join(projectRoot, '.oxe', 'events', 'events.ndjson'));
  eventCandidates.push(path.join(projectRoot, '.oxe', 'OXE-EVENTS.ndjson'));
  const seenEventPaths = new Set();
  for (const candidate of eventCandidates) {
    const resolved = path.resolve(candidate);
    if (seenEventPaths.has(resolved)) continue;
    seenEventPaths.add(resolved);
    rawEvents.push(...readNdjsonQuiet(resolved));
  }

  const seenEventKey = new Set();
  const events = [];
  for (const e of rawEvents) {
    if (!e || typeof e !== 'object' || !e.type) continue;
    const ts = String(e.timestamp || e.at || '');
    if (!after(ts)) continue;
    const phase = (e.payload && e.payload.phase) || e.phase || '';
    const status = (e.payload && e.payload.status) || '';
    const dedupKey = `${e.type}|${ts}|${phase}|${status}|${e.run_id || ''}`;
    if (seenEventKey.has(dedupKey)) continue;
    seenEventKey.add(dedupKey);
    events.push({ ...e, _ts: ts });
  }
  events.sort((a, b) => a._ts.localeCompare(b._ts));

  // Build phase windows for inferring phase when events omit payload.phase
  const phaseWindows = [];
  for (const e of events) {
    if (e.type === 'PhaseStarted' && e.payload && e.payload.phase) {
      phaseWindows.push({ phase: String(e.payload.phase), at: e._ts });
    }
  }
  const inferPhaseAt = (ts) => {
    let ph = null;
    for (const w of phaseWindows) {
      if (w.at <= ts) ph = w.phase;
      else break;
    }
    return ph;
  };

  const phaseTimes = new Map();
  const ensurePhaseTime = (ph) => {
    if (!phaseTimes.has(ph)) phaseTimes.set(ph, { started: null, verified: null, closed: null });
    return phaseTimes.get(ph);
  };
  for (const e of events) {
    const ms = Date.parse(e._ts);
    if (Number.isNaN(ms)) continue;
    const ph = (e.payload && e.payload.phase) ? String(e.payload.phase) : inferPhaseAt(e._ts);
    if (!ph) continue;
    const rec = ensurePhaseTime(ph);
    if (e.type === 'PhaseStarted') {
      if (rec.started == null || ms < rec.started) rec.started = ms;
    } else if (e.type === 'VerificationCompleted' && e.payload && (e.payload.status === 'passed' || e.payload.ok === true)) {
      if (rec.verified == null || ms < rec.verified) rec.verified = ms;
    } else if (e.type === 'PhaseClosed') {
      if (rec.closed == null || ms < rec.closed) rec.closed = ms;
    }
  }

  const planToVerifySamples = [];
  const verifyToCloseSamples = [];
  const totalSamples = [];
  const allPhases = new Set([...phaseCiSummary.keys(), ...phaseTimes.keys()]);
  const byPhase = [];

  for (const ph of [...allPhases].sort()) {
    const ci = phaseCiSummary.get(ph) || { ci_runs: 0, first_pass_green: null, rework_cycles: 0 };
    const tm = phaseTimes.get(ph) || { started: null, verified: null, closed: null };
    const p2v = tm.started != null && tm.verified != null && tm.verified >= tm.started ? tm.verified - tm.started : null;
    const v2c = tm.verified != null && tm.closed != null && tm.closed >= tm.verified ? tm.closed - tm.verified : null;
    const tot = tm.started != null && tm.closed != null && tm.closed >= tm.started ? tm.closed - tm.started : null;
    if (p2v != null) planToVerifySamples.push(p2v);
    if (v2c != null) verifyToCloseSamples.push(v2c);
    if (tot != null) totalSamples.push(tot);
    byPhase.push({
      phase: ph,
      ci_runs: ci.ci_runs,
      first_pass_green: ci.first_pass_green,
      rework_cycles: ci.rework_cycles,
      plan_to_verify_ms: p2v,
      verify_to_close_ms: v2c,
      total_ms: tot,
    });
  }

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const avgPlanToVerify = avg(planToVerifySamples);
  const avgVerifyToClose = avg(verifyToCloseSamples);
  const avgTotal = avg(totalSamples);
  const postVerifySharePct = avgPlanToVerify != null && avgVerifyToClose != null && (avgPlanToVerify + avgVerifyToClose) > 0
    ? Math.round((avgVerifyToClose / (avgPlanToVerify + avgVerifyToClose)) * 1000) / 10
    : null;

  return {
    offline: true,
    total_ci_runs: ciRuns.length,
    phases_with_ci: phasesWithCi,
    first_pass_ci_green_rate: firstPassRate,
    ci_rework_cycles: ciReworkCycles,
    leadtime_breakdown: {
      avg_plan_to_verify_ms: avgPlanToVerify,
      avg_verify_to_close_ms: avgVerifyToClose,
      avg_total_ms: avgTotal,
      post_verify_share_pct: postVerifySharePct,
      phases_measured: Math.max(planToVerifySamples.length, verifyToCloseSamples.length, totalSamples.length),
    },
    by_phase: byPhase,
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

module.exports = { TARGETS, computeScorecard, scorecardForProject, foldChanges, computeLeadtimeAndCiMetrics };
