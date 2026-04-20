import type { EvidenceType } from '../models/evidence';
import type { VerificationStatus } from '../models/verification-result';
import type { VerificationResult } from '../models/verification-result';
import type { EvidenceStore } from '../evidence/evidence-store';
import type { PluginRegistry } from '../plugins/plugin-registry';
import { type EvidenceCoverageSummary, type ResidualRiskLedger, type VerificationManifest } from './verification-manifest';
export type CheckType = 'unit' | 'integration' | 'contract' | 'smoke' | 'policy' | 'security' | 'ux_snapshot' | 'performance_baseline' | 'custom';
export interface AcceptanceCheck {
    id: string;
    type: CheckType;
    command: string | null;
    evidence_type_expected: EvidenceType;
    acceptance_ref: string | null;
    description: string;
}
export interface AcceptanceCheckSuite {
    checks: AcceptanceCheck[];
    compiled_at: string;
    spec_hash: string;
    plan_hash: string;
}
export interface CheckResult {
    check_id: string;
    acceptance_ref: string | null;
    status: VerificationStatus;
    stdout: string;
    stderr: string;
    exit_code: number | null;
    duration_ms: number;
    error: string | null;
    evidence_refs?: string[];
}
export interface ExecutedVerificationSuite {
    results: CheckResult[];
    verification_results: VerificationResult[];
    evidence_refs: Map<string, string[]>;
    manifest: VerificationManifest;
    risk_ledger: ResidualRiskLedger;
    evidence_coverage: EvidenceCoverageSummary;
}
export interface VerifyRunResult {
    status: 'passed' | 'failed' | 'partial';
    suite: AcceptanceCheckSuite;
    executed: ExecutedVerificationSuite | null;
    gaps: string[];
    verification_results: VerificationResult[];
    check_results: CheckResult[];
    manifest: VerificationManifest | null;
    risk_ledger: ResidualRiskLedger | null;
    evidence_coverage: EvidenceCoverageSummary | null;
}
interface Criterion {
    id: string;
    criterion: string;
    howToVerify: string;
}
interface ParsedSpecLike {
    objective: string | null;
    criteria: Criterion[];
}
interface ParsedTaskLike {
    id: string;
    verifyCommand: string | null;
    aceite: string[];
}
interface ParsedPlanLike {
    tasks: ParsedTaskLike[];
}
export declare function compile(spec: ParsedSpecLike, plan: ParsedPlanLike): AcceptanceCheckSuite;
export declare function runCheck(check: AcceptanceCheck, cwd: string, timeoutMs?: number): Promise<CheckResult>;
export declare function runSuite(suite: AcceptanceCheckSuite, cwd: string, timeoutMs?: number): Promise<CheckResult[]>;
export declare function executeSuite(suite: AcceptanceCheckSuite, cwd: string, options: {
    timeoutMs?: number;
    runId: string;
    workItemId: string;
    attemptNumber?: number;
    evidenceStore?: EvidenceStore;
    pluginRegistry?: PluginRegistry;
}): Promise<ExecutedVerificationSuite>;
export declare function summarizeSuite(results: CheckResult[]): {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    error: number;
    allPassed: boolean;
};
export declare function verifyRun(input: {
    projectRoot: string;
    runId: string;
    workItemId: string;
    cwd: string;
    suite: AcceptanceCheckSuite;
    pluginRegistry?: PluginRegistry;
    evidenceStore?: EvidenceStore;
    attemptNumber?: number;
    timeoutMs?: number;
}): Promise<VerifyRunResult>;
export {};
