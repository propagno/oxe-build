'use strict';

/**
 * OXB-131: the model of each attempt. Config `models: { tiers: { fast, balanced, powerful }, default_tier, escalate_on:
 * ["logic"], max_escalations: 1, overrides: { T3: "<model>" } }`. Precedence: an explicit override (config
 * `models.overrides[task]` or the task's `model`) > tier escalation > the task's `model_hint` (fast|balanced|powerful).
 * The first attempt uses the task's tier; a failure of a class in `escalate_on` moves the NEXT attempt one tier up,
 * at most `max_escalations` times; an environment failure never escalates.
 */

const ORDER = ['fast', 'balanced', 'powerful'];

/** The runtime's failure classes → the classes of the config (OXB-120 vocabulary). */
function failureKind(cls) {
  const c = String(cls || '');
  if (!c) return null;
  if (['verify', 'llm', 'logic', 'no_tool_call', 'turn_limit_exhausted', 'scope_violation'].includes(c)) return 'logic';
  if (['env', 'environment', 'paused_environment', 'timeout'].includes(c)) return 'environment';
  if (c.startsWith('quota') || c === 'paused_quota') return 'quota';
  return c;
}

function createModelSelector(config, tasksById) {
  const m = (config && config.models) || {};
  const tiers = m.tiers || null;
  if (!tiers && !m.overrides) return null;
  const escalateOn = new Set(Array.isArray(m.escalate_on) ? m.escalate_on : ['logic']);
  const max = Number.isInteger(m.max_escalations) ? m.max_escalations : 1;
  const state = new Map(); // task → { tierIndex, escalations }
  return (taskId, attempt, lastFailureClass) => {
    const task = tasksById.get(taskId) || {};
    const override = (m.overrides && m.overrides[taskId]) || task.model || null;
    if (override) return { model: String(override), tier: 'override', escalated: false };
    if (!tiers) return null;
    const startTier = ORDER.includes(task.model_hint) ? task.model_hint : ORDER.includes(m.default_tier) ? m.default_tier : 'balanced';
    let st = state.get(taskId);
    if (!st || attempt === 1) { st = { tierIndex: ORDER.indexOf(startTier), escalations: 0 }; state.set(taskId, st); }
    let escalated = false;
    if (attempt > 1 && escalateOn.has(failureKind(lastFailureClass)) && st.escalations < max && st.tierIndex < ORDER.length - 1) {
      st.tierIndex += 1;
      st.escalations += 1;
      escalated = true;
    }
    const tier = ORDER[st.tierIndex];
    return { model: tiers[tier] || null, tier, escalated };
  };
}

/** Cost per tier from the events: AttemptStarted (tier) joined with ExecutorUsage (cost) by task + attempt. */
function costByTier(events) {
  const tierOf = new Map();
  for (const e of events) if (e && e.type === 'AttemptStarted' && e.payload && e.payload.tier) tierOf.set(`${e.run_id}|${e.work_item_id}|${e.payload.attempt_number}`, e.payload.tier);
  const out = {};
  for (const e of events) {
    if (!e || e.type !== 'ExecutorUsage' || !e.payload) continue;
    const tier = tierOf.get(`${e.run_id}|${e.work_item_id}|${e.payload.attempt}`);
    if (!tier) continue;
    const c = out[tier] || (out[tier] = { attempts: 0, cost_usd: 0 });
    c.attempts += 1;
    c.cost_usd = Math.round((c.cost_usd + Number(e.payload.cost_usd || 0)) * 10000) / 10000;
  }
  return out;
}

module.exports = { ORDER, failureKind, createModelSelector, costByTier };
