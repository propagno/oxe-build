import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LlmTaskExecutor, compactMessages } from '../src/executor/llm-task-executor';
import { buildDockerRunArgs } from '../src/workspace/strategies/ephemeral-container';
import type { GraphNode } from '../src/compiler/graph-compiler';
import type { WorkspaceLease } from '../src/models/workspace';

function makeNode(id: string, scope: string[] = ['src/app.ts', 'src/data.json']): GraphNode {
  return {
    id,
    title: `Task ${id}`,
    description: `Execute ${id}`,
    wave: 1,
    depends_on: [],
    acceptance_criteria: [],
    mutation_scope: scope,
    actions: [{ type: 'edit', target: scope[0] || 'src/app.ts' }],
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

describe('Harness robustness (Items #2, #3, #6)', () => {
  it('Item #2: compactMessages shrinks verbose intermediate tool outputs while preserving head and tail', () => {
    const msgs = [
      { role: 'system' as const, content: 'system prompt' },
      { role: 'user' as const, content: 'initial task' },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: '1', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
      { role: 'tool' as const, tool_call_id: '1', name: 'read_file', content: `line1\n${'x'.repeat(2000)}` },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: '2', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"b.ts"}' } }] },
      { role: 'tool' as const, tool_call_id: '2', name: 'read_file', content: `line2\n${'y'.repeat(2000)}` },
      { role: 'assistant' as const, content: 'recent assistant' },
      { role: 'tool' as const, tool_call_id: '3', name: 'write_file', content: 'ok' },
    ];
    const { compacted, removedChars, summarizedCount } = compactMessages(msgs, 800);
    assert.ok(removedChars > 3000, `expected >3000 chars removed, got ${removedChars}`);
    assert.ok(summarizedCount >= 2);
    assert.equal(compacted[0]?.content, 'system prompt');
    assert.equal(compacted[compacted.length - 1]?.content, 'ok');
  });

  it('Item #2b: LlmTaskExecutor compacts context in-place when maxContextAction is "compact"', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-compact-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'big.txt'), 'A'.repeat(2500), 'utf8');
      const events: Array<{ type: string; detail?: Record<string, unknown> }> = [];
      let turn = 0;

      const executor = new LlmTaskExecutor(
        { baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 6 },
        null,
        (ev) => { events.push({ type: ev.type, detail: ev.detail }); },
        async () => {
          turn += 1;
          if (turn === 1 || turn === 2) {
            return {
              content: '',
              tool_calls: [{ id: `tc-${turn}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/big.txt' }) } }],
              finish_reason: 'tool_calls',
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          }
          return {
            content: 'done',
            tool_calls: [{ id: 'tc-fin', type: 'function', function: { name: 'finish_task', arguments: JSON.stringify({ summary: 'compacted ok' }) } }],
            finish_reason: 'tool_calls',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
        { maxContextChars: 1500, maxContextAction: 'compact' },
      );

      const res = await executor.execute(makeNode('T1', ['src/big.txt']), makeLease(tmp, 'T1'), 'run-compact', 1);
      assert.equal(res.success, true, res.output);
      const compactEv = events.find((e) => e.type === 'context_compacted');
      assert.ok(compactEv, 'expected context_compacted event');
      assert.ok(Number(compactEv.detail?.removed_chars) > 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Item #3 & #6: preWrite blocks invalid JSON and custom violations before disk flush, and protects control-plane paths', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-prewrite-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      const toolResults: string[] = [];
      let turn = 0;

      const executor = new LlmTaskExecutor(
        { baseUrl: 'http://fake', apiKey: 'test', model: 'test-model', maxTurns: 6 },
        null,
        null,
        async (opts) => {
          const lastTool = [...opts.messages].reverse().find((m) => m.role === 'tool');
          if (lastTool && typeof lastTool.content === 'string') toolResults.push(lastTool.content);
          turn += 1;
          if (turn === 1) {
            // Try writing control-plane file (.github/workflows/ci.yml)
            return {
              content: '',
              tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: '.github/workflows/ci.yml', content: 'hack' }) } }],
              finish_reason: 'tool_calls',
              usage: {},
            };
          }
          if (turn === 2) {
            // Try writing broken JSON
            return {
              content: '',
              tool_calls: [{ id: 't2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/data.json', content: '{broken' }) } }],
              finish_reason: 'tool_calls',
              usage: {},
            };
          }
          if (turn === 3) {
            // Try writing code rejected by custom preWrite hook
            return {
              content: '',
              tool_calls: [{ id: 't3', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/app.ts', content: 'export const x = TODO_STUB;' }) } }],
              finish_reason: 'tool_calls',
              usage: {},
            };
          }
          return {
            content: 'done',
            tool_calls: [{ id: 't4', type: 'function', function: { name: 'finish_task', arguments: JSON.stringify({ summary: 'self-healed' }) } }],
            finish_reason: 'tool_calls',
            usage: {},
          };
        },
        {
          preWrite: ({ content }) => content.includes('TODO_STUB')
            ? { ok: false, reason: 'stub_detected', diagnostics: ['remove TODO_STUB'] }
            : { ok: true },
        },
      );

      const res = await executor.execute(makeNode('T2'), makeLease(tmp, 'T2'), 'run-prewrite', 1);
      assert.equal(res.success, true);
      assert.equal(fs.existsSync(path.join(tmp, '.github', 'workflows', 'ci.yml')), false);
      assert.equal(fs.existsSync(path.join(tmp, 'src', 'data.json')), false);
      assert.equal(fs.existsSync(path.join(tmp, 'src', 'app.ts')), false);
      assert.ok(toolResults.some((r) => /control-plane path/.test(r)));
      assert.ok(toolResults.some((r) => /invalid JSON syntax/.test(r)));
      assert.ok(toolResults.some((r) => /stub_detected/.test(r)));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Item #6b: buildDockerRunArgs enforces --network none, --rm, resource caps, and read-only control-plane mounts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-docker-args-'));
    try {
      fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true });
      const args = buildDockerRunArgs(tmp, {
        image: 'node:20-alpine',
        mountPath: '/workspace',
        memoryLimit: '2g',
        cpus: '2',
      });
      assert.ok(args.includes('--rm'));
      assert.ok(args.includes('--network') && args.includes('none'));
      assert.ok(args.includes('--memory') && args.includes('2g'));
      assert.ok(args.includes('--cpus') && args.includes('2'));
      assert.ok(args.some((a) => a.endsWith(':/workspace/.oxe:ro')));
      assert.ok(args.some((a) => a.endsWith(':/workspace/.github/workflows:ro')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
