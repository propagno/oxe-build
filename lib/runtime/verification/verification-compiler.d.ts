import type { ExpectedExport } from './contract-exports';
import type { EvidenceType } from '../models/evidence';
import type { VerificationStatus } from '../models/verification-result';
import type { VerificationResult } from '../models/verification-result';
import type { EvidenceStore } from '../evidence/evidence-store';
import type { PluginRegistry } from '../plugins/plugin-registry';
import { type EvidenceCoverageSummary, type ResidualRiskLedger, type VerificationManifest } from './verification-manifest';
export type CheckType = 'unit' | 'integration' | 'contract' | 'smoke' | 'policy' | 'security' | 'ux_snapshot' | 'performance_baseline' | 'custom'
/** Criterion without an executable verification — never counts as proof. */
 | 'manual';
export interface AcceptanceCheck {
    id: string;
    type: CheckType;
    command: string | null;
    evidence_type_expected: EvidenceType;
    acceptance_ref: string | null;
    description: string;
    /** Paths that must exist in the workspace (IMPLEMENTATION-PACK `exact_paths`); checked before any command. */
    files_exist?: string[];
    /** Symbols the pack contracts per file (`symbols`); JS/TS files are scanned statically. */
    exports_expected?: ExpectedExport[];
    /** Set on checks carried over from a closed program phase (regression). */
    regression_phase?: string | null;
    /**
     * Plan-owned acceptance test files frozen by hash at compile time (1.19). Checked before the
     * command: a missing or modified file fails the check — the executor cannot rewrite its proof.
     */
    frozen_files?: FrozenFile[];
    /**
     * Executed proof (1.20): names of tests (or `file › name`) that must appear as PASSED in the runner output.
     * A green exit code without these named tests is `proof_not_executed`.
     */
    proves?: string[];
}
export interface FrozenFile {
    path: string;
    /** sha256 hex at freeze time; null when the file did not exist when the run was compiled. */
    sha256: string | null;
}
export interface AcceptanceTestLike {
    /** Own id for cross-cutting proofs (e.g. a constraint CR): check id `check-accept-<id>`. Defaults to the criterion. */
    id?: string | null;
    criterion: string | null;
    command: string;
    files: FrozenFile[];
    proves?: string[];
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
    /** Why a check was skipped (`needs_structured_check` = criterion has no executable verification). */
    skip_reason?: string | null;
    /** Test cases the runner reported; null when the output has no recognizable test report. */
    tests_executed?: number | null;
    /** Evidence id of the structured summary record (kept out of `evidence_refs` so coverage counts real output only). */
    summary_evidence_ref?: string | null;
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
    /** Contracted paths from the IMPLEMENTATION-PACK, attached by the caller. */
    filesExist?: string[];
    /** Contracted exports from the IMPLEMENTATION-PACK `symbols`. */
    exportsExpected?: ExpectedExport[];
}
interface ParsedPlanLike {
    tasks: ParsedTaskLike[];
    /** PLAN.json `acceptance_tests` with the hashes frozen when the run was compiled. */
    acceptanceTests?: AcceptanceTestLike[];
}
export declare function sha256File(absPath: string): string | null;
/**
 * Drop quoted arguments so only invoked programs are classified: `node -e "…'node --test'…"`
 * checks package.json, it does not run a test runner.
 */
export declare function stripQuotedArgs(command: string): string;
export declare const SHELL_COMMAND_RE: RegExp;
export declare function looksLikeShellCommand(text: string): boolean;
/**
 * Turn a SPEC "Como verificar" cell into an executable command, or null when it is prose.
 * Only backtick spans that look like commands count; path-like spans (`test/api.test.js`)
 * and free text are never executed.
 */
export declare function extractCommandFromHowToVerify(howToVerify: string): string | null;
/** Bump when the rules that turn SPEC/PLAN into checks change (invalidates persisted suites). */
export declare const VERIFICATION_COMPILER_VERSION = "1.20.0";
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
    /** Skipped checks whose criterion has no executable verification. */
    manual: number;
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
