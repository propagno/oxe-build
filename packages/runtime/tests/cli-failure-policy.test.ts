import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cliFailure } from '../src/executor/adapters/claude-cli';

// OxeSpace 15/11 (OxeChat F3 T7): a refusal by the model's usage policy was read as env and retried with the same
// prompt. It is `policy`: no automatic retry.

describe('cliFailure: refusal by the usage policy', () => {
  test('safeguards flagged / [reasoning_extraction] is policy, not env', () => {
    const e = cliFailure({ code: 1, stdout: '', stderr: '', envelope: { subtype: 'success', is_error: true, result: "API Error: Opus 5.5's safeguards flagged this message … Details: [reasoning_extraction]", total_cost_usd: 5.02 } });
    assert.equal(e.kind, 'policy');
    assert.equal(e.costUsd, 5.02);
    assert.match(e.message, /kind=policy/);
  });

  test('quota, context and a plain error keep their kinds', () => {
    assert.equal(cliFailure({ code: 1, stdout: '', stderr: '', envelope: { result: 'prompt is too long: 250000 tokens' } }).kind, 'context');
    assert.equal(cliFailure({ code: 1, stdout: '', stderr: 'spawn ENOENT', envelope: null }).kind, 'env');
  });
});
