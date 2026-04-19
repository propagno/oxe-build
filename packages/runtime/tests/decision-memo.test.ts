import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  StrategySelector,
  buildBlastRadius,
  buildRollbackPlan,
  buildMemo,
  saveMemo,
  loadMemo,
  listMemos,
} from '../src/decision/decision-memo';
import { DecisionEngine } from '../src/decision/decision-engine';

describe('StrategySelector', () => {
  const sel = new StrategySelector();

  test('minimal_patch for small scope + no retries', () => {
    assert.equal(sel.select(['src/auth.ts'], 0, 'low'), 'minimal_patch');
  });

  test('minimal_patch when retry_count > 1', () => {
    assert.equal(sel.select(['a', 'b'], 2, 'low'), 'minimal_patch');
  });

  test('isolated_refactor for wide scope', () => {
    const scope = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
    assert.equal(sel.select(scope, 0, 'low'), 'isolated_refactor');
  });

  test('feature_flag for high risk', () => {
    assert.equal(sel.select(['a', 'b'], 0, 'high'), 'feature_flag');
  });

  test('feature_flag for critical risk', () => {
    assert.equal(sel.select(['a'], 0, 'critical'), 'feature_flag');
  });

  test('no_op for empty scope', () => {
    assert.equal(sel.select([], 0, 'none'), 'no_op');
  });

  test('expand_contract for moderate scope', () => {
    assert.equal(sel.select(['a', 'b', 'c', 'd'], 0, 'low'), 'expand_contract');
  });

  test('alternatives does not include chosen strategy', () => {
    const chosen = sel.select(['a'], 0, 'low');
    const alts = sel.alternatives(chosen, ['a'], 'low');
    assert.ok(alts.every((a) => a.strategy !== chosen));
    assert.ok(alts.length > 0);
  });
});

describe('buildBlastRadius', () => {
  test('single file — low risk', () => {
    const r = buildBlastRadius(['src/auth.ts'], 0, 'low');
    assert.equal(r.estimated_files, 1);
    assert.ok(r.risk_score < 0.5);
    assert.equal(r.reversible, true);
  });

  test('many files — higher risk', () => {
    const scope = Array.from({ length: 15 }, (_, i) => `src/mod${i}.ts`);
    const r = buildBlastRadius(scope, 0, 'medium');
    assert.ok(r.risk_score > 0.3);
  });

  test('critical risk makes non-reversible', () => {
    const r = buildBlastRadius(['a'], 0, 'critical');
    assert.equal(r.reversible, false);
  });

  test('subsystems derived from path prefixes', () => {
    const r = buildBlastRadius(['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts'], 0, 'low');
    assert.ok(r.subsystems.includes('src'));
    assert.ok(r.subsystems.includes('tests'));
  });
});

describe('buildRollbackPlan', () => {
  test('low risk → undo_patch', () => {
    const blast = buildBlastRadius(['a.ts'], 0, 'low');
    const plan = buildRollbackPlan(blast, 0);
    assert.equal(plan.strategy, 'undo_patch');
    assert.equal(plan.estimated_cost, 'low');
  });

  test('multiple retries → revert_commit', () => {
    const blast = buildBlastRadius(['a', 'b', 'c', 'd', 'e', 'f'], 0, 'medium');
    const plan = buildRollbackPlan(blast, 2);
    assert.ok(plan.strategy === 'revert_commit' || plan.strategy === 'restore_workspace');
  });

  test('high risk_score → restore_workspace', () => {
    const blast = buildBlastRadius(Array.from({ length: 20 }, (_, i) => `f${i}`), 5, 'critical');
    const plan = buildRollbackPlan(blast, 0);
    assert.equal(plan.strategy, 'restore_workspace');
    assert.equal(plan.estimated_cost, 'high');
  });
});

describe('buildMemo', () => {
  test('creates a valid DecisionMemo', () => {
    const memo = buildMemo({
      work_item_id: 'T1',
      run_id: 'r1',
      problem_summary: 'Fix the auth bug',
      mutation_scope: ['src/auth.ts'],
      retry_count: 0,
      risk_level: 'low',
    });
    assert.ok(memo.memo_id.startsWith('memo-'));
    assert.equal(memo.work_item_id, 'T1');
    assert.equal(memo.run_id, 'r1');
    assert.ok(memo.chosen_strategy);
    assert.ok(Array.isArray(memo.alternatives_rejected));
    assert.ok(memo.blast_radius.estimated_files >= 0);
    assert.ok(memo.rollback_plan.strategy);
    assert.ok(memo.confidence >= 0 && memo.confidence <= 1);
  });
});

describe('Memo persistence', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-memo-'));
  });

  test('saveMemo and loadMemo round-trip', () => {
    const memo = buildMemo({
      work_item_id: 'T2',
      run_id: 'r2',
      problem_summary: 'Refactor services',
      mutation_scope: ['src/services/a.ts', 'src/services/b.ts'],
      retry_count: 0,
      risk_level: 'medium',
    });
    saveMemo(tmpDir, memo);
    const loaded = loadMemo(tmpDir, 'r2', memo.memo_id);
    assert.ok(loaded !== null);
    assert.equal(loaded!.memo_id, memo.memo_id);
    assert.equal(loaded!.chosen_strategy, memo.chosen_strategy);
  });

  test('loadMemo returns null for unknown memo', () => {
    assert.equal(loadMemo(tmpDir, 'r-none', 'memo-nope'), null);
  });

  test('listMemos returns all memos for a run', () => {
    const m1 = buildMemo({ work_item_id: 'T3', run_id: 'r3', problem_summary: 'p1', mutation_scope: [], retry_count: 0, risk_level: 'low' });
    const m2 = buildMemo({ work_item_id: 'T4', run_id: 'r3', problem_summary: 'p2', mutation_scope: ['a'], retry_count: 0, risk_level: 'low' });
    saveMemo(tmpDir, m1);
    saveMemo(tmpDir, m2);
    const memos = listMemos(tmpDir, 'r3');
    assert.equal(memos.length, 2);
  });

  test('listMemos returns empty for unknown run', () => {
    assert.deepEqual(listMemos(tmpDir, 'r-noexist'), []);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('DecisionEngine with memo', () => {
  test('memo is propagated to DecisionRecord', () => {
    const memo = buildMemo({
      work_item_id: 'T5',
      run_id: 'r5',
      problem_summary: 'test',
      mutation_scope: ['a'],
      retry_count: 0,
      risk_level: 'low',
    });
    const engine = new DecisionEngine();
    const record = engine.evaluate({
      work_item_id: 'T5',
      run_id: 'r5',
      policy_allowed: true,
      gate_pending: false,
      gate_approved: false,
      retry_count: 0,
      max_retries: 3,
      evidence_count: 2,
      risk_level: 'low',
      lesson_match: false,
      memo,
    });
    assert.ok(record.memo !== undefined);
    assert.equal(record.memo!.memo_id, memo.memo_id);
  });

  test('DecisionRecord without memo has no memo field', () => {
    const engine = new DecisionEngine();
    const record = engine.evaluate({
      run_id: 'r6',
      policy_allowed: true,
      gate_pending: false,
      gate_approved: false,
      retry_count: 0,
      max_retries: 3,
      evidence_count: 0,
      risk_level: 'none',
      lesson_match: false,
    });
    assert.equal(record.memo, undefined);
  });
});
