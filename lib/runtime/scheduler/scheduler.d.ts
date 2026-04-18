import type { OxeEvent } from '../events/envelope';
import type { ExecutionGraph, GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { WorkspaceLease } from '../models/workspace';
export interface TaskResult {
    success: boolean;
    failure_class: 'env' | 'policy' | 'test' | 'timeout' | null;
    evidence: string[];
    output: string;
}
export interface TaskExecutor {
    execute(node: GraphNode, lease: WorkspaceLease, runId: string, attemptNumber: number): Promise<TaskResult>;
}
export interface SchedulerContext {
    projectRoot: string;
    sessionId: string | null;
    runId: string;
    executor: TaskExecutor;
    workspaceManager: WorkspaceManager;
    onEvent?: (event: OxeEvent) => void;
}
export interface RunResult {
    run_id: string;
    status: 'completed' | 'failed' | 'cancelled';
    completed: string[];
    failed: string[];
    blocked: string[];
}
export declare class Scheduler {
    private cancelled;
    private paused;
    run(graph: ExecutionGraph, ctx: SchedulerContext): Promise<RunResult>;
    private runWave;
    private runNode;
    pause(): void;
    resume(): void;
    cancel(): void;
    private emit;
}
