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
    /** Every verify segment's output with headers (1.21.2, OXB-066), for the attempt log. */
    verify_log?: string;
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
    /** OXB-155: per-segment timeout of the task verify (the caller passes config verify_timeout_ms; default 10 min). */
    verifyTimeoutMs?: number;
    maxRunDurationMs?: number;
    staleProgressMs?: number;
}
/** OXB-050: what integrating a worktree's work into the program checkout did. */
export interface ParallelIntegration {
    ok: boolean;
    /** In-scope files copied into the program checkout (relative paths). */
    files: string[];
    /** Files the attempt changed outside its mutation_scope (never copied). */
    outside: string[];
    error?: string;
}
/**
 * OXB-050 (opt-in `--parallel-mutating`): the mutating nodes of a wave with disjoint `mutation_scope` run at the same
 * time, each in its own isolated workspace (`manager`, a git worktree with prepared dependencies). A node whose verify
 * passes there is integrated into the program checkout under a lock — in-scope files only — and verified again on the
 * integrated tree before it completes. Concurrency is bounded by `maxParallel` and by free memory per agent.
 */
export interface ParallelMutatingOptions {
    maxParallel: number;
    /** Free memory (MB) required to START another parallel node (one always runs). */
    minFreeMb?: number;
    freeMb?: () => number;
    manager: WorkspaceManager;
    integrate: (node: GraphNode, lease: WorkspaceLease) => ParallelIntegration | Promise<ParallelIntegration>;
    /** Undo an integration whose verify on the integrated tree failed. */
    discard: (files: string[]) => void | Promise<void>;
}
/** Two scopes may touch the same file: equal paths, one a directory prefix of the other, or a glob in either. */
export declare function scopesOverlap(a: string[], b: string[]): boolean;
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
    parallel?: ParallelMutatingOptions;
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
    /** OXB-050: integrations into the program checkout happen one at a time (copy, verify, checkpoint). */
    private integrationChain;
    private withIntegrationLock;
    private executeRollback;
    run(graph: ExecutionGraph, ctx: SchedulerContext): Promise<RunResult>;
    /**
     * Recover a previously paused run by loading its journal and re-running
     * only the work items that haven't completed yet.
     */
    recover(runId: string, ctx: SchedulerContext, graph: ExecutionGraph): Promise<RunResult | null>;
    private isConcurrentSafe;
    private runWave;
    /** OXB-050: a pool over the wave's mutating nodes — disjoint scopes only, `maxParallel`, memory per agent. */
    private runMutationsInParallel;
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
/** One `&&` segment of a task verify, as run (1.21.2, OXB-066). */
export interface VerifySegmentRun {
    index: number;
    total: number;
    command: string;
    status: string;
    check?: CheckResult;
}
export interface VerifyNodeResult {
    status: string;
    gaps?: string[];
    /** The failing segment's check (or the last one run). */
    check?: CheckResult;
    /** The segment that failed, when the verify has segments and one failed. */
    segment?: {
        index: number;
        total: number;
        command: string;
        exit_code: number | null;
    } | null;
    segments?: VerifySegmentRun[];
}
/**
 * Top-level `&&` segments of a verify command (quoted text is not split). Same rule as the dry-verify (OXB-018), so
 * what the planner checks before execution is what runs after.
 */
export declare function splitVerifySegments(command: string): string[];
/** Every segment's output with a header per segment, for the attempt log (`attempts/<Tn>-<n>.log`). */
export declare function buildVerifyLog(segments: VerifySegmentRun[] | undefined, maxLinesPerSegment?: number): string;
export declare function describeVerifyFailure(command: string | null | undefined, check: CheckResult | undefined, gaps?: string[], segment?: {
    index: number;
    total: number;
    command: string;
} | null): string;
/** Normalized failure fingerprint: timings, timestamps, hashes and temp paths removed. */
export declare function verifyFailureSignature(check: CheckResult | undefined): string | null;
