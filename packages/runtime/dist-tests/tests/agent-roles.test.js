"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const agent_roles_1 = require("../src/scheduler/agent-roles");
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
        isolation_level: 'isolated',
        async allocate(req) {
            return {
                workspace_id: `ws-${req.work_item_id}`,
                strategy: 'git_worktree',
                isolation_level: 'isolated',
                root_path: '/tmp',
                base_commit: null,
                branch: null,
                ttl_minutes: 60,
            };
        },
        async dispose() { },
        async reset() { },
        async snapshot(id) { return { snapshot_id: `snap-${id}`, workspace_id: id, commit: 'abc', created_at: new Date().toISOString() }; },
    };
}
(0, node_test_1.describe)('AgentBudget', () => {
    (0, node_test_1.test)('createBudget defaults to Infinity limits', () => {
        const b = (0, agent_roles_1.createBudget)();
        strict_1.default.equal(b.max_tokens, Infinity);
        strict_1.default.equal(b.consumed_tokens, 0);
    });
    (0, node_test_1.test)('createBudget with custom limits', () => {
        const b = (0, agent_roles_1.createBudget)({ max_tokens: 1000, max_retries: 3 });
        strict_1.default.equal(b.max_tokens, 1000);
        strict_1.default.equal(b.max_retries, 3);
    });
    (0, node_test_1.test)('consumeBudget is immutable', () => {
        const b = (0, agent_roles_1.createBudget)({ max_tokens: 100 });
        const b2 = (0, agent_roles_1.consumeBudget)(b, { tokens: 50 });
        strict_1.default.equal(b.consumed_tokens, 0);
        strict_1.default.equal(b2.consumed_tokens, 50);
    });
    (0, node_test_1.test)('consumeBudget accumulates', () => {
        let b = (0, agent_roles_1.createBudget)({ max_retries: 5 });
        b = (0, agent_roles_1.consumeBudget)(b, { retries: 2 });
        b = (0, agent_roles_1.consumeBudget)(b, { retries: 1 });
        strict_1.default.equal(b.consumed_retries, 3);
    });
    (0, node_test_1.test)('isBudgetExhausted returns false when within limits', () => {
        const b = (0, agent_roles_1.consumeBudget)((0, agent_roles_1.createBudget)({ max_tokens: 100 }), { tokens: 50 });
        strict_1.default.equal((0, agent_roles_1.isBudgetExhausted)(b), false);
    });
    (0, node_test_1.test)('isBudgetExhausted returns true when tokens exhausted', () => {
        const b = (0, agent_roles_1.consumeBudget)((0, agent_roles_1.createBudget)({ max_tokens: 100 }), { tokens: 100 });
        strict_1.default.equal((0, agent_roles_1.isBudgetExhausted)(b), true);
    });
    (0, node_test_1.test)('isBudgetExhausted returns true when time exhausted', () => {
        const b = (0, agent_roles_1.consumeBudget)((0, agent_roles_1.createBudget)({ max_time_ms: 5000 }), { time_ms: 5001 });
        strict_1.default.equal((0, agent_roles_1.isBudgetExhausted)(b), true);
    });
});
(0, node_test_1.describe)('buildHandoff', () => {
    (0, node_test_1.test)('creates a handoff with correct fields', () => {
        const h = (0, agent_roles_1.buildHandoff)({
            from_agent_id: 'planner-1',
            to_agent_id: 'executor-1',
            from_role: 'planner',
            to_role: 'executor',
            work_item_id: 'T1',
        });
        strict_1.default.ok(h.handoff_id.startsWith('hoff-'));
        strict_1.default.equal(h.from_role, 'planner');
        strict_1.default.equal(h.to_role, 'executor');
        strict_1.default.equal(h.context_pack_ref, null);
    });
    (0, node_test_1.test)('context_pack_ref can be set', () => {
        const h = (0, agent_roles_1.buildHandoff)({
            from_agent_id: 'a',
            to_agent_id: 'b',
            from_role: 'planner',
            to_role: 'executor',
            work_item_id: 'T2',
            context_pack_ref: 'cp-run1-T2',
        });
        strict_1.default.equal(h.context_pack_ref, 'cp-run1-T2');
    });
});
(0, node_test_1.describe)('ArbitrationEngine', () => {
    const engine = new agent_roles_1.ArbitrationEngine();
    (0, node_test_1.test)('returns success over failure', () => {
        const results = [
            { agent_id: 'a', result: { success: false, failure_class: null, evidence: [], output: 'fail' } },
            { agent_id: 'b', result: { success: true, failure_class: null, evidence: ['e1'], output: 'ok' } },
        ];
        strict_1.default.equal(engine.arbitrate(results).success, true);
    });
    (0, node_test_1.test)('prefers more evidence among successes', () => {
        const results = [
            { agent_id: 'a', result: { success: true, failure_class: null, evidence: ['e1'], output: 'ok' } },
            { agent_id: 'b', result: { success: true, failure_class: null, evidence: ['e1', 'e2', 'e3'], output: 'ok' } },
        ];
        const winner = engine.arbitrate(results);
        strict_1.default.equal(winner.evidence.length, 3);
    });
    (0, node_test_1.test)('returns first failure when all fail', () => {
        const results = [
            { agent_id: 'a', result: { success: false, failure_class: 'timeout', evidence: [], output: 'timed out' } },
            { agent_id: 'b', result: { success: false, failure_class: 'test', evidence: [], output: 'tests failed' } },
        ];
        const r = engine.arbitrate(results);
        strict_1.default.equal(r.success, false);
        strict_1.default.equal(r.failure_class, 'timeout');
    });
    (0, node_test_1.test)('handles empty results', () => {
        const r = engine.arbitrate([]);
        strict_1.default.equal(r.success, false);
    });
});
(0, node_test_1.describe)('AgentRegistry with roles', () => {
    (0, node_test_1.test)('register with role and retrieve by role', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('planner-1', makeExecutor(), makeWsManager(), [], 'planner');
        registry.register('executor-1', makeExecutor(), makeWsManager(), [], 'executor');
        registry.register('executor-2', makeExecutor(), makeWsManager(), [], 'executor');
        const planners = registry.getByRole('planner');
        const executors = registry.getByRole('executor');
        strict_1.default.equal(planners.length, 1);
        strict_1.default.equal(executors.length, 2);
        strict_1.default.equal(planners[0].role, 'planner');
    });
    (0, node_test_1.test)('getByRole returns empty when no agents have role', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('worker', makeExecutor(), makeWsManager(), [], 'executor');
        strict_1.default.equal(registry.getByRole('reviewer').length, 0);
    });
    (0, node_test_1.test)('logAction appends to agent log', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('agent-log', makeExecutor(), makeWsManager(), [], 'executor');
        registry.logAction('agent-log', {
            agent_id: 'agent-log',
            role: 'executor',
            work_item_id: 'T1',
            action: 'execute',
            result: 'success',
            duration_ms: 120,
            timestamp: new Date().toISOString(),
        });
        const agent = registry.get('agent-log');
        strict_1.default.equal(agent.actionLog.length, 1);
        strict_1.default.equal(agent.actionLog[0].action, 'execute');
    });
    (0, node_test_1.test)('logAction is no-op for unknown agent', () => {
        const registry = new agent_registry_1.AgentRegistry();
        strict_1.default.doesNotThrow(() => registry.logAction('no-such', {
            agent_id: 'no-such',
            role: 'executor',
            work_item_id: 'T1',
            action: 'execute',
            result: 'failure',
            duration_ms: 0,
            timestamp: new Date().toISOString(),
        }));
    });
    (0, node_test_1.test)('register without role has undefined role', () => {
        const registry = new agent_registry_1.AgentRegistry();
        registry.register('plain-agent', makeExecutor(), makeWsManager());
        strict_1.default.equal(registry.get('plain-agent').role, undefined);
    });
});
