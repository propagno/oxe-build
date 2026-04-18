import type { EvidenceType } from '../models/evidence';
import type { VerificationStatus } from '../models/verification-result';
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
export declare function summarizeSuite(results: CheckResult[]): {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    error: number;
    allPassed: boolean;
};
export {};
