"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const agent_registry_1 = require("../src/scheduler/agent-registry");
function makeExecutor() {
    return {
        async execute() {
            return { success: true, failure_class: null, evidence: [], output: 'ok' };
        },
    };
}
function makeWsManager() {
    return {
        async allocate(req) {
            return { workspace_id: `ws-${req.work_item_id}`, strategy: 'inplace', root_path: '/tmp', base_commit: null, branch: null, ttl_minutes: 60 };
        },
        async dispose() { },
        async reset() { },
        async snapshot(id) { return { snapshot_id: `snap-${id}`, workspace_id: id, commit: 'abc', created_at: new Date().toISOString() }; },
    };
}
(0, node_test_1.describe)('AgentRegistry', () => {
    (0, node_test_1.test)('register and get agent', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-1', makeExecutor(), makeWsManager());
        const agent = registry.get('agent-1');
        strict_1.default.ok(agent !== null);
        strict_1.default.equal(agent.id, 'agent-1');
        strict_1.default.equal(agent.heartbeat.status, 'idle');
    });
    (0, node_test_1.test)('throws when registering duplicate agent', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('dup', makeExecutor(), makeWsManager());
        strict_1.default.throws(() => registry.register('dup', makeExecutor(), makeWsManager()), /already registered/);
    });
    (0, node_test_1.test)('unregister removes agent', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-x', makeExecutor(), makeWsManager());
        registry.unregister('agent-x');
        strict_1.default.equal(registry.get('agent-x'), null);
    });
    (0, node_test_1.test)('beat updates last_seen and status', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-2', makeExecutor(), makeWsManager());
        const before = registry.get('agent-2').heartbeat.last_seen;
        registry.beat('agent-2', 'T1');
        const agent = registry.get('agent-2');
        strict_1.default.equal(agent.heartbeat.current_task, 'T1');
        strict_1.default.equal(agent.heartbeat.status, 'running');
        // last_seen should be >= before
        strict_1.default.ok(agent.heartbeat.last_seen >= before);
    });
    (0, node_test_1.test)('beat without task sets status idle', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-3', makeExecutor(), makeWsManager());
        registry.beat('agent-3', null);
        strict_1.default.equal(registry.get('agent-3').heartbeat.status, 'idle');
    });
    (0, node_test_1.test)('isAlive returns true immediately after registration', () => {
        const registry = new agent_registry_1.AgentRegistry(30000);
        registry.register('alive-agent', makeExecutor(), makeWsManager());
        strict_1.default.equal(registry.isAlive('alive-agent'), true);
    });
    (0, node_test_1.test)('isAlive returns false after timeout', () => {
        const registry = new agent_registry_1.AgentRegistry(0); // 0ms timeout = always expired
        registry.register('dead-agent', makeExecutor(), makeWsManager());
        strict_1.default.equal(registry.isAlive('dead-agent'), false);
    });
    (0, node_test_1.test)('timedOut returns expired agents', () => {
        const registry = new agent_registry_1.AgentRegistry(0);
        registry.register('timed-out-1', makeExecutor(), makeWsManager());
        registry.register('timed-out-2', makeExecutor(), makeWsManager());
        const dead = registry.timedOut();
        strict_1.default.equal(dead.length, 2);
    });
    (0, node_test_1.test)('liveAgents returns only healthy agents', () => {
        const registry = new agent_registry_1.AgentRegistry(30000);
        registry.register('live-1', makeExecutor(), makeWsManager());
        registry.register('live-2', makeExecutor(), makeWsManager());
        strict_1.default.equal(registry.liveAgents().length, 2);
    });
    (0, node_test_1.test)('setStatus updates agent status', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-s', makeExecutor(), makeWsManager());
        registry.setStatus('agent-s', 'failed');
        strict_1.default.equal(registry.get('agent-s').heartbeat.status, 'failed');
    });
    (0, node_test_1.test)('failover reassigns orphaned tasks to fallback agent', () => {
        const registry = new agent_registry_1.AgentRegistry(0); // all agents timeout immediately
        registry.register('worker-A', makeExecutor(), makeWsManager(), ['T1', 'T2']);
        registry.register('worker-B', makeExecutor(), makeWsManager(), ['T3']);
        // Add fallback with normal timeout
        const fallbackRegistry = new agent_registry_1.AgentRegistry(30000);
        fallbackRegistry.register('fallback', makeExecutor(), makeWsManager());
        // Manually merge: let's test failover in isolation
        const reg = new agent_registry_1.AgentRegistry(0);
        reg.register('orphan', makeExecutor(), makeWsManager(), ['T10', 'T11']);
        // Override fallback with normal registry
        const reg2 = new agent_registry_1.AgentRegistry(30000);
        reg2.register('fallback', makeExecutor(), makeWsManager(), []);
        // Move agents to same registry for failover test
        const reg3 = new agent_registry_1.AgentRegistry(0);
        reg3.register('stale-agent', makeExecutor(), makeWsManager(), ['T20', 'T21']);
        // Add fallback with fresh heartbeat using internal hack
        const fallback = reg3['agents'];
        fallback.set('fresh', {
            id: 'fresh',
            assignedTaskIds: [],
            heartbeat: { last_seen: new Date(Date.now() + 100000).toISOString(), status: 'idle' },
        });
        // Direct test of reassignment logic
        const plain = new agent_registry_1.AgentRegistry(30000);
        plain.register('worker', makeExecutor(), makeWsManager(), ['TA', 'TB', 'TC']);
        plain.register('backup', makeExecutor(), makeWsManager(), []);
        // Manually expire worker's heartbeat
        const workerAgent = plain.get('worker');
        workerAgent.heartbeat.last_seen = new Date(0).toISOString();
        const reassigned = plain.failover('backup');
        strict_1.default.deepEqual(reassigned.sort(), ['TA', 'TB', 'TC']);
        strict_1.default.deepEqual(plain.get('backup').assignedTaskIds.sort(), ['TA', 'TB', 'TC']);
        strict_1.default.equal(plain.get('worker').assignedTaskIds.length, 0);
        strict_1.default.equal(plain.get('worker').heartbeat.status, 'failed');
    });
    (0, node_test_1.test)('failover throws when fallback agent not found', () => {
        const registry = new agent_registry_1.AgentRegistry();
        strict_1.default.throws(() => registry.failover('no-such-agent'), /not found/);
    });
    (0, node_test_1.test)('list returns all registered agents', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('a1', makeExecutor(), makeWsManager());
        registry.register('a2', makeExecutor(), makeWsManager());
        registry.register('a3', makeExecutor(), makeWsManager());
        strict_1.default.equal(registry.list().length, 3);
    });
    (0, node_test_1.test)('clear removes all agents', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('c1', makeExecutor(), makeWsManager());
        registry.register('c2', makeExecutor(), makeWsManager());
        registry.clear();
        strict_1.default.equal(registry.list().length, 0);
    });
    (0, node_test_1.test)('beat is a no-op for unknown agent', () => {
        const registry = new agent_registry_1.AgentRegistry();
        strict_1.default.doesNotThrow(() => registry.beat('unknown-agent', 'T1'));
    });
});
