import type { OxeEvent } from '../events/envelope';
import type { Run } from '../models/run';
import type { WorkItem } from '../models/work-item';
import type { Attempt } from '../models/attempt';
import type { Workspace } from '../models/workspace';
export interface PolicyDecisionRecord {
    allowed: boolean;
    gate_required: boolean;
    reason: string;
    rule_id: string | null;
}
export interface ToolFailureRecord {
    tool: string;
    error: string;
    timestamp: string;
}
export interface RunState {
    run: Run | null;
    workItems: Map<string, WorkItem>;
    attempts: Map<string, Attempt[]>;
    workspaces: Map<string, Workspace>;
    completedWorkItems: Set<string>;
    failedWorkItems: Set<string>;
    blockedWorkItems: Set<string>;
    retryCounts: Map<string, number>;
    policyDecisions: Map<string, PolicyDecisionRecord>;
    pendingGates: Set<string>;
    resolvedGates: Map<string, {
        decision: string;
        actor?: string;
    }>;
    verificationStatus: Map<string, 'started' | 'completed' | 'failed'>;
    evidenceRefs: Map<string, string[]>;
    toolFailures: Map<string, ToolFailureRecord[]>;
}
export declare function createEmptyRunState(): RunState;
export declare function reduce(events: OxeEvent[]): RunState;
export { applyEvent as applyEventExported };
declare function applyEvent(state: RunState, event: OxeEvent): RunState;
export declare function getWorkItemStatus(state: RunState, workItemId: string): WorkItem['status'] | null;
export declare function getAttemptCount(state: RunState, workItemId: string): number;
export declare function getRetryCount(state: RunState, workItemId: string): number;
export declare function getPolicyDecision(state: RunState, workItemId: string): PolicyDecisionRecord | null;
export declare function getVerificationStatus(state: RunState, workItemId: string): 'started' | 'completed' | 'failed' | null;
export declare function getEvidenceRefs(state: RunState, workItemId: string): string[];
export declare function getToolFailures(state: RunState, workItemId: string): ToolFailureRecord[];
