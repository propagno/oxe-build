import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler, groupRemoteSegments, remoteFailedMember } from '../src/scheduler/scheduler';
import { loadJournal } from '../src/scheduler/run-journal';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import { GateManager } from '../src/gate/gate-manager';
import { PolicyEngine } from '../src/policy/policy-engine';
import { PluginRegistry } from '../src/plugins/plugin-registry';
import { createQuota } from '../src/audit/audit-trail';
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

  test('retryPolicyOnce: one more attempt after a policy refusal, even past max_retries; never a second', async () => {
    for (const [maxRetries, passesOnRetry, expectedCalls, expectedStatus] of [[0, true, 2, 'completed'], [2, false, 2, 'failed']] as const) {
      let callCount = 0;
      const executor: TaskExecutor = {
        async execute(): Promise<TaskResult> {
          callCount++;
          return callCount === 2 && passesOnRetry
            ? { success: true, failure_class: null, evidence: [], output: 'ok' }
            : { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged' };
        },
      };
      const plan = makePlan([
        { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      ]);
      const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: maxRetries });
      const result = await new Scheduler().run(graph, { ...makeCtx(tmpDir, executor), options: { retryPolicyOnce: true } });
      assert.equal(callCount, expectedCalls, `max_retries ${maxRetries}`);
      assert.equal(result.status, expectedStatus);
    }
  });

  test('retryPolicyOnce in a later execute: a task refused before gets attempt 1 only; the refused attempt keeps its output', async () => {
    let callCount = 0;
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged\nConteúdo novo: read_file a.kt (10 chars)' };
      },
    };
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    const events: Array<{ type: string; work_item_id?: string; payload?: Record<string, unknown> }> = [];
    const ctx = { ...makeCtx(tmpDir, executor), options: { retryPolicyOnce: true, policyRefusedBefore: ['T1'] }, onEvent: (e: { type: string; work_item_id?: string; payload?: Record<string, unknown> }) => events.push(e) };
    await new Scheduler().run(graph, ctx as SchedulerContext);
    assert.equal(callCount, 3, 'T1 once (already refused before), T2 twice (its one extra attempt)');
    // cross-review 15/11: the extra attempt is a CLEAN retry (no refusal text in previousError)
    const prev: Array<string | null | undefined> = [];
    const exec2: TaskExecutor = {
      async execute(_n: unknown, _w: unknown, _r: unknown, _a: unknown, input?: { previousError?: string | null }): Promise<TaskResult> {
        prev.push(input?.previousError);
        return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged [reasoning_extraction] oxe-cc runtime execute --retry-policy-once' };
      },
    } as unknown as TaskExecutor;
    const g2 = compile(makePlan([{ id: 'T3', title: 'T3', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    await new Scheduler().run(g2, { ...makeCtx(tmpDir, exec2), options: { retryPolicyOnce: true } } as SchedulerContext);
    assert.equal(prev.length, 2);
    assert.ok(!String(prev[1] ?? '').includes('reasoning_extraction'), String(prev[1]));
    // exhausted in this run: blocked before any attempt (no model call)
    let calls3 = 0;
    const exec3: TaskExecutor = { async execute(): Promise<TaskResult> { calls3++; return { success: true, failure_class: null, evidence: [], output: 'ok' }; } };
    const g3 = compile(makePlan([{ id: 'T4', title: 'T4', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    await new Scheduler().run(g3, { ...makeCtx(tmpDir, exec3), options: { retryPolicyOnce: true, policyRetryExhausted: ['T4'] } } as SchedulerContext);
    assert.equal(calls3, 0);
    const retry = events.find((e) => e.type === 'RetryScheduled' && e.payload?.reason === 'policy_retry_once');
    assert.equal(retry?.work_item_id, 'T2');
    assert.match(String(retry?.payload?.output_tail), /read_file a\.kt/);
  });

  test('OXB-C28-1: a tool-output policy refusal gets one automatic clean retry; a prompt one does not; off by config', async () => {
    for (const [trigger, opts, expectedCalls] of [
      ['tool_output', {}, 2], ['prompt', {}, 1], ['tool_output', { policyAutoRetry: false }, 1],
    ] as const) {
      let calls = 0;
      const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
      const executor: TaskExecutor = {
        async execute(): Promise<TaskResult> {
          calls++;
          return { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged [reasoning_extraction]', policy_trigger: trigger };
        },
      };
      const g = compile(makePlan([{ id: 'T7', title: 'T7', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
      await new Scheduler().run(g, { ...makeCtx(tmpDir, executor), options: { ...opts }, onEvent: (e: { type: string; payload?: Record<string, unknown> }) => events.push(e) } as SchedulerContext);
      assert.equal(calls, expectedCalls, `${trigger} ${JSON.stringify(opts)}`);
      if (expectedCalls === 2) assert.ok(events.some((e) => e.type === 'RetryScheduled' && e.payload?.reason === 'policy_auto_retry'));
    }
  });

  test('OXB-C28-2: groupRemoteSegments joins consecutive remote segments of the same runner; others stay apart', () => {
    const rv = 'node scripts/remote-verify.mjs --timeout-min 20';
    const segs = [`${rv} -- npx vitest a.test.ts`, `${rv} -- "npx tsc --noEmit"`, 'npm run lint', `${rv} -- npx playwright test`, `${rv} -- node x.mjs "$HOME"`];
    const units = groupRemoteSegments(segs);
    assert.equal(units.length, 4);
    assert.deepEqual(units[0].members, [0, 1]);
    assert.equal(units[0].command, `${rv} -- "echo ===OXE-SEG-1=== && npx vitest a.test.ts && echo ===OXE-SEG-2=== && npx tsc --noEmit"`);
    assert.deepEqual(units.slice(1).map((u) => u.members), [[2], [3], [4]], 'a quote/$ in the inner command is never merged');
    assert.equal(remoteFailedMember('===OXE-SEG-1===\nok\n===OXE-SEG-2===\nerror TS2345', [0, 1]), 1);
    assert.equal(remoteFailedMember('push failed', [0, 1]), 0);
    assert.equal(groupRemoteSegments(['node a.js', 'node b.js']).length, 2);
  });

  test('OXB-C28-2: one remote round trip for the merged segments, and the failing segment is the reported one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c28-2-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'remote-verify.mjs'), [
      "import { execSync } from 'child_process'; import fs from 'fs';",
      "const i = process.argv.indexOf('--'); const c = process.argv.slice(i + 1);",
      "fs.appendFileSync('calls.txt', JSON.stringify(c) + '\\n');",
      "try { process.stdout.write(execSync(c.length === 1 ? c[0] : c.join(' '), { encoding: 'utf8' })); } catch (e) { process.stdout.write(String(e.stdout || '')); process.exit(1); }",
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'ok.js'), "console.log('ok')");
    fs.writeFileSync(path.join(dir, 'bad.js'), "console.log('boom'); process.exit(3)");
    const verify = 'node remote-verify.mjs -- node ok.js && node remote-verify.mjs -- node bad.js && node remote-verify.mjs -- node ok.js';
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const graph = compile(makePlan([{ id: 'T3', title: 'T3', wave: 1, dependsOn: [], files: [], verifyCommand: verify, aceite: [], done: false }]), SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    await new Scheduler().run(graph, { ...makeCtx(dir, alwaysSucceed()), options: { deferFailed: true }, onEvent: (e: { type: string; payload?: Record<string, unknown> }) => events.push(e) } as SchedulerContext);
    const calls = fs.readFileSync(path.join(dir, 'calls.txt'), 'utf8').trim().split('\n');
    assert.equal(calls.length, 1, calls.join('\n'));
    const done = events.find((e) => e.type === 'VerificationCompleted');
    const seg = done?.payload?.failed_segment as { index: number; total: number; command: string } | undefined;
    assert.equal(done?.payload?.status, 'failed');
    assert.equal(seg?.index, 2);
    assert.equal(seg?.total, 3);
    assert.equal(seg?.command, 'node remote-verify.mjs -- node bad.js');
  });

  test('OXB-C28-1: a deferred task is progress — an independent later wave still runs (no no_progress_timeout)', async () => {
    const ran: string[] = [];
    const executor: TaskExecutor = {
      async execute(node: GraphNode): Promise<TaskResult> {
        ran.push(node.id);
        await new Promise((r) => setTimeout(r, 400));
        return node.id === 'T7'
          ? { success: false, failure_class: 'policy', evidence: [], output: 'safeguards flagged', policy_trigger: 'prompt' }
          : { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    } as unknown as TaskExecutor;
    const plan = makePlan([
      { id: 'T7', title: 'T7', wave: 1, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
      { id: 'T8', title: 'T8', wave: 2, dependsOn: [], files: [], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace', default_max_retries: 0 });
    const result = await new Scheduler().run(graph, { ...makeCtx(tmpDir, executor), options: { deferFailed: true, staleProgressMs: 200 } } as SchedulerContext);
    assert.notEqual(result.status, 'aborted', String(result.reason));
    assert.deepEqual(ran, ['T7', 'T8']);
    assert.ok(result.completed.includes('T8'));
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

  test('policy gate blocks node and persists pending gate', async () => {
    const runId = `r-gate-${Date.now()}`;
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const gateManager = new GateManager(tmpDir, null, runId);
    const ctx: SchedulerContext = {
      ...makeCtx(tmpDir, alwaysSucceed()),
      runId,
      gateManager,
      policyEngine: new PolicyEngine([
        {
          id: 'rule-1',
          when: { tool: 'generate_patch' },
          action: 'require_human_gate',
        },
      ]),
    };
    const result = await scheduler.run(graph, ctx);
    assert.equal(result.status, 'blocked');
    assert.ok(result.blocked.includes('T1'));
    assert.equal(gateManager.listPending().length, 1);
  });

  test('quota exhaustion blocks mutations before executor runs', async () => {
    let executed = 0;
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const ctx: SchedulerContext = {
      ...makeCtx(tmpDir, {
        async execute(): Promise<TaskResult> {
          executed++;
          return { success: true, failure_class: null, evidence: [], output: 'ok' };
        },
      }),
      quota: createQuota(`r-quota-${Date.now()}`, { max_work_items: 0, max_mutations: 0 }),
    };
    const result = await scheduler.run(graph, ctx);
    assert.equal(result.status, 'blocked');
    assert.equal(executed, 0);
  });

  test('plugin tool provider can execute node instead of executor', async () => {
    const registry = new PluginRegistry();
    let providerCalls = 0;
    registry.register({
      name: 'tool-plugin',
      toolProviders: [{
        name: 'generate_patch-provider',
        kind: 'mutation',
        idempotent: false,
        supports: (actionType: string) => actionType === 'generate_patch',
        invoke: async () => {
          providerCalls++;
          return { success: true, output: 'plugin ok', evidence_paths: ['artifact.txt'], side_effects_applied: ['write_fs'] };
        },
      }],
    });
    const plan = makePlan([
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['src/app.ts'], verifyCommand: null, aceite: [], done: false },
    ]);
    const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
    const scheduler = new Scheduler();
    const result = await scheduler.run(graph, {
      ...makeCtx(tmpDir, alwaysFail()),
      pluginRegistry: registry,
    });
    assert.equal(result.status, 'completed');
    assert.equal(providerCalls, 1);
  });
});
