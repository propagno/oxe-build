"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArbitrationEngine = void 0;
exports.createBudget = createBudget;
exports.consumeBudget = consumeBudget;
exports.isBudgetExhausted = isBudgetExhausted;
exports.buildHandoff = buildHandoff;
function createBudget(opts = {}) {
    return {
        max_tokens: opts.max_tokens ?? Infinity,
        max_time_ms: opts.max_time_ms ?? Infinity,
        max_retries: opts.max_retries ?? Infinity,
        consumed_tokens: 0,
        consumed_time_ms: 0,
        consumed_retries: 0,
    };
}
function consumeBudget(budget, delta) {
    return {
        ...budget,
        consumed_tokens: budget.consumed_tokens + (delta.tokens ?? 0),
        consumed_time_ms: budget.consumed_time_ms + (delta.time_ms ?? 0),
        consumed_retries: budget.consumed_retries + (delta.retries ?? 0),
    };
}
function isBudgetExhausted(budget) {
    return (budget.consumed_tokens >= budget.max_tokens ||
        budget.consumed_time_ms >= budget.max_time_ms ||
        budget.consumed_retries >= budget.max_retries);
}
function buildHandoff(opts) {
    return {
        handoff_id: `hoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        from_agent_id: opts.from_agent_id,
        to_agent_id: opts.to_agent_id,
        from_role: opts.from_role,
        to_role: opts.to_role,
        work_item_id: opts.work_item_id,
        context_pack_ref: opts.context_pack_ref ?? null,
        transferred_at: new Date().toISOString(),
    };
}
// ─── ArbitrationEngine ────────────────────────────────────────────────────────
class ArbitrationEngine {
    /**
     * Choose the best result from multiple competing agents.
     * Prefers success; among successes prefers more evidence; falls back to first.
     */
    arbitrate(results) {
        if (results.length === 0) {
            return { success: false, failure_class: null, evidence: [], output: 'no results to arbitrate' };
        }
        const successes = results.filter((r) => r.result.success);
        if (successes.length === 0) {
            return results[0].result;
        }
        // Among successes, prefer the one with most evidence
        successes.sort((a, b) => b.result.evidence.length - a.result.evidence.length);
        return successes[0].result;
    }
}
exports.ArbitrationEngine = ArbitrationEngine;
