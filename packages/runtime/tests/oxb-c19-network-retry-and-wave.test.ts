import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LlmTaskExecutor } from '../src/executor/llm-task-executor';
import { Scheduler } from '../src/scheduler/scheduler';
import { InplaceWorkspaceManager } from '../src/workspace/strategies/inplace';
import type { ExecutionGraph, GraphNode } from '../src/compiler/graph-compiler';
import type { WorkspaceLease } from '../src/models/workspace';

function makeNode(id: string, dependsOn: string[] = []): GraphNode {
  return {
    id,
    title: `Task ${id}`,
    description: `Execute ${id}`,
    wave: 1,
    depends_on: dependsOn,
    acceptance_criteria: [],
    mutation_scope: [`src/${id}.ts`],
    actions: [{ type: 'edit', target: `src/${id}.ts` }],
    verify: { must_pass: [], commands: [] },
    verification: { commands: [] },
    policy: { max_retries: 1 },
  } as unknown as GraphNode;
}

function makeLease(rootPath: string, taskId: string): WorkspaceLease {
  return {
    workspace_id: `ws-${taskId}`,
    strategy: 'inplace',
    root_path: rootPath,
    leased_to: taskId,
    leased_at: new Date().toISOString(),
  } as unknown as WorkspaceLease;
}

describe('OXB-C19: transient network backoff & intra-wave dependency progression', () => {
  it('1) LlmTaskExecutor retries transient network errors (wsasend / TLS handshake timeout / 503) in-place with exponential backoff', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c19-net-'));
    try {
      const sleeps: number[] = [];
      const events: Array<{ type: string; detail?: Record<string, unknown> }> = [];
      let calls = 0;

      const executor = new LlmTaskExecutor(
        { baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 3 },
        null,
        (ev) => { events.push({ type: ev.type, detail: ev.detail }); },
        async () => {
          calls += 1;
          if (calls === 1) {
            const err = new Error('agy exit 1 · stderr=wsasend: An existing connection was forcibly closed by the remote host · kind=env') as Error & { kind?: string };
            err.kind = 'env';
            throw err;
          }
          if (calls === 2) {
            const err = new Error('agy exit 1 · stderr=TLS handshake timeout · kind=env') as Error & { kind?: string };
            err.kind = 'env';
            throw err;
          }
          if (calls === 3) {
            const err = new Error('HTTP 503 Service Unavailable') as Error & { kind?: string };
            err.kind = 'env';
            throw err;
          }
          return {
            content: 'done after network recovery',
            tool_calls: [
              {
                id: 'tc-finish',
                type: 'function',
                function: {
                  name: 'finish_task',
                  arguments: JSON.stringify({ summary: 'done after network recovery' }),
                },
              },
            ],
            finish_reason: 'tool_calls',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
        {
          sleep: async (ms) => { sleeps.push(ms); },
        },
      );

      const res = await executor.execute(makeNode('T15'), makeLease(tmp, 'T15'), 'run-c19', 1);
      assert.equal(res.success, true, res.output);
      assert.equal(calls, 4);
      assert.deepEqual(sleeps, [5_000, 15_000, 30_000]);
      const netEvents = events.filter((e) => e.type === 'network_retry');
      assert.equal(netEvents.length, 3);
      assert.equal(netEvents[0]?.detail?.wait_ms, 5_000);
      assert.equal(netEvents[1]?.detail?.wait_ms, 15_000);
      assert.equal(netEvents[2]?.detail?.wait_ms, 30_000);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('1b) LlmTaskExecutor fails as env after exhausting all configured network retry delays', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c19-net-exhaust-'));
    try {
      const sleeps: number[] = [];
      let calls = 0;
      const executor = new LlmTaskExecutor(
        { baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 3 },
        null,
        null,
        async () => {
          calls += 1;
          const err = new Error('read tcp: ECONNRESET') as Error & { kind?: string };
          err.kind = 'env';
          throw err;
        },
        {
          networkRetryDelaysMs: [100, 200],
          sleep: async (ms) => { sleeps.push(ms); },
        },
      );

      const res = await executor.execute(makeNode('T15'), makeLease(tmp, 'T15'), 'run-c19', 1);
      assert.equal(res.success, false);
      assert.equal(res.failure_class, 'env');
      assert.equal(calls, 3);
      assert.deepEqual(sleeps, [100, 200]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('2) Scheduler runWave progresses through intra-wave dependencies (T11 -> T12 -> T13) instead of blocking T12..T13 up-front', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c19-wave-'));
    try {
      const n11 = makeNode('T11', []);
      const n12 = makeNode('T12', ['T11']);
      const n13 = makeNode('T13', ['T12']);
      const graph: ExecutionGraph = {
        graph_version: '1.0',
        run_id: 'run-c19-wave',
        nodes: new Map([['T11', n11], ['T12', n12], ['T13', n13]]),
        waves: [{ wave_number: 1, node_ids: ['T11', 'T12', 'T13'] }],
        edges: [
          { from: 'T11', to: 'T12', type: 'depends_on' },
          { from: 'T12', to: 'T13', type: 'depends_on' },
        ],
      } as unknown as ExecutionGraph;

      const executed: string[] = [];
      const scheduler = new Scheduler();
      const result = await scheduler.run(graph, {
        projectRoot: tmp,
        sessionId: null,
        runId: 'run-c19-wave',
        workspaceManager: new InplaceWorkspaceManager(tmp),
        executor: {
          async execute(node) {
            executed.push(node.id);
            return { success: true, failure_class: null, evidence: [], output: `ok ${node.id}` };
          },
        },
      });

      assert.equal(result.status, 'completed');
      assert.deepEqual(executed, ['T11', 'T12', 'T13']);
      assert.deepEqual(result.completed, ['T11', 'T12', 'T13']);
      assert.deepEqual(result.blocked, []);
      assert.deepEqual(result.failed, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
