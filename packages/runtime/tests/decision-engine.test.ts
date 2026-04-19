import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  DecisionEngine,
  appendDecision,
  loadDecisionLog,
  queryDecisions,
} from '../src/decision/decision-engine';
import type { DecisionInput } from '../src/decision/decision-engine';

function baseInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    run_id: 'run-dec',
    policy_allowed: true,
    gate_pending: false,
    gate_approved: false,
    retry_count: 0,
    max_retries: 2,
    evidence_count: 1,
    risk_level: 'none',
    lesson_match: false,
    ...overrides,
  };
}

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dec-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('proceeds when all signals green', () => {
    const record = engine.evaluate(baseInput());
    assert.equal(record.type, 'proceed');
    assert.ok(record.confidence >= 0.5);
    assert.ok(record.signals.includes('policy_allowed'));
  });

  test('aborts when policy denied', () => {
    const record = engine.evaluate(baseInput({ policy_allowed: false }));
    assert.equal(record.type, 'abort');
    assert.equal(record.confidence, 1.0);
    assert.ok(record.signals.includes('policy_denied'));
  });

  test('escalates gate when gate pending and not approved', () => {
    const record = engine.evaluate(baseInput({ gate_pending: true, gate_approved: false }));
    assert.equal(record.type, 'escalate_gate');
    assert.ok(record.signals.includes('gate_pending'));
  });

  test('proceeds when gate approved', () => {
    const record = engine.evaluate(baseInput({ gate_pending: true, gate_approved: true }));
    assert.notEqual(record.type, 'escalate_gate');
    assert.ok(record.signals.includes('gate_approved'));
  });

  test('retries when retry_count > 0 and budget available', () => {
    const record = engine.evaluate(baseInput({ retry_count: 1, max_retries: 2 }));
    assert.equal(record.type, 'retry');
    assert.ok(record.signals.includes('retry_budget_available'));
  });

  test('aborts when retry budget exhausted', () => {
    const record = engine.evaluate(baseInput({ retry_count: 2, max_retries: 2 }));
    assert.equal(record.type, 'abort');
    assert.ok(record.signals.includes('retry_budget_exhausted'));
  });

  test('high risk lowers confidence', () => {
    const normal = engine.evaluate(baseInput());
    const risky = engine.evaluate(baseInput({ risk_level: 'high' }));
    assert.ok(risky.confidence < normal.confidence);
  });

  test('lesson match promotes lesson type', () => {
    const record = engine.evaluate(baseInput({ lesson_match: true }));
    assert.equal(record.type, 'promote_lesson');
    assert.ok(record.signals.includes('lesson_match'));
  });

  test('evidence missing lowers confidence', () => {
    const withEvidence = engine.evaluate(baseInput({ evidence_count: 3 }));
    const withoutEvidence = engine.evaluate(baseInput({ evidence_count: 0 }));
    assert.ok(withoutEvidence.confidence < withEvidence.confidence);
    assert.ok(withoutEvidence.signals.includes('evidence_missing'));
  });

  test('seniority is expert for confidence >= 0.9', () => {
    const record = engine.evaluate(baseInput({ policy_allowed: false }));
    assert.equal(record.seniority, 'expert');
  });

  test('seniority is junior for very low confidence', () => {
    const record = engine.evaluate(baseInput({
      risk_level: 'critical',
      evidence_count: 0,
      retry_count: 0,
    }));
    assert.ok(['junior', 'standard'].includes(record.seniority));
  });

  test('record has required fields', () => {
    const record = engine.evaluate(baseInput({ work_item_id: 'T1' }));
    assert.ok(record.decision_id.startsWith('dec-'));
    assert.equal(record.work_item_id, 'T1');
    assert.ok(record.timestamp);
    assert.ok(record.rationale.length > 0);
  });

  test('appendDecision and loadDecisionLog persist correctly', () => {
    const record = engine.evaluate(baseInput({ run_id: 'run-persist', work_item_id: 'T2' }));
    appendDecision(tmpDir, 'run-persist', record);
    appendDecision(tmpDir, 'run-persist', engine.evaluate(baseInput({ run_id: 'run-persist', work_item_id: 'T3' })));

    const log = loadDecisionLog(tmpDir, 'run-persist');
    assert.ok(log !== null);
    assert.equal(log!.run_id, 'run-persist');
    assert.equal(log!.decisions.length, 2);
  });

  test('loadDecisionLog returns null for unknown run', () => {
    assert.equal(loadDecisionLog(tmpDir, 'no-such-run'), null);
  });

  test('queryDecisions filters by type', () => {
    const log = loadDecisionLog(tmpDir, 'run-persist')!;
    const aborts = queryDecisions(log, { type: 'abort' });
    const proceeds = queryDecisions(log, { type: 'proceed' });
    assert.ok(aborts.length + proceeds.length <= log.decisions.length);
  });

  test('queryDecisions filters by workItemId', () => {
    const log = loadDecisionLog(tmpDir, 'run-persist')!;
    const t2 = queryDecisions(log, { workItemId: 'T2' });
    assert.equal(t2.length, 1);
    assert.equal(t2[0].work_item_id, 'T2');
  });

  test('queryDecisions filters by minConfidence', () => {
    const log = loadDecisionLog(tmpDir, 'run-persist')!;
    const high = queryDecisions(log, { minConfidence: 0.99 });
    assert.ok(high.every((d) => d.confidence >= 0.99));
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
