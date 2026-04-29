'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildNodePrompt } = require('../lib/runtime/executor/node-prompt-builder');

const sampleNode = {
  id: 'T1',
  title: 'Implement auth middleware',
  mutation_scope: ['src/auth.js'],
  actions: [{ type: 'generate_patch', command: null, targets: [] }],
  verify: { must_pass: ['Tests pass'], command: 'npm test' },
  workspace_strategy: 'inplace',
  policy: { max_retries: 2, requires_human_approval: false },
};

const sampleLease = { root_path: '/workspace/project', workspace_id: 'w1', strategy: 'inplace' };

describe('Gap 3 — retry context in prompt', () => {
  it('attempt=1 with no previousError produces no retry section', () => {
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', 1);
    assert.ok(!prompt.includes('Contexto da tentativa anterior'), 'No retry section on attempt 1');
    assert.ok(!prompt.includes('tentativa anterior falhou'), 'No failure mention on attempt 1');
  });

  it('attempt=1 with previousError still produces no retry section (no previousError option)', () => {
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', 1, {});
    assert.ok(!prompt.includes('Contexto da tentativa anterior'), 'No retry section on attempt 1 even with empty options');
  });

  it('attempt=2 with previousError includes retry context section', () => {
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', 2, {
      previousError: 'ENOENT: file not found at src/auth.js',
    });
    assert.ok(prompt.includes('Contexto da tentativa anterior'), 'Must include retry section header');
    assert.ok(prompt.includes('tentativa **2**'), 'Must mention attempt number');
    assert.ok(prompt.includes('ENOENT: file not found'), 'Must include the actual error text');
    assert.ok(prompt.includes('abordagem diferente'), 'Must instruct different approach');
  });

  it('attempt=2 with no previousError does not add retry section', () => {
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', 2, { previousError: null });
    assert.ok(!prompt.includes('Contexto da tentativa anterior'), 'No retry section when previousError is null');
  });

  it('long previousError is truncated to 2000 chars', () => {
    const longError = 'x'.repeat(5000);
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', 2, { previousError: longError });
    assert.ok(prompt.includes('Contexto da tentativa anterior'), 'Retry section present');
    // The truncated error (2000 x's) should appear, not the full 5000
    assert.ok(!prompt.includes('x'.repeat(2001)), 'Error truncated to 2000 chars');
    assert.ok(prompt.includes('x'.repeat(2000)), 'First 2000 chars present');
  });

  it('prompt always includes finish_task instruction regardless of attempt', () => {
    for (const attempt of [1, 2, 3]) {
      const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-1', attempt, {
        previousError: attempt > 1 ? 'some error' : null,
      });
      assert.ok(prompt.includes('finish_task'), `finish_task instruction must appear on attempt ${attempt}`);
      assert.ok(prompt.includes('Conclusão da tarefa'), `Conclusão section must appear on attempt ${attempt}`);
    }
  });

  it('prompt includes task title, run id, and workspace', () => {
    const prompt = buildNodePrompt(sampleNode, sampleLease, 'run-xyz', 1);
    assert.ok(prompt.includes('Implement auth middleware'), 'Title present');
    assert.ok(prompt.includes('run-xyz'), 'Run ID present');
    assert.ok(prompt.includes('/workspace/project'), 'Workspace path present');
  });
});
