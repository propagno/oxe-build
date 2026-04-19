"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRegistry = void 0;
class AgentRegistry {
    constructor(heartbeatTimeoutMs = 30000) {
        this.agents = new Map();
        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    }
    register(id, executor, workspaceManager, assignedTaskIds = [], role) {
        if (this.agents.has(id))
            throw new Error(`Agent "${id}" is already registered`);
        const agent = {
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
    unregister(id) {
        this.agents.delete(id);
    }
    beat(id, currentTask = null) {
        const agent = this.agents.get(id);
        if (!agent)
            return;
        agent.heartbeat.last_seen = new Date().toISOString();
        agent.heartbeat.current_task = currentTask;
        agent.heartbeat.status = currentTask ? 'running' : 'idle';
    }
    setStatus(id, status) {
        const agent = this.agents.get(id);
        if (agent)
            agent.heartbeat.status = status;
    }
    isAlive(id) {
        const agent = this.agents.get(id);
        if (!agent)
            return false;
        const elapsed = Date.now() - new Date(agent.heartbeat.last_seen).getTime();
        return elapsed < this.heartbeatTimeoutMs;
    }
    /** Returns agents that haven't sent a heartbeat within the timeout window */
    timedOut() {
        return [...this.agents.values()].filter((a) => !this.isAlive(a.id));
    }
    liveAgents() {
        return [...this.agents.values()].filter((a) => this.isAlive(a.id));
    }
    get(id) {
        return this.agents.get(id) ?? null;
    }
    list() {
        return [...this.agents.values()];
    }
    /**
     * Reassign orphaned tasks from timed-out agents to a fallback agent.
     * Returns the list of task IDs that were reassigned.
     */
    failover(fallbackAgentId) {
        const fallback = this.agents.get(fallbackAgentId);
        if (!fallback)
            throw new Error(`Fallback agent "${fallbackAgentId}" not found`);
        const orphaned = [];
        for (const agent of this.timedOut()) {
            orphaned.push(...agent.assignedTaskIds);
            agent.assignedTaskIds = [];
            agent.heartbeat.status = 'failed';
        }
        fallback.assignedTaskIds = [...fallback.assignedTaskIds, ...orphaned];
        return orphaned;
    }
    /** Return all agents assigned to a given role */
    getByRole(role) {
        return [...this.agents.values()].filter((a) => a.role === role);
    }
    /** Append an action log entry for a registered agent (no-op if unknown) */
    logAction(agentId, log) {
        const agent = this.agents.get(agentId);
        if (agent)
            agent.actionLog.push(log);
    }
    clear() {
        this.agents.clear();
    }
}
exports.AgentRegistry = AgentRegistry;
