import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler } from '../src/scheduler/scheduler';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult, SchedulerContext } from '../src/scheduler/scheduler';
import type { OxeEvent } from '../src/events/envelope';

// OxeSpace 14/11 (OxeChat F2): `runtime pause` from another process said "paused", T3 finished and T4 started anyway.
// A requested pause lets the task in progress finish and never starts the next one.

const SPEC: ParsedSpec = { objective: 'pause', criteria: [] };

function graph() {
  const plan: ParsedPlan = {
    tasks: [
      { id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand: 'node -e "process.exit(0)"', aceite: [], done: false },
      { id: 'T2', title: 'T2', wave: 2, dependsOn: ['T1'], files: ['b.js'], verifyCommand: 'node -e "process.exit(0)"', aceite: [], done: false },
    ],
    waves: { 1: ['T1'], 2: ['T2'] },
    totalTasks: 2,
  };
  return compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
}

describe('pausa pedida de fora (runtime pause)', () => {
  test('a tarefa em curso termina; a próxima não começa; o run fica paused com RunPaused requested', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-pause-'));
    let paused = false;
    const ran: string[] = [];
    const executor: TaskExecutor = {
      async execute(node): Promise<TaskResult> {
        ran.push(node.id);
        paused = true; // the person runs `runtime pause` while T1 is running
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const events: OxeEvent[] = [];
    const ctx: SchedulerContext = {
      projectRoot: tmp, sessionId: null, runId: `r-pause-${Date.now()}`, executor,
      workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
      pauseRequested: () => (paused ? 'runtime pause: revisar o T1' : null),
    };
    try {
      const result = await new Scheduler().run(graph(), ctx);
      assert.deepEqual(ran, ['T1'], 'T2 nunca começa');
      assert.equal(result.status, 'paused');
      assert.ok(result.completed.includes('T1'));
      // T2 stays pending for the resume: never "blocked" by the pause (OxeSpace 15/11, OxeCode F4 T18)
      assert.ok(!result.blocked.includes('T2'), JSON.stringify(result.blocked));
      assert.equal(events.filter((e) => e.type === 'WorkItemBlocked').length, 0);
      const ev = events.find((e) => e.type === 'RunPaused');
      assert.equal((ev?.payload as Record<string, unknown>).reason, 'requested');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('pausa pedida durante a tentativa 1: a tentativa 2 não começa e a tarefa fica pendente (OxeSpace 15/11, OxeChat F4 T9)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-pause-'));
    let paused = false;
    let calls = 0;
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        calls += 1;
        paused = true; // pause requested while attempt 1 runs; attempt 1 fails
        return { success: false, failure_class: 'logic', evidence: [], output: 'falhou' };
      },
    };
    const events: OxeEvent[] = [];
    const ctx: SchedulerContext = {
      projectRoot: tmp, sessionId: null, runId: `r-pause-att-${Date.now()}`, executor,
      workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
      pauseRequested: () => (paused ? 'runtime pause: janela' : null),
    };
    try {
      const result = await new Scheduler().run(graph(), ctx);
      assert.equal(calls, 1, 'no attempt 2 under the pause');
      assert.equal(result.status, 'paused');
      assert.ok(!result.failed.includes('T1') && !result.blocked.includes('T1'), JSON.stringify(result));
      assert.ok(events.some((e) => e.type === 'PolicyWarning' && (e.payload as Record<string, unknown>).reason === 'paused_before_attempt'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('sem pausa pedida, as duas rodam', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-pause-'));
    const ran: string[] = [];
    const executor: TaskExecutor = { async execute(node): Promise<TaskResult> { ran.push(node.id); return { success: true, failure_class: null, evidence: [], output: 'ok' }; } };
    const ctx: SchedulerContext = { projectRoot: tmp, sessionId: null, runId: `r-nopause-${Date.now()}`, executor, workspaceManager: new InplaceWorkspaceManager(tmp), pauseRequested: () => null };
    try {
      await new Scheduler().run(graph(), ctx);
      assert.deepEqual(ran, ['T1', 'T2']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
