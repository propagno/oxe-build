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
const decision_engine_1 = require("../src/decision/decision-engine");
function baseInput(overrides = {}) {
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
(0, node_test_1.describe)('DecisionEngine', () => {
    const engine = new decision_engine_1.DecisionEngine();
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-dec-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('proceeds when all signals green', () => {
        const record = engine.evaluate(baseInput());
        strict_1.default.equal(record.type, 'proceed');
        strict_1.default.ok(record.confidence >= 0.5);
        strict_1.default.ok(record.signals.includes('policy_allowed'));
    });
    (0, node_test_1.test)('aborts when policy denied', () => {
        const record = engine.evaluate(baseInput({ policy_allowed: false }));
        strict_1.default.equal(record.type, 'abort');
        strict_1.default.equal(record.confidence, 1.0);
        strict_1.default.ok(record.signals.includes('policy_denied'));
    });
    (0, node_test_1.test)('escalates gate when gate pending and not approved', () => {
        const record = engine.evaluate(baseInput({ gate_pending: true, gate_approved: false }));
        strict_1.default.equal(record.type, 'escalate_gate');
        strict_1.default.ok(record.signals.includes('gate_pending'));
    });
    (0, node_test_1.test)('proceeds when gate approved', () => {
        const record = engine.evaluate(baseInput({ gate_pending: true, gate_approved: true }));
        strict_1.default.notEqual(record.type, 'escalate_gate');
        strict_1.default.ok(record.signals.includes('gate_approved'));
    });
    (0, node_test_1.test)('retries when retry_count > 0 and budget available', () => {
        const record = engine.evaluate(baseInput({ retry_count: 1, max_retries: 2 }));
        strict_1.default.equal(record.type, 'retry');
        strict_1.default.ok(record.signals.includes('retry_budget_available'));
    });
    (0, node_test_1.test)('aborts when retry budget exhausted', () => {
        const record = engine.evaluate(baseInput({ retry_count: 2, max_retries: 2 }));
        strict_1.default.equal(record.type, 'abort');
        strict_1.default.ok(record.signals.includes('retry_budget_exhausted'));
    });
    (0, node_test_1.test)('high risk lowers confidence', () => {
        const normal = engine.evaluate(baseInput());
        const risky = engine.evaluate(baseInput({ risk_level: 'high' }));
        strict_1.default.ok(risky.confidence < normal.confidence);
    });
    (0, node_test_1.test)('lesson match promotes lesson type', () => {
        const record = engine.evaluate(baseInput({ lesson_match: true }));
        strict_1.default.equal(record.type, 'promote_lesson');
        strict_1.default.ok(record.signals.includes('lesson_match'));
    });
    (0, node_test_1.test)('evidence missing lowers confidence', () => {
        const withEvidence = engine.evaluate(baseInput({ evidence_count: 3 }));
        const withoutEvidence = engine.evaluate(baseInput({ evidence_count: 0 }));
        strict_1.default.ok(withoutEvidence.confidence < withEvidence.confidence);
        strict_1.default.ok(withoutEvidence.signals.includes('evidence_missing'));
    });
    (0, node_test_1.test)('seniority is expert for confidence >= 0.9', () => {
        const record = engine.evaluate(baseInput({ policy_allowed: false }));
        strict_1.default.equal(record.seniority, 'expert');
    });
    (0, node_test_1.test)('seniority is junior for very low confidence', () => {
        const record = engine.evaluate(baseInput({
            risk_level: 'critical',
            evidence_count: 0,
            retry_count: 0,
        }));
        strict_1.default.ok(['junior', 'standard'].includes(record.seniority));
    });
    (0, node_test_1.test)('record has required fields', () => {
        const record = engine.evaluate(baseInput({ work_item_id: 'T1' }));
        strict_1.default.ok(record.decision_id.startsWith('dec-'));
        strict_1.default.equal(record.work_item_id, 'T1');
        strict_1.default.ok(record.timestamp);
        strict_1.default.ok(record.rationale.length > 0);
    });
    (0, node_test_1.test)('appendDecision and loadDecisionLog persist correctly', () => {
        const record = engine.evaluate(baseInput({ run_id: 'run-persist', work_item_id: 'T2' }));
        (0, decision_engine_1.appendDecision)(tmpDir, 'run-persist', record);
        (0, decision_engine_1.appendDecision)(tmpDir, 'run-persist', engine.evaluate(baseInput({ run_id: 'run-persist', work_item_id: 'T3' })));
        const log = (0, decision_engine_1.loadDecisionLog)(tmpDir, 'run-persist');
        strict_1.default.ok(log !== null);
        strict_1.default.equal(log.run_id, 'run-persist');
        strict_1.default.equal(log.decisions.length, 2);
    });
    (0, node_test_1.test)('loadDecisionLog returns null for unknown run', () => {
        strict_1.default.equal((0, decision_engine_1.loadDecisionLog)(tmpDir, 'no-such-run'), null);
    });
    (0, node_test_1.test)('queryDecisions filters by type', () => {
        const log = (0, decision_engine_1.loadDecisionLog)(tmpDir, 'run-persist');
        const aborts = (0, decision_engine_1.queryDecisions)(log, { type: 'abort' });
        const proceeds = (0, decision_engine_1.queryDecisions)(log, { type: 'proceed' });
        strict_1.default.ok(aborts.length + proceeds.length <= log.decisions.length);
    });
    (0, node_test_1.test)('queryDecisions filters by workItemId', () => {
        const log = (0, decision_engine_1.loadDecisionLog)(tmpDir, 'run-persist');
        const t2 = (0, decision_engine_1.queryDecisions)(log, { workItemId: 'T2' });
        strict_1.default.equal(t2.length, 1);
        strict_1.default.equal(t2[0].work_item_id, 'T2');
    });
    (0, node_test_1.test)('queryDecisions filters by minConfidence', () => {
        const log = (0, decision_engine_1.loadDecisionLog)(tmpDir, 'run-persist');
        const high = (0, decision_engine_1.queryDecisions)(log, { minConfidence: 0.99 });
        strict_1.default.ok(high.every((d) => d.confidence >= 0.99));
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
