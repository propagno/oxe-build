export type ChangeStrategy = 'minimal_patch' | 'isolated_refactor' | 'expand_contract' | 'feature_flag' | 'no_op';
export interface BlastRadiusEstimate {
    estimated_files: number;
    subsystems: string[];
    risk_score: number;
    reversible: boolean;
}
export interface RollbackPlan {
    strategy: 'revert_commit' | 'restore_workspace' | 'undo_patch' | 'no_rollback';
    steps: string[];
    estimated_cost: 'low' | 'medium' | 'high';
    preconditions: string[];
}
export interface DecisionMemo {
    memo_id: string;
    work_item_id: string;
    run_id: string;
    problem_summary: string;
    chosen_strategy: ChangeStrategy;
    alternatives_rejected: Array<{
        strategy: ChangeStrategy;
        reason: string;
    }>;
    blast_radius: BlastRadiusEstimate;
    rollback_plan: RollbackPlan;
    min_evidence_required: string[];
    confidence: number;
    created_at: string;
}
export declare function buildBlastRadius(mutationScope: string[], retryCount: number, riskLevel: string): BlastRadiusEstimate;
export declare function buildRollbackPlan(blastRadius: BlastRadiusEstimate, retryCount: number): RollbackPlan;
export declare class StrategySelector {
    select(mutationScope: string[], retryCount: number, riskLevel: string): ChangeStrategy;
    alternatives(chosen: ChangeStrategy, mutationScope: string[], riskLevel: string): Array<{
        strategy: ChangeStrategy;
        reason: string;
    }>;
    private rejectionReason;
}
export interface BuildMemoInput {
    work_item_id: string;
    run_id: string;
    problem_summary: string;
    mutation_scope: string[];
    retry_count: number;
    risk_level: string;
    min_evidence_required?: string[];
    confidence?: number;
}
export declare function buildMemo(input: BuildMemoInput): DecisionMemo;
export declare function saveMemo(projectRoot: string, memo: DecisionMemo): void;
export declare function loadMemo(projectRoot: string, runId: string, memoId: string): DecisionMemo | null;
export declare function listMemos(projectRoot: string, runId: string): DecisionMemo[];
