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
    }): Promise<TaskResult>;
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
    pause(): void;
    resume(): void;
    cancel(): void;
    getJournal(): RunJournal | null;
    static loadJournal(projectRoot: string, runId: string): RunJournal | null;
    private executeNode;
    private verifyNode;
    private evaluatePolicyForNode;
    private requestGateForNode;
    private blockNode;
    private consumeQuotaForNode;
    private consumeRetryQuota;
    private emit;
}
