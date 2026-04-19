"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const decision_memo_1 = require("../src/decision/decision-memo");
const decision_engine_1 = require("../src/decision/decision-engine");
(0, node_test_1.describe)('StrategySelector', () => {
    const sel = new decision_memo_1.StrategySelector();
    (0, node_test_1.test)('minimal_patch for small scope + no retries', () => {
        strict_1.default.equal(sel.select(['src/auth.ts'], 0, 'low'), 'minimal_patch');
    });
    (0, node_test_1.test)('minimal_patch when retry_count > 1', () => {
        strict_1.default.equal(sel.select(['a', 'b'], 2, 'low'), 'minimal_patch');
    });
    (0, node_test_1.test)('isolated_refactor for wide scope', () => {
        const scope = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
        strict_1.default.equal(sel.select(scope, 0, 'low'), 'isolated_refactor');
    });
    (0, node_test_1.test)('feature_flag for high risk', () => {
        strict_1.default.equal(sel.select(['a', 'b'], 0, 'high'), 'feature_flag');
    });
    (0, node_test_1.test)('feature_flag for critical risk', () => {
        strict_1.default.equal(sel.select(['a'], 0, 'critical'), 'feature_flag');
    });
    (0, node_test_1.test)('no_op for empty scope', () => {
        strict_1.default.equal(sel.select([], 0, 'none'), 'no_op');
    });
    (0, node_test_1.test)('expand_contract for moderate scope', () => {
        strict_1.default.equal(sel.select(['a', 'b', 'c', 'd'], 0, 'low'), 'expand_contract');
    });
    (0, node_test_1.test)('alternatives does not include chosen strategy', () => {
        const chosen = sel.select(['a'], 0, 'low');
        const alts = sel.alternatives(chosen, ['a'], 'low');
        strict_1.default.ok(alts.every((a) => a.strategy !== chosen));
        strict_1.default.ok(alts.length > 0);
    });
});
(0, node_test_1.describe)('buildBlastRadius', () => {
    (0, node_test_1.test)('single file — low risk', () => {
        const r = (0, decision_memo_1.buildBlastRadius)(['src/auth.ts'], 0, 'low');
        strict_1.default.equal(r.estimated_files, 1);
        strict_1.default.ok(r.risk_score < 0.5);
        strict_1.default.equal(r.reversible, true);
    });
    (0, node_test_1.test)('many files — higher risk', () => {
        const scope = Array.from({ length: 15 }, (_, i) => `src/mod${i}.ts`);
        const r = (0, decision_memo_1.buildBlastRadius)(scope, 0, 'medium');
        strict_1.default.ok(r.risk_score > 0.3);
    });
    (0, node_test_1.test)('critical risk makes non-reversible', () => {
        const r = (0, decision_memo_1.buildBlastRadius)(['a'], 0, 'critical');
        strict_1.default.equal(r.reversible, false);
    });
    (0, node_test_1.test)('subsystems derived from path prefixes', () => {
        const r = (0, decision_memo_1.buildBlastRadius)(['src/auth/login.ts', 'src/auth/logout.ts', 'tests/auth.test.ts'], 0, 'low');
        strict_1.default.ok(r.subsystems.includes('src'));
        strict_1.default.ok(r.subsystems.includes('tests'));
    });
});
(0, node_test_1.describe)('buildRollbackPlan', () => {
    (0, node_test_1.test)('low risk → undo_patch', () => {
        const blast = (0, decision_memo_1.buildBlastRadius)(['a.ts'], 0, 'low');
        const plan = (0, decision_memo_1.buildRollbackPlan)(blast, 0);
        strict_1.default.equal(plan.strategy, 'undo_patch');
        strict_1.default.equal(plan.estimated_cost, 'low');
    });
    (0, node_test_1.test)('multiple retries → revert_commit', () => {
        const blast = (0, decision_memo_1.buildBlastRadius)(['a', 'b', 'c', 'd', 'e', 'f'], 0, 'medium');
        const plan = (0, decision_memo_1.buildRollbackPlan)(blast, 2);
        strict_1.default.ok(plan.strategy === 'revert_commit' || plan.strategy === 'restore_workspace');
    });
    (0, node_test_1.test)('high risk_score → restore_workspace', () => {
        const blast = (0, decision_memo_1.buildBlastRadius)(Array.from({ length: 20 }, (_, i) => `f${i}`), 5, 'critical');
        const plan = (0, decision_memo_1.buildRollbackPlan)(blast, 0);
        strict_1.default.equal(plan.strategy, 'restore_workspace');
        strict_1.default.equal(plan.estimated_cost, 'high');
    });
});
(0, node_test_1.describe)('buildMemo', () => {
    (0, node_test_1.test)('creates a valid DecisionMemo', () => {
        const memo = (0, decision_memo_1.buildMemo)({
            work_item_id: 'T1',
            run_id: 'r1',
            problem_summary: 'Fix the auth bug',
            mutation_scope: ['src/auth.ts'],
            retry_count: 0,
            risk_level: 'low',
        });
        strict_1.default.ok(memo.memo_id.startsWith('memo-'));
        strict_1.default.equal(memo.work_item_id, 'T1');
        strict_1.default.equal(memo.run_id, 'r1');
        strict_1.default.ok(memo.chosen_strategy);
        strict_1.default.ok(Array.isArray(memo.alternatives_rejected));
        strict_1.default.ok(memo.blast_radius.estimated_files >= 0);
        strict_1.default.ok(memo.rollback_plan.strategy);
        strict_1.default.ok(memo.confidence >= 0 && memo.confidence <= 1);
    });
});
(0, node_test_1.describe)('Memo persistence', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-memo-'));
    });
    (0, node_test_1.test)('saveMemo and loadMemo round-trip', () => {
        const memo = (0, decision_memo_1.buildMemo)({
            work_item_id: 'T2',
            run_id: 'r2',
            problem_summary: 'Refactor services',
            mutation_scope: ['src/services/a.ts', 'src/services/b.ts'],
            retry_count: 0,
            risk_level: 'medium',
        });
        (0, decision_memo_1.saveMemo)(tmpDir, memo);
        const loaded = (0, decision_memo_1.loadMemo)(tmpDir, 'r2', memo.memo_id);
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.memo_id, memo.memo_id);
        strict_1.default.equal(loaded.chosen_strategy, memo.chosen_strategy);
    });
    (0, node_test_1.test)('loadMemo returns null for unknown memo', () => {
        strict_1.default.equal((0, decision_memo_1.loadMemo)(tmpDir, 'r-none', 'memo-nope'), null);
    });
    (0, node_test_1.test)('listMemos returns all memos for a run', () => {
        const m1 = (0, decision_memo_1.buildMemo)({ work_item_id: 'T3', run_id: 'r3', problem_summary: 'p1', mutation_scope: [], retry_count: 0, risk_level: 'low' });
        const m2 = (0, decision_memo_1.buildMemo)({ work_item_id: 'T4', run_id: 'r3', problem_summary: 'p2', mutation_scope: ['a'], retry_count: 0, risk_level: 'low' });
        (0, decision_memo_1.saveMemo)(tmpDir, m1);
        (0, decision_memo_1.saveMemo)(tmpDir, m2);
        const memos = (0, decision_memo_1.listMemos)(tmpDir, 'r3');
        strict_1.default.equal(memos.length, 2);
    });
    (0, node_test_1.test)('listMemos returns empty for unknown run', () => {
        strict_1.default.deepEqual((0, decision_memo_1.listMemos)(tmpDir, 'r-noexist'), []);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('DecisionEngine with memo', () => {
    (0, node_test_1.test)('memo is propagated to DecisionRecord', () => {
        const memo = (0, decision_memo_1.buildMemo)({
            work_item_id: 'T5',
            run_id: 'r5',
            problem_summary: 'test',
            mutation_scope: ['a'],
            retry_count: 0,
            risk_level: 'low',
        });
        const engine = new decision_engine_1.DecisionEngine();
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
        strict_1.default.ok(record.memo !== undefined);
        strict_1.default.equal(record.memo.memo_id, memo.memo_id);
    });
    (0, node_test_1.test)('DecisionRecord without memo has no memo field', () => {
        const engine = new decision_engine_1.DecisionEngine();
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
        strict_1.default.equal(record.memo, undefined);
    });
});
