import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Scheduler } from '../src/scheduler/scheduler';
import { loadJournal } from '../src/scheduler/run-journal';
import { compile } from '../src/compiler/graph-compiler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import { GateManager } from '../src/gate/gate-manager';
import type { ParsedPlan, ParsedSpec } from '../src/compiler/graph-compiler';
import type { TaskExecutor, TaskResult, SchedulerContext } from '../src/scheduler/scheduler';
import type { WorkspaceLease } from '../src/models/workspace';
import type { WorkspaceManager, WorkspaceRequest } from '../src/workspace/workspace-manager';

const SPEC: ParsedSpec = { objective: 'abort/recover', criteria: [] };

function plan(tasks: ParsedPlan['tasks']): ParsedPlan {
  const waves: Record<number, string[]> = {};
  for (const t of tasks) (waves[t.wave ?? 1] = waves[t.wave ?? 1] ?? []).push(t.id);
  return { tasks, waves, totalTasks: tasks.length };
}

function task(id: string, wave: number, files: string[] = [`src/${id}.js`]): ParsedPlan['tasks'][number] {
  return { id, title: id, wave, dependsOn: [], files, verifyCommand: null, aceite: [], done: false };
}

const ok: TaskExecutor = {
  async execute(): Promise<TaskResult> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { success: true, failure_class: null, evidence: [], output: 'ok' };
  },
};

describe('Scheduler — abort preserva progresso, recover amplo, gate aprovado reutilizado, dispose correto', () => {
  let tmp: string;

  test('setup', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-abort-recover-'));
  });

  test('abort por timeout devolve o que já foi concluído e deixa journal recuperável', async () => {
    const runId = `r-abort-${Date.now()}`;
    // Wave 1 starts inside the budget; its 1.5 s task pushes wave 2 past the 1 s limit. The margins
    // are wide so the wave-1 start still fits the budget under a loaded parallel test run.
    const slow: TaskExecutor = {
      async execute(): Promise<TaskResult> {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { success: true, failure_class: null, evidence: [], output: 'ok' };
      },
    };
    const ctx: SchedulerContext = {
      projectRoot: tmp,
      sessionId: null,
      runId,
      executor: slow,
      workspaceManager: new InplaceWorkspaceManager(tmp),
      options: { maxRunDurationMs: 1000 },
    };
    const graph = compile(plan([task('T1', 1), task('T2', 2)]), SPEC, { default_workspace_strategy: 'inplace' });
    const result = await new Scheduler().run(graph, ctx);

    assert.equal(result.status, 'aborted');
    assert.deepEqual(result.completed, ['T1'], 'abort não pode descartar o progresso real');
    assert.equal(loadJournal(tmp, runId)?.scheduler_state, 'aborted');

    const recovered = await new Scheduler().recover(runId, { ...ctx, options: {} }, graph);
    assert.ok(recovered, 'run abortada deve ser recuperável');
    assert.equal(recovered!.status, 'completed');
    assert.deepEqual(recovered!.completed.sort(), ['T1', 'T2']);
  });

  test('gate aprovado não é pedido de novo na re-execução', async () => {
    const runId = `r-gate-${Date.now()}`;
    const gateManager = new GateManager(tmp, null, runId);
    const ctx: SchedulerContext = {
      projectRoot: tmp,
      sessionId: null,
      runId,
      executor: ok,
      workspaceManager: new InplaceWorkspaceManager(tmp),
      gateManager,
    };
    const graph = compile(plan([task('T1', 1)]), SPEC, { default_workspace_strategy: 'inplace', require_approval_for_all: true });

    const first = await new Scheduler().run(graph, ctx);
    assert.equal(first.status, 'blocked');
    assert.equal(gateManager.listPending().length, 1);

    await gateManager.resolve(gateManager.listPending()[0], { decision: 'approved', actor: 'reviewer' });

    const second = await new Scheduler().run(graph, ctx);
    assert.equal(second.status, 'completed', JSON.stringify(second));
    assert.equal(gateManager.listPending().length, 0, 'não pode abrir um gate novo após aprovação');
    assert.equal(gateManager.listAll().length, 1);
  });

  test('workspace alocado por provider de plugin é liberado pelo mesmo provider', async () => {
    const disposedBy: string[] = [];
    function fakeManager(name: string): WorkspaceManager {
      return {
        isolation_level: 'shared',
        async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
          return {
            workspace_id: `${name}-${req.work_item_id}`,
            strategy: req.strategy,
            isolation_level: 'shared',
            branch: null,
            base_commit: null,
            root_path: tmp,
            ttl_minutes: 30,
          };
        },
        async snapshot(id: string) {
          return { snapshot_id: `snap-${id}`, workspace_id: id, commit: '', created_at: new Date().toISOString() };
        },
        async reset(): Promise<void> {},
        async dispose(): Promise<void> {
          disposedBy.push(name);
        },
      };
    }
    const pluginManager = fakeManager('plugin');
    const defaultManager = fakeManager('default');
    const ctx: SchedulerContext = {
      projectRoot: tmp,
      sessionId: null,
      runId: `r-dispose-${Date.now()}`,
      executor: ok,
      workspaceManager: defaultManager,
      pluginRegistry: {
        workspaceProviderFor: () => pluginManager,
        toolProviderFor: () => undefined,
        verifierProviderFor: () => undefined,
      } as unknown as SchedulerContext['pluginRegistry'],
    };
    const graph = compile(plan([task('T1', 1)]), SPEC, { default_workspace_strategy: 'inplace' });
    const result = await new Scheduler().run(graph, ctx);
    assert.equal(result.status, 'completed');
    assert.deepEqual(disposedBy, ['plugin']);
  });

  test('teardown', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
