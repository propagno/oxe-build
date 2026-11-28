'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tiers = require('../../bin/lib/oxe-model-tiers.cjs');

describe('A6 — Roteamento empírico opt-in models.auto_route consumindo suggested_model_hint (OXB-230-06)', () => {
  it('OXB-230-06: createModelSelector uses suggested_model_hint when models.auto_route is true while preserving override, explicit model_hint, default_tier, and escalation', () => {
    const tasks = new Map([
      ['T1', { id: 'T1', suggested_model_hint: 'fast' }],
      ['T2', { id: 'T2', model_hint: 'powerful', suggested_model_hint: 'fast' }],
      ['T3', { id: 'T3', suggested_model_hint: 'fast' }],
      ['T4', { id: 'T4' }],
    ]);
    const baseModels = {
      tiers: { fast: 'model-fast', balanced: 'model-balanced', powerful: 'model-powerful' },
      default_tier: 'balanced',
      escalate_on: ['logic'],
      max_escalations: 1,
      overrides: { T3: 'model-override' },
    };

    // 1. Default (auto_route off/unset): ignores suggested_model_hint, uses default_tier ('balanced')
    const selOff = tiers.createModelSelector({ models: { ...baseModels } }, tasks);
    assert.deepEqual(selOff('T1', 1), { model: 'model-balanced', tier: 'balanced', escalated: false });
    assert.deepEqual(selOff('T2', 1), { model: 'model-powerful', tier: 'powerful', escalated: false });
    assert.deepEqual(selOff('T3', 1), { model: 'model-override', tier: 'override', escalated: false });

    // 2. Opt-in (models.auto_route: true): T1 picks suggested_model_hint ('fast'), T2 keeps explicit model_hint, T3 keeps override, T4 falls back to default_tier
    const selOn = tiers.createModelSelector({ models: { ...baseModels, auto_route: true } }, tasks);
    const t1Attempt1 = selOn('T1', 1);
    assert.equal(t1Attempt1.model, 'model-fast', 'models.auto_route: true must route to suggested_model_hint');
    assert.equal(t1Attempt1.tier, 'fast');
    assert.equal(t1Attempt1.escalated, false);
    assert.equal(t1Attempt1.auto_routed, true);

    // Escalation from auto-routed 'fast' -> 'balanced' on logic failure still works
    const t1Attempt2 = selOn('T1', 2, 'logic');
    assert.equal(t1Attempt2.model, 'model-balanced');
    assert.equal(t1Attempt2.tier, 'balanced');
    assert.equal(t1Attempt2.escalated, true);

    // Explicit model_hint beats suggested_model_hint
    const t2Attempt1 = selOn('T2', 1);
    assert.equal(t2Attempt1.model, 'model-powerful');
    assert.equal(t2Attempt1.tier, 'powerful');

    // Explicit override beats everything
    const t3Attempt1 = selOn('T3', 1);
    assert.equal(t3Attempt1.model, 'model-override');
    assert.equal(t3Attempt1.tier, 'override');

    // Task without suggested_model_hint falls back to default_tier
    const t4Attempt1 = selOn('T4', 1);
    assert.equal(t4Attempt1.model, 'model-balanced');
    assert.equal(t4Attempt1.tier, 'balanced');
  });
});
