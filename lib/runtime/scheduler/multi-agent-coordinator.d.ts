import type { ExecutionGraph } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { TaskExecutor, TaskResult, SchedulerContext } from './scheduler';
import type { CooperativeHandoff } from './agent-roles';
export type CoordinationMode = 'parallel' | 'competitive' | 'cooperative';
export interface AgentSpec {
    id: string;
    executor: TaskExecutor;
    workspaceManager: WorkspaceManager;
    /** Task IDs this agent is responsible for (used in parallel mode) */
    assignedTaskIds?: string[];
}
export interface CoordinationOptions {
    mode: CoordinationMode;
    agents: AgentSpec[];
    projectRoot: string;
    sessionId: string | null;
    runId: string;
    onEvent?: SchedulerContext['onEvent'];
    heartbeatTimeoutMs?: number;
}
export interface ArbitrationRecord {
    work_item_id: string;
    mode: CoordinationMode;
    winner_agent_id: string | null;
    participant_agent_ids: string[];
    success: boolean;
    failure_class: TaskResult['failure_class'];
    evidence_count: number;
    recorded_at: string;
}
export interface MultiAgentOwnership {
    work_item_id: string;
    owner_agent_id: string;
}
export interface MultiAgentStatusSnapshot {
    run_id: string;
    mode: CoordinationMode;
    workspace_isolation_required: 'isolated';
    workspace_isolation_enforced: boolean;
    agent_count: number;
    ownership: MultiAgentOwnership[];
    completed: string[];
    failed: string[];
    blocked: string[];
    agent_results: Array<{
        agent_id: string;
        isolation_level: 'shared' | 'isolated';
        assigned_task_ids: string[];
        completed: string[];
        failed: string[];
        timed_out: boolean;
        reassigned_task_ids: string[];
    }>;
    orphan_reassignments: Array<{
        from_agent_id: string;
        to_agent_id: string;
        work_item_ids: string[];
    }>;
    timed_out_agents: Array<{
        agent_id: string;
        work_item_ids: string[];
        detected_at: string;
    }>;
    updated_at: string;
}
export interface MultiAgentOperationalSummary {
    run_id: string;
    mode: CoordinationMode;
    workspace_isolation_enforced: boolean;
    agent_count: number;
    completed_count: number;
    failed_count: number;
    blocked_count: number;
    ownership_count: number;
    handoff_count: number;
    arbitration_count: number;
    orphan_reassignment_count: number;
    timeout_count: number;
    participating_agents: string[];
    health: 'healthy' | 'degraded';
    updated_at: string;
}
export interface CoordinationResult {
    mode: CoordinationMode;
    run_id: string;
    completed: string[];
    failed: string[];
    blocked: string[];
    agent_results: Array<{
        agent_id: string;
        completed: string[];
        failed: string[];
    }>;
    handoffs?: CooperativeHandoff[];
    arbitration_results?: ArbitrationRecord[];
    state?: MultiAgentStatusSnapshot;
    summary?: MultiAgentOperationalSummary;
}
export declare class MultiAgentCoordinator {
    run(graph: ExecutionGraph, opts: CoordinationOptions): Promise<CoordinationResult>;
}
export declare function multiAgentStatePath(projectRoot: string, runId: string): string;
export declare function multiAgentSummaryPath(projectRoot: string, runId: string): string;
export declare function loadMultiAgentState(projectRoot: string, runId: string): MultiAgentStatusSnapshot | null;
export declare function loadMultiAgentSummary(projectRoot: string, runId: string): MultiAgentOperationalSummary | null;
