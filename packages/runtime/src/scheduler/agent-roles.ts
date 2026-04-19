import type { TaskResult } from './scheduler';

export type AgentRole = 'planner' | 'executor' | 'reviewer' | 'verifier';

export interface AgentBudget {
  max_tokens: number;
  max_time_ms: number;
  max_retries: number;
  consumed_tokens: number;
  consumed_time_ms: number;
  consumed_retries: number;
}

export interface CooperativeHandoff {
  handoff_id: string;
  from_agent_id: string;
  to_agent_id: string;
  from_role: AgentRole;
  to_role: AgentRole;
  work_item_id: string;
  context_pack_ref: string | null;
  transferred_at: string;
}

export interface AgentActionLog {
  agent_id: string;
  role: AgentRole;
  work_item_id: string;
  action: 'execute' | 'verify' | 'review' | 'plan';
  result: 'success' | 'failure';
  duration_ms: number;
  timestamp: string;
}

export function createBudget(
  opts: Partial<Omit<AgentBudget, 'consumed_tokens' | 'consumed_time_ms' | 'consumed_retries'>> = {}
): AgentBudget {
  return {
    max_tokens: opts.max_tokens ?? Infinity,
    max_time_ms: opts.max_time_ms ?? Infinity,
    max_retries: opts.max_retries ?? Infinity,
    consumed_tokens: 0,
    consumed_time_ms: 0,
    consumed_retries: 0,
  };
}

export function consumeBudget(
  budget: AgentBudget,
  delta: { tokens?: number; time_ms?: number; retries?: number }
): AgentBudget {
  return {
    ...budget,
    consumed_tokens: budget.consumed_tokens + (delta.tokens ?? 0),
    consumed_time_ms: budget.consumed_time_ms + (delta.time_ms ?? 0),
    consumed_retries: budget.consumed_retries + (delta.retries ?? 0),
  };
}

export function isBudgetExhausted(budget: AgentBudget): boolean {
  return (
    budget.consumed_tokens >= budget.max_tokens ||
    budget.consumed_time_ms >= budget.max_time_ms ||
    budget.consumed_retries >= budget.max_retries
  );
}

export function buildHandoff(opts: {
  from_agent_id: string;
  to_agent_id: string;
  from_role: AgentRole;
  to_role: AgentRole;
  work_item_id: string;
  context_pack_ref?: string | null;
}): CooperativeHandoff {
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

export class ArbitrationEngine {
  /**
   * Choose the best result from multiple competing agents.
   * Prefers success; among successes prefers more evidence; falls back to first.
   */
  arbitrate(results: Array<{ agent_id: string; result: TaskResult }>): TaskResult {
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
