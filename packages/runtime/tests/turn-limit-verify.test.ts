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

// OxeVoice F1 · T15: a tentativa 1 terminou o trabalho ("All 35 tests pass…") mas estourou os turnos; o scheduler
// agendou a 2ª sem rodar o verify e pagou de novo (OXB-026). O verify é o juiz, não o fim da conversa do LLM.

const SPEC: ParsedSpec = { objective: 'turn limit', criteria: [] };

function graphFor(verifyCommand: string) {
  const plan: ParsedPlan = {
    tasks: [{ id: 'T1', title: 'T1', wave: 1, dependsOn: [], files: ['a.js'], verifyCommand, aceite: [], done: false }],
    waves: { 1: ['T1'] },
    totalTasks: 1,
  };
  const graph = compile(plan, SPEC, { default_workspace_strategy: 'inplace' });
  for (const node of graph.nodes.values()) node.policy.max_retries = 2;
  return graph;
}

function setup(results: TaskResult[]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-turnlimit-'));
  let calls = 0;
  const executor: TaskExecutor = {
    async execute(): Promise<TaskResult> {
      const r = results[Math.min(calls, results.length - 1)];
      calls += 1;
      return r;
    },
  };
  const events: OxeEvent[] = [];
  const ctx: SchedulerContext = {
    projectRoot: tmp, sessionId: null, runId: `r-tl-${Date.now()}-${Math.random()}`, executor,
    workspaceManager: new InplaceWorkspaceManager(tmp), onEvent: (e) => events.push(e),
  };
  return { tmp, events, ctx, calls: () => calls };
}

const exhausted = (evidence: string[]): TaskResult => ({
  success: false, failure_class: 'llm', evidence, output: 'All tests pass. Running the final verification…', completed_by: 'turn_limit_exhausted',
});

describe('verify após turn limit (OXB-026)', () => {
  test('trabalho escrito + verify verde conclui na 1ª tentativa, sem retry', async () => {
    const { tmp, events, ctx, calls } = setup([exhausted(['a.js'])]);
    try {
      const result = await new Scheduler().run(graphFor('node -e "process.exit(0)"'), ctx);
      assert.equal(result.status, 'completed');
      assert.equal(calls(), 1, 'nenhuma tentativa extra paga');
      assert.ok(!events.some((e) => e.type === 'RetryScheduled'));
      const done = events.find((e) => e.type === 'WorkItemCompleted');
      assert.equal((done?.payload as Record<string, unknown>).completed_by, 'verify_after_turn_limit');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('trabalho escrito + verify vermelho vira retry informado com a saída do verify', async () => {
    const { tmp, events, ctx } = setup([exhausted(['a.js']), { success: true, failure_class: null, evidence: ['a.js'], output: 'ok' }]);
    try {
      const cmd = 'node -e "const f=require(\'fs\');if(f.existsSync(\'seen\'))process.exit(0);f.writeFileSync(\'seen\',\'1\');console.error(\'AssertionError: expected 1\');process.exit(1)"';
      const result = await new Scheduler().run(graphFor(cmd), ctx);
      assert.equal(result.status, 'completed');
      const retry = events.find((e) => e.type === 'RetryScheduled');
      assert.equal((retry?.payload as Record<string, unknown>).reason, 'verify');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('sem escrita no escopo o turn limit continua sendo falha (verde pré-existente não conta)', async () => {
    const { tmp, events, ctx, calls } = setup([exhausted([]), exhausted([]), exhausted([])]);
    try {
      const result = await new Scheduler().run(graphFor('node -e "process.exit(0)"'), ctx);
      assert.equal(result.status, 'failed');
      assert.equal(calls(), 3);
      assert.ok(!events.some((e) => e.type === 'WorkItemCompleted'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
