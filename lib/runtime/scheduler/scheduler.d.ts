import type { OxeEvent } from '../events/envelope';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { WorkspaceLease } from '../models/workspace';
import type { GateManager } from '../gate/gate-manager';
import type { PolicyEngine } from '../policy/policy-engine';
import type { PluginRegistry } from '../plugins/plugin-registry';
import type { AuditTrail } from '../audit/audit-trail';
import type { RunQuota } from '../audit/audit-trail';
import type { RunJournal } from './run-journal';
import type { FailureClass } from '../models/failure';
import type { CheckResult } from '../verification/verification-compiler';
export interface TaskResult {
    success: boolean;
    failure_class: FailureClass;
    evidence: string[];
    output: string;
    completed_by?: string;
}
export interface TaskExecutor {
    execute(node: GraphNode, lease: WorkspaceLease, runId: string, attemptNumber: number, options?: {
        previousError?: string | null;
        maxTurns?: number | null;
    }): Promise<TaskResult>;
}
/**
 * Turn/cost ceiling of a run (1.21, OXB-023), kept by the caller from the executor's usage. The scheduler checks it
 * between attempts — never killing one mid-way — and caps the next attempt to the turns that are left, so the run
 * cannot go past the turn ceiling.
 */
export interface RunBudget {
    /** Why no further attempt may start, or null while there is budget. */
    exhausted(): string | null;
    /** Turns still allowed (the next attempt's cap), or null when turns are unlimited. */
    remainingTurns(): number | null;
}
export interface SchedulerOptions {
    maxRunDurationMs?: number;
    staleProgressMs?: number;
}
export interface SchedulerContext {
    projectRoot: string;
    sessionId: string | null;
    runId: string;
    executor: TaskExecutor;
    workspaceManager: WorkspaceManager;
    gateManager?: GateManager;
    policyEngine?: PolicyEngine;
    pluginRegistry?: PluginRegistry;
    auditTrail?: AuditTrail;
    quota?: RunQuota;
    budget?: RunBudget;
    policyActor?: string;
    onEvent?: (event: OxeEvent) => void;
    options?: SchedulerOptions;
}
export interface RunResult {
    run_id: string;
    status: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'paused' | 'aborted';
    completed: string[];
    failed: string[];
    blocked: string[];
    pending_gates?: string[];
    reason?: string;
}
export declare class Scheduler {
    private cancelled;
    private paused;
    private journal;
    private ctx;
    private runStartMs;
    private lastProgressMs;
    private recordProgress;
    private executeRollback;
    run(graph: ExecutionGraph, ctx: SchedulerContext): Promise<RunResult>;
    /**
     * Recover a previously paused run by loading its journal and re-running
     * only the work items that haven't completed yet.
     */
    recover(runId: string, ctx: SchedulerContext, graph: ExecutionGraph): Promise<RunResult | null>;
    private isConcurrentSafe;
    private runWave;
    private runNode;
    /** Abort keeps the progress made so far: an aborted run is recoverable, not a blank slate. */
    private abortRun;
    pause(): void;
    resume(): void;
    cancel(): void;
    getJournal(): RunJournal | null;
    static loadJournal(projectRoot: string, runId: string): RunJournal | null;
    private executeNode;
    private verifyNode;
    private evaluatePolicyForNode;
    /** An approval already granted for this node in this run must not be requested again on re-execution. */
    private hasApprovedGate;
    private requestGateForNode;
    /**
     * A node delivered by another path (`verify_only`) or waiting on external work (`external_dependency`): no agent.
     * verify_only runs only the node's verify — green completes it; red (or no verify) leaves it waiting. A node with an
     * external dependency and no verify_only waits without a gate, so the rest of the run (and the next preflight) goes on.
     */
    private runExternalNode;
    private blockNode;
    private consumeQuotaForNode;
    private consumeRetryQuota;
    private emit;
}
/** Last `n` non-empty lines of a text. */
export declare function tailLines(text: string, n: number): string;
/** What the next attempt needs to know about a failed task verify (1.20c informed retry). */
export declare function describeVerifyFailure(command: string | null | undefined, check: CheckResult | undefined, gaps?: string[]): string;
/** Normalized failure fingerprint: timings, timestamps, hashes and temp paths removed. */
export declare function verifyFailureSignature(check: CheckResult | undefined): string | null;
