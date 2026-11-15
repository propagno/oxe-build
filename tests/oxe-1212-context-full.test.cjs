'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// R46 (cross-review 15/11): an attempt closed at execute.max_context_chars ("retry") is `context_full` — a plain
// retry with a fresh context. Never a logic failure: the repair does not decompose/prune it at attempt 1, and the
// model tier does not escalate because the context filled up with reads.

describe('context_full: a plain retry, not a logic failure', () => {
  it('the repair does not decide on it (no decompose / prune at attempt 1)', () => {
    const repair = require('../bin/lib/oxe-repair.cjs');
    const out = repair.decide({ id: 'T12', files: ['a.ts'] }, { tasks: [] }, { failureClass: 'context_full', output: 'contexto cheio: 300000 caracteres', attempt: 1, config: {} });
    assert.equal(out, null);
    assert.notEqual(repair.decide({ id: 'T12', files: ['a.ts'] }, { tasks: [] }, { failureClass: 'llm', output: 'x', attempt: 1, config: {} }), null, 'llm still is (the old class)');
  });

  it('the model tier does not escalate on it', () => {
    const tiers = require('../bin/lib/oxe-model-tiers.cjs');
    assert.notEqual(tiers.failureKind('context_full'), 'logic');
    assert.equal(tiers.failureKind('llm'), 'logic');
  });
});
