export type PromotionTarget = 'local_commit' | 'remote_promotion';
export type PromotionRemoteTarget = 'pr_draft' | 'branch_push';
export interface CommitRecord {
    run_id: string;
    branch: string;
    commit_sha: string | null;
    status: 'pending' | 'committed' | 'blocked';
    created_at: string;
    committed_at: string | null;
    message: string | null;
    summary_path: string | null;
}
export interface PromotionRecord {
    run_id: string;
    target: PromotionTarget;
    target_kind: PromotionRemoteTarget;
    branch: string;
    status: 'pending' | 'open' | 'merged' | 'closed' | 'blocked' | 'promoted';
    created_at: string;
    promoted_at: string | null;
    summary_path: string | null;
    remote: string | null;
    target_ref: string | null;
    pr_url: string | null;
    pr_number: number | null;
    reasons?: string[];
    coverage_percent?: number | null;
}
export declare function commitRecordPath(projectRoot: string, runId: string): string;
export declare function promotionRecordPath(projectRoot: string, runId: string): string;
export declare function saveCommitRecord(projectRoot: string, runId: string, record: CommitRecord): void;
export declare function loadCommitRecord(projectRoot: string, runId: string): CommitRecord | null;
export declare function savePromotionRecord(projectRoot: string, runId: string, record: PromotionRecord): void;
export declare function loadPromotionRecord(projectRoot: string, runId: string): PromotionRecord | null;
