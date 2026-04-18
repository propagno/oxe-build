import type { EvidenceStore } from '../evidence/evidence-store';
export type CICheckStatus = 'pass' | 'fail' | 'skip' | 'error';
export interface CICheckContext {
    projectRoot: string;
    sessionId: string | null;
    runId?: string;
    evidenceStore?: EvidenceStore;
}
export interface CICheckResult {
    check: string;
    status: CICheckStatus;
    message: string;
    details?: unknown;
}
export interface CICheck {
    name: string;
    description: string;
    run(ctx: CICheckContext): Promise<CICheckResult>;
}
export declare const planConsistencyCheck: CICheck;
export declare const verifyAcceptanceCheck: CICheck;
export declare const policyCheck: CICheck;
export declare const securityBaselineCheck: CICheck;
export declare const runtimeEvidenceIntegrityCheck: CICheck;
export declare const OXE_CI_CHECKS: CICheck[];
export declare function runCIChecks(ctx: CICheckContext, checks?: CICheck[]): Promise<CICheckResult[]>;
export declare function summarizeCIResults(results: CICheckResult[]): {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    error: number;
    allPassed: boolean;
};
