'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BUILT_IN_TOOLS, ALL_BUILT_IN_SCHEMAS } = require('../lib/runtime/executor/built-in-tools');
const { selectToolsForActions } = require('../lib/runtime/executor/action-tool-map');
const { LlmTaskExecutor } = require('../lib/runtime/executor/llm-task-executor');

describe('Gap 4 — finish_task tool', () => {
  it('finish_task exists in BUILT_IN_TOOLS', () => {
    assert.ok(BUILT_IN_TOOLS.finish_task, 'finish_task must be registered');
  });

  it('finish_task is idempotent', () => {
    assert.equal(BUILT_IN_TOOLS.finish_task.idempotent, true);
  });

  it('finish_task execute returns JSON with __finish_task__: true', async () => {
    const result = await BUILT_IN_TOOLS.finish_task.execute(
      { summary: 'Done', evidence_paths: ['src/foo.js'] },
      '/tmp'
    );
    const parsed = JSON.parse(result);
    assert.equal(parsed.__finish_task__, true);
    assert.equal(parsed.summary, 'Done');
    assert.deepEqual(parsed.evidence_paths, ['src/foo.js']);
  });

  it('finish_task execute works without evidence_paths', async () => {
    const result = await BUILT_IN_TOOLS.finish_task.execute({ summary: 'ok' }, '/tmp');
    const parsed = JSON.parse(result);
    assert.equal(parsed.__finish_task__, true);
    assert.deepEqual(parsed.evidence_paths, []);
  });

  it('finish_task appears in ALL_BUILT_IN_SCHEMAS', () => {
    const names = ALL_BUILT_IN_SCHEMAS.map((s) => s.function.name);
    assert.ok(names.includes('finish_task'), 'finish_task must be in ALL_BUILT_IN_SCHEMAS');
  });

  it('selectToolsForActions always includes finish_task', () => {
    for (const actionType of ['read_code', 'generate_patch', 'run_tests', 'run_lint', 'collect_evidence']) {
      const tools = selectToolsForActions([{ type: actionType }]);
      const names = tools.map((t) => t.function.name);
      assert.ok(names.includes('finish_task'), `finish_task must be in tools for action ${actionType}`);
    }
  });

  it('executor returns completed_by: finish_task when LLM calls finish_task', async () => {
    const node = {
      id: 'T1', title: 'Test', mutation_scope: [],
      actions: [{ type: 'generate_patch', command: null, targets: [] }],
      verify: { must_pass: [], command: null },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: '/tmp', workspace_id: 'w1', strategy: 'inplace' };

    let callCount = 0;
    const provider = {
      model: 'test', maxTurns: 10,
      async streamCompletion() { return {}; }, // unused — replaced below
    };

    // Patch streamCompletion to simulate LLM calling finish_task on turn 1
    const streamCompletionModule = require('../lib/runtime/executor/stream-completion');
    const original = streamCompletionModule.streamCompletion;
    streamCompletionModule.streamCompletion = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          finish_reason: 'tool_calls',
          content: '',
          tool_calls: [{
            id: 'tc1',
            function: {
              name: 'finish_task',
              arguments: JSON.stringify({ summary: 'All done', evidence_paths: [] }),
            },
          }],
        };
      }
      return { finish_reason: 'stop', content: 'done', tool_calls: [] };
    };

    try {
      const executor = new LlmTaskExecutor(provider, null, null);
      const result = await executor.execute(node, lease, 'run-1', 1);
      assert.equal(result.success, true, 'should succeed');
      assert.equal(result.completed_by, 'finish_task', 'completed_by must be finish_task');
      assert.equal(result.output, 'All done', 'output should be finish_task summary');
    } finally {
      streamCompletionModule.streamCompletion = original;
    }
  });

  it('executor returns success: false when turn limit exhausted without finish_task', async () => {
    const node = {
      id: 'T2', title: 'Test', mutation_scope: [],
      actions: [{ type: 'run_tests', command: 'npm test', targets: [] }],
      verify: { must_pass: [], command: null },
      workspace_strategy: 'inplace',
      policy: { max_retries: 0, requires_human_approval: false },
    };
    const lease = { root_path: '/tmp', workspace_id: 'w2', strategy: 'inplace' };

    const streamCompletionModule = require('../lib/runtime/executor/stream-completion');
    const original = streamCompletionModule.streamCompletion;
    // Always return a non-finish_task tool call so turns exhaust
    streamCompletionModule.streamCompletion = async () => ({
      finish_reason: 'tool_calls',
      content: '',
      tool_calls: [{
        id: 'tc-loop',
        function: { name: 'glob', arguments: JSON.stringify({ pattern: '**/*.js' }) },
      }],
    });

    try {
      const provider = { model: 'test', maxTurns: 2 };
      const executor = new LlmTaskExecutor(provider, null, null);
      const result = await executor.execute(node, lease, 'run-2', 1);
      assert.equal(result.success, false, 'must fail when turns exhausted');
      assert.equal(result.completed_by, 'turn_limit_exhausted');
      assert.equal(result.failure_class, 'llm');
    } finally {
      streamCompletionModule.streamCompletion = original;
    }
  });
});
