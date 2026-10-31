import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { LlmTaskExecutor, partitionToolCalls } from '../src/executor/llm-task-executor';
import type { LlmExecutorEvent } from '../src/executor/llm-task-executor';
import type { CompletionResponse, ToolCall } from '../src/executor/stream-completion';
import type { GraphNode } from '../src/compiler/graph-compiler';
import type { WorkspaceLease } from '../src/models/workspace';

// Regressão do e2e "linkly": o executor rodava qualquer built-in tool independentemente das
// ações do nó e contava "resposta só em texto" como tarefa concluída.

function node(actions: GraphNode['actions']): GraphNode {
  return {
    id: 'T1',
    title: 'tarefa',
    wave: 1,
    depends_on: [],
    workspace_strategy: 'inplace',
    mutation_scope: [],
    actions,
    verify: { must_pass: [], acceptance_refs: [], command: null },
    policy: { requires_human_approval: false, max_retries: 0 },
  };
}

function lease(root: string): WorkspaceLease {
  return {
    workspace_id: 'ws-1',
    strategy: 'inplace',
    isolation_level: 'shared',
    branch: null,
    base_commit: null,
    root_path: root,
    ttl_minutes: 30,
  };
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function scripted(responses: CompletionResponse[]) {
  let i = 0;
  return async (): Promise<CompletionResponse> => responses[Math.min(i++, responses.length - 1)];
}

const provider = { baseUrl: 'http://unused', apiKey: 'x', model: 'fake', maxTurns: 4 };

describe('LlmTaskExecutor — allowlist, no_tool_call e contenção', () => {
  let tmp: string;

  test('setup', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-exec-'));
  });

  test('tool fora da allowlist do nó é negada e não executa', async () => {
    const events: LlmExecutorEvent[] = [];
    const executor = new LlmTaskExecutor(provider, null, (e) => events.push(e), scripted([
      { content: '', tool_calls: [call('write_file', { path: 'hack.txt', content: 'x' })], finish_reason: 'tool_calls' },
      { content: '', tool_calls: [call('finish_task', { summary: 'done' })], finish_reason: 'tool_calls' },
    ]));
    const result = await executor.execute(node([{ type: 'read_code', targets: [] }]), lease(tmp), 'run', 1);
    assert.equal(fs.existsSync(path.join(tmp, 'hack.txt')), false);
    assert.ok(events.some((e) => e.type === 'tool_denied' && e.detail?.tool === 'write_file'));
    assert.equal(result.success, true);
  });

  test('resposta só em texto numa tarefa mutável falha (no_tool_call)', async () => {
    const executor = new LlmTaskExecutor(provider, null, null, scripted([
      { content: 'Pronto, criei o arquivo.', tool_calls: [], finish_reason: 'stop' },
    ]));
    const result = await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
    assert.equal(result.success, false);
    assert.equal(result.failure_class, 'llm');
    assert.equal(result.completed_by, 'no_tool_call');
  });

  test('resposta só em texto numa tarefa só-leitura continua válida', async () => {
    const executor = new LlmTaskExecutor(provider, null, null, scripted([
      { content: 'O módulo exporta createServer.', tool_calls: [], finish_reason: 'stop' },
    ]));
    const result = await executor.execute(node([{ type: 'read_code', targets: ['src'] }]), lease(tmp), 'run', 1);
    assert.equal(result.success, true);
    assert.equal(result.completed_by, 'no_tool_call');
  });

  test('mutação real seguida de texto conta como trabalho feito', async () => {
    const executor = new LlmTaskExecutor(provider, null, null, scripted([
      { content: '', tool_calls: [call('write_file', { path: 'out.txt', content: 'ok' })], finish_reason: 'tool_calls' },
      { content: 'Feito.', tool_calls: [], finish_reason: 'stop' },
    ]));
    const result = await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
    assert.equal(result.success, true);
    assert.deepEqual(result.evidence, ['out.txt']);
  });

  test('path fora do workspace vira erro de tool, não escrita', async () => {
    const executor = new LlmTaskExecutor(provider, null, null, scripted([
      { content: '', tool_calls: [call('write_file', { path: '../escape.txt', content: 'x' })], finish_reason: 'tool_calls' },
      { content: '', tool_calls: [call('finish_task', { summary: 'done' })], finish_reason: 'tool_calls' },
    ]));
    await executor.execute(node([{ type: 'generate_patch' }]), lease(tmp), 'run', 1);
    assert.equal(fs.existsSync(path.join(tmp, '..', 'escape.txt')), false);
  });

  test('partitionToolCalls: tools desconhecidas são tratadas como mutação (seriais)', () => {
    const [concurrent, serial] = partitionToolCalls([
      call('read_file', { path: 'a' }),
      call('mystery_tool', {}),
      call('write_file', { path: 'b', content: '' }),
    ]);
    assert.deepEqual(concurrent.map((c) => c.function.name), ['read_file']);
    assert.deepEqual(serial.map((c) => c.function.name), ['mystery_tool', 'write_file']);
  });

  test('teardown', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
