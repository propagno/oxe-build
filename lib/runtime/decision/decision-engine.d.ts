import type { DecisionMemo } from './decision-memo';
export type DecisionType = 'proceed' | 'retry' | 'escalate_gate' | 'skip' | 'abort' | 'promote_lesson';
export type DecisionSignal = 'policy_allowed' | 'policy_denied' | 'gate_pending' | 'gate_approved' | 'evidence_sufficient' | 'evidence_missing' | 'retry_budget_available' | 'retry_budget_exhausted' | 'lesson_match' | 'risk_high';
export type SeniorityLevel = 'junior' | 'standard' | 'senior' | 'expert';
export interface DecisionRecord {
    decision_id: string;
    work_item_id: string | null;
    run_id: string;
    type: DecisionType;
    seniority: SeniorityLevel;
    confidence: number;
    signals: DecisionSignal[];
    rationale: string;
    timestamp: string;
    memo?: DecisionMemo;
}
export interface DecisionLog {
    run_id: string;
    decisions: DecisionRecord[];
}
export interface DecisionInput {
    work_item_id?: string;
    run_id: string;
    policy_allowed: boolean;
    gate_pending: boolean;
    gate_approved: boolean;
    retry_count: number;
    max_retries: number;
    evidence_count: number;
    risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical';
    lesson_match: boolean;
    memo?: DecisionMemo;
}
export declare class DecisionEngine {
    evaluate(input: DecisionInput): DecisionRecord;
}
export declare function appendDecision(projectRoot: string, runId: string, record: DecisionRecord): void;
export declare function loadDecisionLog(projectRoot: string, runId: string): DecisionLog | null;
export declare function queryDecisions(log: DecisionLog, filter: {
    type?: DecisionType;
    workItemId?: string;
    minConfidence?: number;
}): DecisionRecord[];
