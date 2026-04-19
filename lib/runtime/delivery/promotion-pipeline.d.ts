import type { PRManager } from './pr-manager';
import type { BranchManager } from './branch-manager';
import type { VerificationManifest, ResidualRiskLedger } from '../verification/verification-manifest';
import type { RunResult } from '../scheduler/scheduler';
export interface RunPRLink {
    run_id: string;
    branch: string;
    pr_url: string | null;
    pr_number: number | null;
    status: 'pending' | 'open' | 'merged' | 'closed' | 'blocked';
    created_at: string;
    merged_at: string | null;
}
export interface PromotionOptions {
    baseBranch?: string;
    draftPR?: boolean;
    autoMerge?: boolean;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
}
export type MergeGateVerdict = 'approved' | 'blocked' | 'needs_review';
export interface MergeGateReport {
    verdict: MergeGateVerdict;
    reasons: string[];
    blocking_risks: string[];
}
export declare class MergeGateEvaluator {
    evaluate(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null): MergeGateReport;
}
export declare class PromotionPipeline {
    private readonly projectRoot;
    private readonly branchManager;
    private readonly prManager;
    private readonly gateEvaluator;
    constructor(projectRoot: string, branchManager: BranchManager, prManager: PRManager, gateEvaluator?: MergeGateEvaluator);
    buildPRBody(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null): string;
    promote(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null, opts?: PromotionOptions): Promise<RunPRLink>;
    savePRLink(runId: string, link: RunPRLink): void;
    loadPRLink(runId: string): RunPRLink | null;
}
