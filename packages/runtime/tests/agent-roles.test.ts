import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBudget,
  consumeBudget,
  isBudgetExhausted,
  buildHandoff,
  ArbitrationEngine,
} from '../src/scheduler/agent-roles';
import { AgentRegistry } from '../src/scheduler/agent-registry';
import type { TaskExecutor, TaskResult } from '../src/scheduler/scheduler';
import type { WorkspaceManager, WorkspaceRequest } from '../src/workspace/workspace-manager';
import type { WorkspaceLease } from '../src/models/workspace';

function makeExecutor(): TaskExecutor {
  return {
    async execute(): Promise<TaskResult> {
      return { success: true, failure_class: null, evidence: [], output: 'ok' };
    },
  };
}

function makeWsManager(): WorkspaceManager {
  return {
    async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
      return { workspace_id: `ws-${req.work_item_id}`, strategy: 'inplace', root_path: '/tmp', base_commit: null, branch: null, ttl_minutes: 60 };
    },
    async dispose(): Promise<void> {},
    async reset(): Promise<void> {},
    async snapshot(id: string) { return { snapshot_id: `snap-${id}`, workspace_id: id, commit: 'abc', created_at: new Date().toISOString() }; },
  };
}

describe('AgentBudget', () => {
  test('createBudget defaults to Infinity limits', () => {
    const b = createBudget();
    assert.equal(b.max_tokens, Infinity);
    assert.equal(b.consumed_tokens, 0);
  });

  test('createBudget with custom limits', () => {
    const b = createBudget({ max_tokens: 1000, max_retries: 3 });
    assert.equal(b.max_tokens, 1000);
    assert.equal(b.max_retries, 3);
  });

  test('consumeBudget is immutable', () => {
    const b = createBudget({ max_tokens: 100 });
    const b2 = consumeBudget(b, { tokens: 50 });
    assert.equal(b.consumed_tokens, 0);
    assert.equal(b2.consumed_tokens, 50);
  });

  test('consumeBudget accumulates', () => {
    let b = createBudget({ max_retries: 5 });
    b = consumeBudget(b, { retries: 2 });
    b = consumeBudget(b, { retries: 1 });
    assert.equal(b.consumed_retries, 3);
  });

  test('isBudgetExhausted returns false when within limits', () => {
    const b = consumeBudget(createBudget({ max_tokens: 100 }), { tokens: 50 });
    assert.equal(isBudgetExhausted(b), false);
  });

  test('isBudgetExhausted returns true when tokens exhausted', () => {
    const b = consumeBudget(createBudget({ max_tokens: 100 }), { tokens: 100 });
    assert.equal(isBudgetExhausted(b), true);
  });

  test('isBudgetExhausted returns true when time exhausted', () => {
    const b = consumeBudget(createBudget({ max_time_ms: 5000 }), { time_ms: 5001 });
    assert.equal(isBudgetExhausted(b), true);
  });
});

describe('buildHandoff', () => {
  test('creates a handoff with correct fields', () => {
    const h = buildHandoff({
      from_agent_id: 'planner-1',
      to_agent_id: 'executor-1',
      from_role: 'planner',
      to_role: 'executor',
      work_item_id: 'T1',
    });
    assert.ok(h.handoff_id.startsWith('hoff-'));
    assert.equal(h.from_role, 'planner');
    assert.equal(h.to_role, 'executor');
    assert.equal(h.context_pack_ref, null);
  });

  test('context_pack_ref can be set', () => {
    const h = buildHandoff({
      from_agent_id: 'a',
      to_agent_id: 'b',
      from_role: 'planner',
      to_role: 'executor',
      work_item_id: 'T2',
      context_pack_ref: 'cp-run1-T2',
    });
    assert.equal(h.context_pack_ref, 'cp-run1-T2');
  });
});

describe('ArbitrationEngine', () => {
  const engine = new ArbitrationEngine();

  test('returns success over failure', () => {
    const results = [
      { agent_id: 'a', result: { success: false, failure_class: null, evidence: [], output: 'fail' } as TaskResult },
      { agent_id: 'b', result: { success: true, failure_class: null, evidence: ['e1'], output: 'ok' } as TaskResult },
    ];
    assert.equal(engine.arbitrate(results).success, true);
  });

  test('prefers more evidence among successes', () => {
    const results = [
      { agent_id: 'a', result: { success: true, failure_class: null, evidence: ['e1'], output: 'ok' } as TaskResult },
      { agent_id: 'b', result: { success: true, failure_class: null, evidence: ['e1', 'e2', 'e3'], output: 'ok' } as TaskResult },
    ];
    const winner = engine.arbitrate(results);
    assert.equal(winner.evidence.length, 3);
  });

  test('returns first failure when all fail', () => {
    const results = [
      { agent_id: 'a', result: { success: false, failure_class: 'timeout' as const, evidence: [], output: 'timed out' } as TaskResult },
      { agent_id: 'b', result: { success: false, failure_class: 'test' as const, evidence: [], output: 'tests failed' } as TaskResult },
    ];
    const r = engine.arbitrate(results);
    assert.equal(r.success, false);
    assert.equal(r.failure_class, 'timeout');
  });

  test('handles empty results', () => {
    const r = engine.arbitrate([]);
    assert.equal(r.success, false);
  });
});

describe('AgentRegistry with roles', () => {
  test('register with role and retrieve by role', () => {
    const registry = new AgentRegistry();
    registry.register('planner-1', makeExecutor(), makeWsManager(), [], 'planner');
    registry.register('executor-1', makeExecutor(), makeWsManager(), [], 'executor');
    registry.register('executor-2', makeExecutor(), makeWsManager(), [], 'executor');

    const planners = registry.getByRole('planner');
    const executors = registry.getByRole('executor');
    assert.equal(planners.length, 1);
    assert.equal(executors.length, 2);
    assert.equal(planners[0].role, 'planner');
  });

  test('getByRole returns empty when no agents have role', () => {
    const registry = new AgentRegistry();
    registry.register('worker', makeExecutor(), makeWsManager(), [], 'executor');
    assert.equal(registry.getByRole('reviewer').length, 0);
  });

  test('logAction appends to agent log', () => {
    const registry = new AgentRegistry();
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
    const agent = registry.get('agent-log')!;
    assert.equal(agent.actionLog.length, 1);
    assert.equal(agent.actionLog[0].action, 'execute');
  });

  test('logAction is no-op for unknown agent', () => {
    const registry = new AgentRegistry();
    assert.doesNotThrow(() => registry.logAction('no-such', {
      agent_id: 'no-such',
      role: 'executor',
      work_item_id: 'T1',
      action: 'execute',
      result: 'failure',
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    }));
  });

  test('register without role has undefined role', () => {
    const registry = new AgentRegistry();
    registry.register('plain-agent', makeExecutor(), makeWsManager());
    assert.equal(registry.get('plain-agent')!.role, undefined);
  });
});
