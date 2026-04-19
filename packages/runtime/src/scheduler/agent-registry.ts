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

export class AgentRegistry {
  private agents = new Map<string, RegisteredAgent>();
  private readonly heartbeatTimeoutMs: number;

  constructor(heartbeatTimeoutMs = 30_000) {
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
  }

  register(
    id: string,
    executor: TaskExecutor,
    workspaceManager: WorkspaceManager,
    assignedTaskIds: string[] = [],
    role?: AgentRole
  ): RegisteredAgent {
    if (this.agents.has(id)) throw new Error(`Agent "${id}" is already registered`);
    const agent: RegisteredAgent = {
      id,
      executor,
      workspaceManager,
      assignedTaskIds,
      heartbeat: {
        agent_id: id,
        last_seen: new Date().toISOString(),
        current_task: null,
        status: 'idle',
      },
      role,
      actionLog: [],
    };
    this.agents.set(id, agent);
    return agent;
  }

  unregister(id: string): void {
    this.agents.delete(id);
  }

  beat(id: string, currentTask: string | null = null): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.heartbeat.last_seen = new Date().toISOString();
    agent.heartbeat.current_task = currentTask;
    agent.heartbeat.status = currentTask ? 'running' : 'idle';
  }

  setStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (agent) agent.heartbeat.status = status;
  }

  isAlive(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    const elapsed = Date.now() - new Date(agent.heartbeat.last_seen).getTime();
    return elapsed < this.heartbeatTimeoutMs;
  }

  /** Returns agents that haven't sent a heartbeat within the timeout window */
  timedOut(): RegisteredAgent[] {
    return [...this.agents.values()].filter((a) => !this.isAlive(a.id));
  }

  liveAgents(): RegisteredAgent[] {
    return [...this.agents.values()].filter((a) => this.isAlive(a.id));
  }

  get(id: string): RegisteredAgent | null {
    return this.agents.get(id) ?? null;
  }

  list(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  /**
   * Reassign orphaned tasks from timed-out agents to a fallback agent.
   * Returns the list of task IDs that were reassigned.
   */
  failover(fallbackAgentId: string): string[] {
    const fallback = this.agents.get(fallbackAgentId);
    if (!fallback) throw new Error(`Fallback agent "${fallbackAgentId}" not found`);

    const orphaned: string[] = [];
    for (const agent of this.timedOut()) {
      orphaned.push(...agent.assignedTaskIds);
      agent.assignedTaskIds = [];
      agent.heartbeat.status = 'failed';
    }

    fallback.assignedTaskIds = [...fallback.assignedTaskIds, ...orphaned];
    return orphaned;
  }

  /** Return all agents assigned to a given role */
  getByRole(role: AgentRole): RegisteredAgent[] {
    return [...this.agents.values()].filter((a) => a.role === role);
  }

  /** Append an action log entry for a registered agent (no-op if unknown) */
  logAction(agentId: string, log: AgentActionLog): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.actionLog.push(log);
  }

  clear(): void {
    this.agents.clear();
  }
}
