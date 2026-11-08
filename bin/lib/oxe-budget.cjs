'use strict';

/**
 * 1.21 · Run budget (OXB-023). A coordinator's "20 `claude -p` turns for this rework" used to be enforced by a person
 * watching ExecutorUsage events. The ledger `.oxe/runs/<run>.budget.json` keeps the ceiling and what was used across
 * every `runtime execute` of the same run; the scheduler checks it between attempts and caps the next attempt to the
 * turns that are left, so the run never goes past the turn ceiling.
 *
 * Limits come from `--budget-turns` / `--budget-usd` (they replace the ledger's limits and keep what was used),
 * otherwise from PLAN.json `budget: { turns?, usd?, max_retries? }`. `--budget-reset` starts the count again.
 */

const fs = require('fs');
const path = require('path');

function ledgerPath(projectRoot, runId) {
  return path.join(projectRoot, '.oxe', 'runs', `${runId}.budget.json`);
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readLedger(projectRoot, runId) {
  try {
    const data = JSON.parse(fs.readFileSync(ledgerPath(projectRoot, runId), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writeLedger(projectRoot, ledger) {
  const file = ledgerPath(projectRoot, ledger.run_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * The run's ledger with the limits of this invocation. Returns null when no limit is set anywhere.
 * @param {{ turns?: number, usd?: number, reset?: boolean, plan?: { turns?: number, usd?: number } }} limits
 */
function openBudget(projectRoot, runId, limits = {}) {
  const existing = limits.reset ? null : readLedger(projectRoot, runId);
  const planLimits = limits.plan && typeof limits.plan === 'object' ? limits.plan : {};
  // OXB-036: the program's budget policy (PROGRAM.json budget_policy) is the user's decision for every phase:
  // track_only = no cap (only explicit CLI flags cap; spend is still recorded); cap with usd/turns = the cap, over the
  // ledger's previous limit and the PLAN.json budget. CLI flags always win.
  const policy = limits.policy && typeof limits.policy === 'object' ? limits.policy : null;
  const trackOnly = Boolean(policy && policy.mode === 'track_only');
  const turns = trackOnly
    ? positive(limits.turns)
    : positive(limits.turns) ?? positive(policy && policy.turns) ?? (existing ? existing.limit_turns : null) ?? positive(planLimits.turns);
  const usd = trackOnly
    ? positive(limits.usd)
    : positive(limits.usd) ?? positive(policy && policy.usd) ?? (existing ? existing.limit_usd : null) ?? positive(planLimits.usd);
  if (turns == null && usd == null && !trackOnly && !(existing && existing.policy === 'track_only')) return null;
  const now = new Date().toISOString();
  const ledger = {
    run_id: runId,
    limit_turns: turns ?? null,
    limit_usd: usd ?? null,
    policy: policy ? policy.mode : (existing && existing.policy) || 'cap',
    used_turns: existing ? Number(existing.used_turns) || 0 : 0,
    used_usd: existing ? Number(existing.used_usd) || 0 : 0,
    attempts: existing && Array.isArray(existing.attempts) ? existing.attempts : [],
    started_at: existing ? existing.started_at : now,
    updated_at: now,
  };
  writeLedger(projectRoot, ledger);
  return ledger;
}

/** Adds one attempt's usage (an `executor_usage` detail) and persists. */
function recordUsage(projectRoot, ledger, usage) {
  if (!ledger) return ledger;
  const turns = Number(usage && usage.turns) || 0;
  const cost = Number(usage && usage.cost_usd) || 0;
  ledger.used_turns += turns;
  ledger.used_usd = Math.round((ledger.used_usd + cost) * 1e6) / 1e6;
  ledger.attempts.push({ task: usage && usage.task ? usage.task : null, attempt: usage && usage.attempt ? usage.attempt : null, turns, cost_usd: cost, at: new Date().toISOString() });
  ledger.updated_at = new Date().toISOString();
  writeLedger(projectRoot, ledger);
  return ledger;
}

function remainingTurns(ledger) {
  if (!ledger || ledger.limit_turns == null) return null;
  return Math.max(0, ledger.limit_turns - ledger.used_turns);
}

function exhaustedReason(ledger) {
  if (!ledger) return null;
  if (ledger.limit_turns != null && ledger.used_turns >= ledger.limit_turns) {
    return `budget_turns: ${ledger.used_turns}/${ledger.limit_turns} turnos usados`;
  }
  if (ledger.limit_usd != null && ledger.used_usd >= ledger.limit_usd) {
    return `budget_usd: US$ ${ledger.used_usd.toFixed(2)}/${ledger.limit_usd.toFixed(2)} usados`;
  }
  return null;
}

/** The scheduler's RunBudget over a live ledger. */
function schedulerBudget(ledger) {
  if (!ledger) return undefined;
  return {
    exhausted: () => exhaustedReason(ledger),
    remainingTurns: () => remainingTurns(ledger),
  };
}

/** One-line summary for `runtime status` / execute output. */
function describeBudget(ledger) {
  if (!ledger) return null;
  const parts = [];
  if (ledger.limit_turns != null) parts.push(`${ledger.used_turns}/${ledger.limit_turns} turnos`);
  else parts.push(`${ledger.used_turns} turnos`);
  if (ledger.limit_usd != null) parts.push(`US$ ${ledger.used_usd.toFixed(2)}/${ledger.limit_usd.toFixed(2)}`);
  else parts.push(`US$ ${ledger.used_usd.toFixed(2)}`);
  const reason = exhaustedReason(ledger);
  return `${parts.join(' · ')}${reason ? ' — esgotado' : ''}`;
}

module.exports = { ledgerPath, readLedger, openBudget, recordUsage, remainingTurns, exhaustedReason, schedulerBudget, describeBudget };
