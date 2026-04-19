import type { ExecutionGraph } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { TaskExecutor, SchedulerContext } from './scheduler';
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
}
export declare class MultiAgentCoordinator {
    run(graph: ExecutionGraph, opts: CoordinationOptions): Promise<CoordinationResult>;
}
