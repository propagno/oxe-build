import type { VerificationStatus } from '../models/verification-result';
import type { CheckResult } from './verification-compiler';
export type VerificationProfile = 'quick' | 'standard' | 'critical';
/** Verification-specific failure classification (why a check failed, not why a task failed). */
export type VerificationFailureClass = 'deterministic' | 'flaky' | 'timeout' | 'env_setup' | 'policy_failure' | 'evidence_missing';
/** @deprecated Use VerificationFailureClass. Kept for backwards compat. */
export type FailureClass = VerificationFailureClass;
export type VerificationGranularity = 'work_item' | 'wave' | 'run';
export interface ManifestCheck {
    check_id: string;
    acceptance_ref: string | null;
    status: VerificationStatus;
    failure_class: VerificationFailureClass | null;
    evidence_refs: string[];
    duration_ms: number;
}
export interface VerificationManifest {
    manifest_id: string;
    run_id: string;
    work_item_id: string | null;
    wave: number | null;
    granularity: VerificationGranularity;
    profile: VerificationProfile;
    compiled_at: string;
    checks: ManifestCheck[];
    summary: {
        total: number;
        pass: number;
        fail: number;
        skip: number;
        error: number;
        all_passed: boolean;
    };
}
export interface ResidualRisk {
    risk_id: string;
    work_item_id: string | null;
    check_id: string | null;
    failure_class: FailureClass;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    mitigation: string | null;
}
export interface ResidualRiskLedger {
    run_id: string;
    generated_at: string;
    risks: ResidualRisk[];
}
export interface EvidenceCoverageSummary {
    total_checks: number;
    checks_with_evidence: number;
    total_evidence_refs: number;
    coverage_percent: number;
}
export declare function classifyFailure(result: CheckResult): FailureClass | null;
export declare function buildManifest(runId: string, results: CheckResult[], options?: {
    workItemId?: string;
    wave?: number;
    granularity?: VerificationGranularity;
    profile?: VerificationProfile;
    evidenceRefs?: Map<string, string[]>;
}): VerificationManifest;
export declare function buildRiskLedger(runId: string, manifest: VerificationManifest): ResidualRiskLedger;
export declare function summarizeEvidenceCoverage(manifest: VerificationManifest): EvidenceCoverageSummary;
export declare function saveManifest(projectRoot: string, runId: string, manifest: VerificationManifest): void;
export declare function loadManifest(projectRoot: string, runId: string): VerificationManifest | null;
export declare function saveRiskLedger(projectRoot: string, runId: string, ledger: ResidualRiskLedger): void;
export declare function loadRiskLedger(projectRoot: string, runId: string): ResidualRiskLedger | null;
export declare function saveEvidenceCoverage(projectRoot: string, runId: string, coverage: EvidenceCoverageSummary): void;
export declare function loadEvidenceCoverage(projectRoot: string, runId: string): EvidenceCoverageSummary | null;
