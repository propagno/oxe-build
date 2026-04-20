import type { RunState } from '../reducers/run-state-reducer';
import type { ExecutionGraph } from '../compiler/graph-compiler';
import type { VerificationResult } from '../models/verification-result';
import type { CheckResult } from '../verification/verification-compiler';
import type { VerificationManifest, ResidualRiskLedger } from '../verification/verification-manifest';
export declare class ProjectionEngine {
    projectPlan(state: RunState, graph: ExecutionGraph): string;
    projectVerify(state: RunState, results: VerificationResult[], checkResults?: CheckResult[], manifest?: VerificationManifest | null, riskLedger?: ResidualRiskLedger | null, evidenceCoverage?: {
        total_checks: number;
        checks_with_evidence: number;
        total_evidence_refs: number;
        coverage_percent: number;
    } | null): string;
    projectState(state: RunState): string;
    projectRunSummary(state: RunState): string;
    projectPRSummary(state: RunState, graph: ExecutionGraph): string;
    projectCommitSummary(state: RunState, graph: ExecutionGraph): string;
    projectPromotionSummary(state: RunState, graph: ExecutionGraph): string;
}
