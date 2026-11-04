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

// Regressão do e2e "linkly": mutation_scope vazio (rótulo não parseado) fazia tarefas mutáveis da
// mesma onda rodarem em paralelo, in-place, sem nenhum aviso.

const SPEC: ParsedSpec = { objective: 'scope', criteria: [] };

function plan(tasks: ParsedPlan['tasks']): ParsedPlan {
  const waves: Record<number, string[]> = {};
  for (const t of tasks) (waves[t.wave ?? 1] = waves[t.wave ?? 1] ?? []).push(t.id);
  return { tasks, waves, totalTasks: tasks.length };
}

function task(id: string, files: string[] = []): ParsedPlan['tasks'][number] {
  return { id, title: id, wave: 1, dependsOn: [], files, verifyCommand: null, aceite: [], done: false };
}

describe('Scheduler — segurança de escopo', () => {
  let tmp: string;

  test('setup', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-scope-safety-'));
  });

  test('nós mutáveis sem mutation_scope rodam em série e emitem PolicyWarning', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const executor: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight -= 1;
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const events: OxeEvent[] = [];
    const ctx: SchedulerContext = {
      projectRoot: tmp,
      sessionId: null,
      runId: `r-scope-${Date.now()}`,
      executor,
      workspaceManager: new InplaceWorkspaceManager(tmp),
      onEvent: (event) => events.push(event),
    };
    const graph = compile(plan([task('T1'), task('T2'), task('T3')]), SPEC, { default_workspace_strategy: 'inplace' });
    const result = await new Scheduler().run(graph, ctx);

    assert.equal(result.status, 'completed');
    assert.equal(maxInFlight, 1, 'tarefas sem escopo declarado não podem rodar em paralelo');
    const warnings = events.filter((e) => e.type === 'PolicyWarning');
    assert.deepEqual(
      warnings.map((e) => e.work_item_id).sort(),
      ['T1', 'T2', 'T3']
    );
    assert.equal((warnings[0].payload as { reason: string }).reason, 'empty_mutation_scope');
  });

  test('nós com escopo declarado continuam sem aviso', async () => {
    const events: OxeEvent[] = [];
    const ctx: SchedulerContext = {
      projectRoot: tmp,
      sessionId: null,
      runId: `r-scoped-${Date.now()}`,
      executor: { async execute() { return { success: true, failure_class: null, evidence: [], output: 'ok' }; } },
      workspaceManager: new InplaceWorkspaceManager(tmp),
      onEvent: (event) => events.push(event),
    };
    const graph = compile(plan([task('T1', ['src/a.js'])]), SPEC, { default_workspace_strategy: 'inplace' });
    await new Scheduler().run(graph, ctx);
    assert.equal(events.filter((e) => e.type === 'PolicyWarning').length, 0);
  });

  test('teardown', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
