import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler } from '../src/scheduler/scheduler';
import { loadJournal } from '../src/scheduler/run-journal';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ParsedPlan, ParsedSpec, GraphNode } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult, SchedulerContext } from '../src/scheduler/scheduler';
import type { WorkspaceLease } from '../src/models/workspace';
import type { OxeEvent } from '../src/events/envelope';

const SPEC: ParsedSpec = { objective: 'Test', criteria: [] };

function makePlan(tasks: ParsedPlan['tasks']): ParsedPlan {
  const waves: Record<number, string[]> = {};
  for (const t of tasks) {
    const w = t.wave ?? 1;
    (waves[w] = waves[w] ?? []).push(t.id);
  }
  return { tasks, waves, totalTasks: tasks.length };
}

function makeCtx(projectRoot: string, executor: TaskExecutor): SchedulerContext {
  return {
    projectRoot,
    sessionId: null,
    runId: `r-test-${Date.now()}`,
    executor,
    workspaceManager: new InplaceWorkspaceManager(projectRoot),
  };
}

function alwaysSucceed(): TaskExecutor {
  return {
    async execute(): Promise<TaskResult> {
      return { success: true, failure_class: null, evidence: [], output: 'ok' };
    },
  };
}

function alwaysFail(failureClass: TaskResult['failure_class'] = 'test'): TaskExecutor {
  return {
    async execute(): Promise<TaskResult> {
      return { success: false, failure_class: failureClass, evidence: [], output: 'fail' };
    },
  };
}

describe('Scheduler', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sched-test-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('runs a simple single-task graph to completion', async () => {
    const plan = makePlan([
      { id: 'T1', title: 'Task 1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysSucceed()));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.completed, ['T1']);
    assert.deepEqual(result.failed, []);
  });

  test('runs two parallel tasks in wave 1', async () => {
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysSucceed()));
    assert.equal(result.status, 'completed');
    assert.equal(result.completed.length, 2);
  });

  test('respects wave ordering — T2 runs after T1', async () => {
    const executionOrder: string[] = [];
    const executor: TaskExecutor = {
      async execute(node: GraphNode): Promise<TaskResult> {
        executionOrder.push(node.id);
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    await scheduler.run(graph, makeCtx(tmpDir, executor));
    assert.equal(executionOrder.indexOf('T1') < executionOrder.indexOf('T2'), true);
  });

  test('failed task causes downstream to be blocked', async () => {
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    const scheduler = new Scheduler();
    const result = await scheduler.run(graph, makeCtx(tmpDir, alwaysFail()));
    assert.equal(result.status, 'failed');
    assert.ok(result.failed.includes('T1'));
    assert.ok(result.blocked.includes('T2'));
  });

  test('retries up to max_retries on env failure', async () => {
    let callCount = 0;
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        return callCount < 3
          ? { success: false, failure_class: 'env', evidence: [], output: 'env error' }
          : { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 2 });
    const scheduler = new Scheduler();
    const result = await scheduler.run(graph, makeCtx(tmpDir, executor));
    assert.equal(result.status, 'completed');
    assert.equal(callCount, 3);
  });

  test('policy failure does not retry', async () => {
    let callCount = 0;
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        return { success: false, failure_class: 'policy', evidence: [], output: 'policy denied' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 2 });
    const scheduler = new Scheduler();
    await scheduler.run(graph, makeCtx(tmpDir, executor));
    assert.equal(callCount, 1);
  });

  test('cancel stops execution mid-run', async () => {
    const scheduler = new Scheduler();
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        scheduler.cancel();
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const result = await scheduler.run(graph, makeCtx(tmpDir, executor));
    assert.equal(result.status, 'cancelled');
  });

  test('emits events for each transition', async () => {
    const events: OxeEvent[] = [];
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const ctx: SchedulerContext = {
      ...makeCtx(tmpDir, alwaysSucceed()),
      onEvent: (e) => events.push(e),
    };
    await scheduler.run(graph, ctx);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('RunStarted'));
    assert.ok(types.includes('WorkItemReady'));
    assert.ok(types.includes('AttemptStarted'));
    assert.ok(types.includes('WorkspaceAllocated'));
    assert.ok(types.includes('WorkItemCompleted'));
    assert.ok(types.includes('RunCompleted'));
  });

  test('journal is created and updated during run', async () => {
    const runId = `r-journal-${Date.now()}`;
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const ctx: SchedulerContext = { ...makeCtx(tmpDir, alwaysSucceed()), runId };
    const result = await scheduler.run(graph, ctx);
    assert.equal(result.status, 'completed');
    // Journal should exist and reflect completed state
    const journal = loadJournal(tmpDir, runId);
    assert.ok(journal !== null);
    assert.equal(journal!.scheduler_state, 'completed');
    assert.ok(journal!.completed_work_items.includes('T1'));
  });

  test('cancel writes cancelled state to journal', async () => {
    const runId = `r-cancel-${Date.now()}`;
    const scheduler = new Scheduler();
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        scheduler.cancel();
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const ctx: SchedulerContext = { ...makeCtx(tmpDir, executor), runId };
    const result = await scheduler.run(graph, ctx);
    assert.equal(result.status, 'cancelled');
    const journal = loadJournal(tmpDir, runId);
    assert.ok(journal !== null);
    assert.equal(journal!.cancelled, true);
    assert.equal(journal!.scheduler_state, 'cancelled');
  });

  test('recover skips already-completed nodes', async () => {
    const runId = `r-recover-${Date.now()}`;
    const executedNodes: string[] = [];
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });

    // Simulate a paused journal with T1 already done
    const { saveJournal } = await import('../src/scheduler/run-journal');
    saveJournal(tmpDir, runId, {
      run_id: runId,
      paused_at: new Date().toISOString(),
      cancelled: false,
      eligible_work_items: [],
      completed_work_items: ['T1'],
      failed_work_items: [],
      blocked_work_items: [],
      pending_gates: [],
      replay_cursor: null,
      scheduler_state: 'paused',
      partial_result: null,
    });

    const executor: TaskExecutor = {
      async execute(node: GraphNode): Promise<TaskResult> {
        executedNodes.push(node.id);
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };

    const scheduler = new Scheduler();
    const ctx: SchedulerContext = { ...makeCtx(tmpDir, executor), runId };
    const result = await scheduler.recover(runId, ctx, graph);
    assert.ok(result !== null);
    assert.equal(result!.status, 'completed');
    // T1 was already done — only T2 should run
    assert.ok(!executedNodes.includes('T1'));
    assert.ok(executedNodes.includes('T2'));
  });

  test('recover returns null when no journal exists', async () => {
    const scheduler = new Scheduler();
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const ctx: SchedulerContext = makeCtx(tmpDir, alwaysSucceed());
    const result = await scheduler.recover('no-such-run', ctx, graph);
    assert.equal(result, null);
  });

  test('RetryScheduled events are emitted on retry', async () => {
    let callCount = 0;
    const events: OxeEvent[] = [];
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        return callCount < 3
          ? { success: false, failure_class: 'env', evidence: [], output: 'env error' }
          : { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 2 });
    const scheduler = new Scheduler();
    const ctx: SchedulerContext = {
      ...makeCtx(tmpDir, executor),
      onEvent: (e) => events.push(e),
    };
    await scheduler.run(graph, ctx);
    const retryEvents = events.filter((e) => e.type === 'RetryScheduled');
    assert.equal(retryEvents.length, 2);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
