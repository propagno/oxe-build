'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mr = require('../bin/lib/oxe-model-resolve.cjs');

// 1.21.2 — OXB-187: the model an execute uses and who chose it; a default nobody picked is reported.

describe('OXB-187: model resolution', () => {
  it('claude adapter: --model > OXE_CLAUDE_MODEL > Claude Code default; runtime.provider.model does not apply and is noted', () => {
    assert.deepEqual([mr.resolve({ adapter: 'claude', flag: 'm-flag', env: {} }).model, mr.resolve({ adapter: 'claude', flag: 'm-flag', env: {} }).source], ['m-flag', '--model']);
    assert.equal(mr.resolve({ adapter: 'claude', env: { OXE_CLAUDE_MODEL: 'm-env' } }).model, 'm-env');
    const d = mr.resolve({ adapter: 'claude', env: {}, persisted: { model: 'claude-sonnet-4-6' } });
    assert.equal(d.model, null);
    assert.equal(d.operator_chosen, true);
    assert.match(d.notes[0], /runtime\.provider\.model=claude-sonnet-4-6 é do adaptador http e não se aplica ao claude -p/);
  });

  it('http adapter: the built-in default is not the operator\'s choice and is reported; tiers are reported', () => {
    const d = mr.resolve({ adapter: 'http', env: {}, persisted: {} });
    assert.deepEqual([d.model, d.operator_chosen], ['claude-sonnet-4-6', false]);
    assert.match(d.notes[0], /nenhum modelo escolhido: o adaptador http usa o padrão embutido claude-sonnet-4-6/);
    assert.equal(mr.resolve({ adapter: 'http', env: {}, persisted: { model: 'x' } }).source, 'runtime.provider.model');
    const t = mr.resolve({ adapter: 'claude', env: {}, config: { models: { tiers: { fast: 'f', balanced: 'b' } } } });
    assert.match(t.notes.join('\n'), /models\.tiers ativo: cada tentativa usa o modelo do nível \(fast=f, balanced=b\)/);
  });
});
