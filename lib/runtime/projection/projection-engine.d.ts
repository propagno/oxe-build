import type { RunState } from '../reducers/run-state-reducer';
import type { ExecutionGraph } from '../compiler/graph-compiler';
import type { VerificationResult } from '../models/verification-result';
import type { CheckResult } from '../verification/verification-compiler';
export declare class ProjectionEngine {
    projectPlan(state: RunState, graph: ExecutionGraph): string;
    projectVerify(state: RunState, results: VerificationResult[], checkResults?: CheckResult[]): string;
    projectState(state: RunState): string;
    projectRunSummary(state: RunState): string;
    projectPRSummary(state: RunState, graph: ExecutionGraph): string;
}
