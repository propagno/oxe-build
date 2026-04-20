import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
    isolation_level: 'isolated',
    async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
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
    async dispose(): Promise<void> {},
    async reset(): Promise<void> {},
    async snapshot(id: string) { return { snapshot_id: `snap-${id}`, workspace_id: id, commit: 'abc', created_at: new Date().toISOString() }; },
  };
}

describe('AgentRegistry', () => {
  test('register and get agent', () => {
    const registry = new AgentRegistry();
    registry.register('agent-1', makeExecutor(), makeWsManager());
    const agent = registry.get('agent-1');
    assert.ok(agent !== null);
    assert.equal(agent!.id, 'agent-1');
    assert.equal(agent!.heartbeat.status, 'idle');
  });

  test('throws when registering duplicate agent', () => {
    const registry = new AgentRegistry();
    registry.register('dup', makeExecutor(), makeWsManager());
    assert.throws(() => registry.register('dup', makeExecutor(), makeWsManager()), /already registered/);
  });

  test('unregister removes agent', () => {
    const registry = new AgentRegistry();
    registry.register('agent-x', makeExecutor(), makeWsManager());
    registry.unregister('agent-x');
    assert.equal(registry.get('agent-x'), null);
  });

  test('beat updates last_seen and status', () => {
    const registry = new AgentRegistry();
    registry.register('agent-2', makeExecutor(), makeWsManager());
    const before = registry.get('agent-2')!.heartbeat.last_seen;
    registry.beat('agent-2', 'T1');
    const agent = registry.get('agent-2')!;
    assert.equal(agent.heartbeat.current_task, 'T1');
    assert.equal(agent.heartbeat.status, 'running');
    // last_seen should be >= before
    assert.ok(agent.heartbeat.last_seen >= before);
  });

  test('beat without task sets status idle', () => {
    const registry = new AgentRegistry();
    registry.register('agent-3', makeExecutor(), makeWsManager());
    registry.beat('agent-3', null);
    assert.equal(registry.get('agent-3')!.heartbeat.status, 'idle');
  });

  test('isAlive returns true immediately after registration', () => {
    const registry = new AgentRegistry(30_000);
    registry.register('alive-agent', makeExecutor(), makeWsManager());
    assert.equal(registry.isAlive('alive-agent'), true);
  });

  test('isAlive returns false after timeout', () => {
    const registry = new AgentRegistry(0); // 0ms timeout = always expired
    registry.register('dead-agent', makeExecutor(), makeWsManager());
    assert.equal(registry.isAlive('dead-agent'), false);
  });

  test('timedOut returns expired agents', () => {
    const registry = new AgentRegistry(0);
    registry.register('timed-out-1', makeExecutor(), makeWsManager());
    registry.register('timed-out-2', makeExecutor(), makeWsManager());
    const dead = registry.timedOut();
    assert.equal(dead.length, 2);
  });

  test('liveAgents returns only healthy agents', () => {
    const registry = new AgentRegistry(30_000);
    registry.register('live-1', makeExecutor(), makeWsManager());
    registry.register('live-2', makeExecutor(), makeWsManager());
    assert.equal(registry.liveAgents().length, 2);
  });

  test('setStatus updates agent status', () => {
    const registry = new AgentRegistry();
    registry.register('agent-s', makeExecutor(), makeWsManager());
    registry.setStatus('agent-s', 'failed');
    assert.equal(registry.get('agent-s')!.heartbeat.status, 'failed');
  });

  test('failover reassigns orphaned tasks to fallback agent', () => {
    const registry = new AgentRegistry(0); // all agents timeout immediately
    registry.register('worker-A', makeExecutor(), makeWsManager(), ['T1', 'T2']);
    registry.register('worker-B', makeExecutor(), makeWsManager(), ['T3']);

    // Add fallback with normal timeout
    const fallbackRegistry = new AgentRegistry(30_000);
    fallbackRegistry.register('fallback', makeExecutor(), makeWsManager());
    // Manually merge: let's test failover in isolation
    const reg = new AgentRegistry(0);
    reg.register('orphan', makeExecutor(), makeWsManager(), ['T10', 'T11']);
    // Override fallback with normal registry
    const reg2 = new AgentRegistry(30_000);
    reg2.register('fallback', makeExecutor(), makeWsManager(), []);
    // Move agents to same registry for failover test
    const reg3 = new AgentRegistry(0);
    reg3.register('stale-agent', makeExecutor(), makeWsManager(), ['T20', 'T21']);
    // Add fallback with fresh heartbeat using internal hack
    const fallback = reg3['agents'] as Map<string, { id: string; assignedTaskIds: string[]; heartbeat: { last_seen: string; status: string } }>;
    fallback.set('fresh', {
      id: 'fresh',
      assignedTaskIds: [],
      heartbeat: { last_seen: new Date(Date.now() + 100_000).toISOString(), status: 'idle' },
    });

    // Direct test of reassignment logic
    const plain = new AgentRegistry(30_000);
    plain.register('worker', makeExecutor(), makeWsManager(), ['TA', 'TB', 'TC']);
    plain.register('backup', makeExecutor(), makeWsManager(), []);
    // Manually expire worker's heartbeat
    const workerAgent = plain.get('worker')!;
    workerAgent.heartbeat.last_seen = new Date(0).toISOString();
    const reassigned = plain.failover('backup');
    assert.deepEqual(reassigned.sort(), ['TA', 'TB', 'TC']);
    assert.deepEqual(plain.get('backup')!.assignedTaskIds.sort(), ['TA', 'TB', 'TC']);
    assert.equal(plain.get('worker')!.assignedTaskIds.length, 0);
    assert.equal(plain.get('worker')!.heartbeat.status, 'failed');
  });

  test('failover throws when fallback agent not found', () => {
    const registry = new AgentRegistry();
    assert.throws(() => registry.failover('no-such-agent'), /not found/);
  });

  test('list returns all registered agents', () => {
    const registry = new AgentRegistry();
    registry.register('a1', makeExecutor(), makeWsManager());
    registry.register('a2', makeExecutor(), makeWsManager());
    registry.register('a3', makeExecutor(), makeWsManager());
    assert.equal(registry.list().length, 3);
  });

  test('clear removes all agents', () => {
    const registry = new AgentRegistry();
    registry.register('c1', makeExecutor(), makeWsManager());
    registry.register('c2', makeExecutor(), makeWsManager());
    registry.clear();
    assert.equal(registry.list().length, 0);
  });

  test('beat is a no-op for unknown agent', () => {
    const registry = new AgentRegistry();
    assert.doesNotThrow(() => registry.beat('unknown-agent', 'T1'));
  });
});
