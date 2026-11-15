import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { LlmTaskExecutor } from '../src/executor/llm-task-executor';
import type { LlmExecutorEvent, CompletionFn } from '../src/executor/llm-task-executor';
import type { GraphNode } from '../src/compiler/graph-compiler';

// OxeSpace 15/11 (Celular F3 T9): a policy refusal at turn 2 after reading five files — which one triggered it? The
// failure names what the previous turn added to the prompt (the only new content between the two requests).

const node: GraphNode = {
  id: 'T9', title: 'tela', wave: 1, depends_on: [], workspace_strategy: 'inplace', mutation_scope: ['a.kt'],
  actions: [{ type: 'generate_patch', targets: ['a.kt'] }],
  verify: { must_pass: [], acceptance_refs: [], command: null },
  policy: { requires_human_approval: false, max_retries: 0 },
};

async function run(complete: CompletionFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-policy-trig-'));
  try {
    fs.writeFileSync(path.join(dir, 'Conversation.kt'), 'class Conversation');
    fs.writeFileSync(path.join(dir, 'ThreadScreen.kt'), 'fun ThreadScreen() {}');
    const events: LlmExecutorEvent[] = [];
    const exec = new LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => events.push(e), complete);
    const result = await exec.execute(node, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 }, 'r', 1);
    return { result, events };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const refusal = () => Object.assign(new Error('API Error: safeguards flagged this request [reasoning_extraction]'), { kind: 'policy' });

describe('policy refusal names its likely trigger', () => {
  test('at turn 2: the tool results of turn 1, with sizes; the hint offers --retry-policy-once', async () => {
    let turn = 0;
    const { result, events } = await run(async () => {
      turn += 1;
      if (turn === 1) {
        return {
          content: '', finish_reason: 'tool_calls',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'Conversation.kt' }) } },
            { id: 'c2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'ThreadScreen.kt' }) } },
          ],
        };
      }
      throw refusal();
    });
    assert.equal(result.success, false);
    assert.equal(result.failure_class, 'policy');
    assert.match(result.output, /Conteúdo novo desde a requisição anterior[^\n]*read_file Conversation\.kt \(\d+ chars\) · read_file ThreadScreen\.kt/);
    assert.match(result.output, /--retry-policy-once/);
    const u = events.find((e) => e.type === 'executor_usage')?.detail as { policy_trigger_candidates?: Array<{ tool: string; target: string }> };
    assert.deepEqual(u.policy_trigger_candidates?.map((t) => t.target), ['Conversation.kt', 'ThreadScreen.kt']);
  });

  test('the outputs are saved verbatim next to the attempt log; the hint says the trigger is not in the pack (OxeChat F4 T12)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-policy-out-'));
    try {
      fs.writeFileSync(path.join(dir, 'thread-fixtures.ts'), "export const rows = [{ phase: 'reasoning', text: 'linha 171' }];\n");
      let turn = 0;
      const exec = new LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => {}, async () => {
        turn += 1;
        if (turn === 1) return { content: '', finish_reason: 'tool_calls', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'thread-fixtures.ts' }) } }] };
        throw refusal();
      });
      const result = await exec.execute(node, { workspace_id: 'w', strategy: 'inplace', isolation_level: 'shared', branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 }, 'run-x', 3);
      const saved = path.join(dir, '.oxe', 'runs', 'run-x', 'attempts', 'T9-3.policy-tools.txt');
      assert.ok(fs.existsSync(saved), 'saved next to the attempt log');
      assert.match(fs.readFileSync(saved, 'utf8'), /===== read_file thread-fixtures\.ts \(\d+ chars\) =====[\s\S]*phase: 'reasoning'/);
      assert.match(result.output, /O gatilho veio de saídas de ferramenta do turno anterior, salvas na íntegra em \.oxe\/runs\/run-x\/attempts\/T9-3\.policy-tools\.txt — não do pack/);
      assert.doesNotMatch(result.output, /tire o trecho que dispara a recusa/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('context soft cap: warn once by default; "retry" closes the attempt as contexto cheio (T12, 277k chars)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ctx-cap-'));
    try {
      fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(5000));
      let id = 0;
      const reads = () => ({ content: '', finish_reason: 'tool_calls', tool_calls: [{ id: `c${id++}`, type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path: 'big.txt' }) } }] });
      const lease = { workspace_id: 'w', strategy: 'inplace' as const, isolation_level: 'shared' as const, branch: null, base_commit: null, root_path: dir, ttl_minutes: 5 };
      const warnEvents: LlmExecutorEvent[] = [];
      let n = 0;
      const warnComplete: CompletionFn = async () => { n += 1; return n < 4 ? reads() : { content: 'ok', finish_reason: 'stop', tool_calls: [] }; };
      const warn = new LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, (e) => warnEvents.push(e), warnComplete, { maxContextChars: 800, noProgressTurns: 0 });
      await warn.execute(node, lease, 'r', 1);
      const capWarn = warnEvents.filter((e) => e.type === 'executor_context_cap');
      assert.equal(capWarn.length, 1, 'warned once');
      assert.equal((capWarn[0].detail as { action: string }).action, 'warn');
      let m = 0;
      const retryComplete: CompletionFn = async () => { m += 1; return reads(); };
      const retry = new LlmTaskExecutor({ baseUrl: '', apiKey: '', model: '', maxTurns: 4 }, null, () => {}, retryComplete, { maxContextChars: 800, maxContextAction: 'retry', noProgressTurns: 0 });
      const res = await retry.execute(node, lease, 'r', 1);
      assert.equal(res.success, false);
      assert.match(res.output, /^contexto cheio: \d+ caracteres acumulados no turno 1/);
      assert.equal(m, 1, 'no further paid request once full');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('at the first request: the trigger is in the starting prompt', async () => {
    const { result } = await run(async () => { throw refusal(); });
    assert.equal(result.failure_class, 'policy');
    assert.match(result.output, /primeira requisição: o gatilho está no prompt inicial/);
  });
});
