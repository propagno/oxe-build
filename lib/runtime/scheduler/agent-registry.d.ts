import type { TaskExecutor } from './scheduler';
import type { WorkspaceManager } from '../workspace/workspace-manager';
import type { AgentRole, AgentActionLog } from './agent-roles';
export type AgentStatus = 'idle' | 'running' | 'paused' | 'failed' | 'timeout';
export interface AgentHeartbeat {
    agent_id: string;
    last_seen: string;
    current_task: string | null;
    status: AgentStatus;
}
export interface RegisteredAgent {
    id: string;
    executor: TaskExecutor;
    workspaceManager: WorkspaceManager;
    assignedTaskIds: string[];
    heartbeat: AgentHeartbeat;
    role?: AgentRole;
    actionLog: AgentActionLog[];
}
export declare class AgentRegistry {
    private agents;
    private readonly heartbeatTimeoutMs;
    constructor(heartbeatTimeoutMs?: number);
    register(id: string, executor: TaskExecutor, workspaceManager: WorkspaceManager, assignedTaskIds?: string[], role?: AgentRole): RegisteredAgent;
    unregister(id: string): void;
    beat(id: string, currentTask?: string | null): void;
    setStatus(id: string, status: AgentStatus): void;
    isAlive(id: string): boolean;
    /** Returns agents that haven't sent a heartbeat within the timeout window */
    timedOut(): RegisteredAgent[];
    liveAgents(): RegisteredAgent[];
    get(id: string): RegisteredAgent | null;
    list(): RegisteredAgent[];
    /**
     * Reassign orphaned tasks from timed-out agents to a fallback agent.
     * Returns the list of task IDs that were reassigned.
     */
    failover(fallbackAgentId: string): string[];
    /** Return all agents assigned to a given role */
    getByRole(role: AgentRole): RegisteredAgent[];
    /** Append an action log entry for a registered agent (no-op if unknown) */
    logAction(agentId: string, log: AgentActionLog): void;
    clear(): void;
}
