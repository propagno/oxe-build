import type { RunState } from '../reducers/run-state-reducer';
import type { ExecutionGraph } from '../compiler/graph-compiler';
import type { VerificationResult } from '../models/verification-result';
import type { CheckResult } from '../verification/verification-compiler';
import type { VerificationManifest, ResidualRiskLedger } from '../verification/verification-manifest';
/**
 * Bench B30: the check cell carried the whole TAP output (`npm test` repeated in every check that runs it) — F1's
 * VERIFY.md reached 93 KB and F2's ~9k lines, re-read by every agent. One line per check; the full output stays
 * in the evidence file the row already links.
 */
export declare function checkSummaryLine(summary: string | null | undefined, fallback: string): string;
/** One `ExecutorUsage` event: an executor attempt's turns, tool calls and cost. */
export interface ExecutorUsageRow {
    work_item_id: string;
    attempt?: number | null;
    turns?: number | null;
    tool_calls?: number | null;
    cost_usd?: number | null;
    adapter?: string | null;
}
export declare class ProjectionEngine {
    projectPlan(state: RunState, graph: ExecutionGraph): string;
    projectVerify(state: RunState, results: VerificationResult[], checkResults?: CheckResult[], manifest?: VerificationManifest | null, riskLedger?: ResidualRiskLedger | null, evidenceCoverage?: {
        total_checks: number;
        checks_with_evidence: number;
        total_evidence_refs: number;
        coverage_percent: number;
    } | null): string;
    projectState(state: RunState): string;
    projectRunSummary(state: RunState, usage?: ExecutorUsageRow[]): string;
    projectPRSummary(state: RunState, graph: ExecutionGraph): string;
    projectCommitSummary(state: RunState, graph: ExecutionGraph): string;
    projectPromotionSummary(state: RunState, graph: ExecutionGraph): string;
}
