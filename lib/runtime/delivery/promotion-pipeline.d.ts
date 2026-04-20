import type { PRManager } from './pr-manager';
import type { BranchManager } from './branch-manager';
import type { VerificationManifest, ResidualRiskLedger } from '../verification/verification-manifest';
import type { EvidenceCoverageSummary } from '../verification/verification-manifest';
import type { RunResult } from '../scheduler/scheduler';
import type { GateToken } from '../gate/gate-manager';
import { type CommitRecord, type PromotionRecord, type PromotionRemoteTarget } from './delivery-records';
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
    targetRef?: string;
    remote?: string;
    targetKind?: PromotionRemoteTarget;
    minimumCoverage?: number;
}
export type MergeGateVerdict = 'approved' | 'blocked' | 'needs_review';
export interface MergeGateReport {
    verdict: MergeGateVerdict;
    reasons: string[];
    blocking_risks: string[];
    pending_gates: Array<{
        gate_id: string;
        scope: string;
        work_item_id: string | null;
    }>;
}
export declare class MergeGateEvaluator {
    evaluate(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null, gates?: GateToken[], evidenceCoverage?: EvidenceCoverageSummary | null, minimumCoverage?: number): MergeGateReport;
}
export declare class PromotionPipeline {
    private readonly projectRoot;
    private readonly branchManager;
    private readonly prManager;
    private readonly gateEvaluator;
    constructor(projectRoot: string, branchManager: BranchManager, prManager: PRManager, gateEvaluator?: MergeGateEvaluator);
    private baseSummaryLines;
    buildCommitSummary(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null, commitMessage?: string | null): string;
    buildPromotionSummary(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null): string;
    buildPRBody(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null): string;
    recordLocalCommit(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null, options?: {
        commitMessage?: string;
        commitSha?: string | null;
        summaryPath?: string | null;
    }): CommitRecord;
    promote(runResult: RunResult, manifest: VerificationManifest | null, riskLedger: ResidualRiskLedger | null, opts?: PromotionOptions, gates?: GateToken[], evidenceCoverage?: EvidenceCoverageSummary | null): Promise<PromotionRecord>;
    loadCommitRecord(runId: string): CommitRecord | null;
    loadPromotionRecord(runId: string): PromotionRecord | null;
    savePRLink(runId: string, link: RunPRLink): void;
    loadPRLink(runId: string): RunPRLink | null;
    private asRunPRLink;
    private safeCurrentCommit;
}
