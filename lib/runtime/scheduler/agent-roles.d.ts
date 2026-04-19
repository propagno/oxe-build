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
export declare function createBudget(opts?: Partial<Omit<AgentBudget, 'consumed_tokens' | 'consumed_time_ms' | 'consumed_retries'>>): AgentBudget;
export declare function consumeBudget(budget: AgentBudget, delta: {
    tokens?: number;
    time_ms?: number;
    retries?: number;
}): AgentBudget;
export declare function isBudgetExhausted(budget: AgentBudget): boolean;
export declare function buildHandoff(opts: {
    from_agent_id: string;
    to_agent_id: string;
    from_role: AgentRole;
    to_role: AgentRole;
    work_item_id: string;
    context_pack_ref?: string | null;
}): CooperativeHandoff;
export declare class ArbitrationEngine {
    /**
     * Choose the best result from multiple competing agents.
     * Prefers success; among successes prefers more evidence; falls back to first.
     */
    arbitrate(results: Array<{
        agent_id: string;
        result: TaskResult;
    }>): TaskResult;
}
