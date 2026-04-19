"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const run_state_reducer_1 = require("../src/reducers/run-state-reducer");
function makeEvent(overrides) {
    return {
        id: `evt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        session_id: 's001',
        run_id: 'r001',
        work_item_id: null,
        attempt_id: null,
        causation_id: null,
        correlation_id: null,
        payload: {},
        ...overrides,
    };
}
(0, node_test_1.describe)('RunState Reducer', () => {
    (0, node_test_1.test)('starts empty', () => {
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        strict_1.default.equal(state.run, null);
        strict_1.default.equal(state.workItems.size, 0);
        strict_1.default.equal(state.attempts.size, 0);
    });
    (0, node_test_1.test)('RunStarted sets run', () => {
        const events = [
            makeEvent({
                type: 'RunStarted',
                payload: { run_id: 'r001', status: 'running', session_id: 's001', graph_version: '1', started_at: new Date().toISOString(), ended_at: null, initiator: 'user', mode: 'por_onda' },
            }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.ok(state.run !== null);
        strict_1.default.equal(state.run.run_id, 'r001');
    });
    (0, node_test_1.test)('WorkItemReady adds work item with ready status', () => {
        const events = [
            makeEvent({
                type: 'WorkItemReady',
                work_item_id: 'T1',
                payload: { work_item_id: 'T1', title: 'Setup', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' },
            }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getWorkItemStatus)(state, 'T1'), 'ready');
    });
    (0, node_test_1.test)('AttemptStarted tracks attempts per work item', () => {
        const events = [
            makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
            makeEvent({ type: 'AttemptStarted', work_item_id: 'T1', attempt_id: 'T1-a1', payload: { attempt_number: 1 } }),
            makeEvent({ type: 'AttemptStarted', work_item_id: 'T1', attempt_id: 'T1-a2', payload: { attempt_number: 2 } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getAttemptCount)(state, 'T1'), 2);
    });
    (0, node_test_1.test)('WorkItemCompleted marks item as completed', () => {
        const events = [
            makeEvent({ type: 'WorkItemReady', work_item_id: 'T2', payload: { work_item_id: 'T2', title: 'T2', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
            makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T2', payload: { attempt_number: 1 } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getWorkItemStatus)(state, 'T2'), 'completed');
        strict_1.default.ok(state.completedWorkItems.has('T2'));
    });
    (0, node_test_1.test)('WorkItemBlocked marks item and adds to blocked set', () => {
        const events = [
            makeEvent({ type: 'WorkItemReady', work_item_id: 'T3', payload: { work_item_id: 'T3', title: 'T3', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
            makeEvent({ type: 'WorkItemBlocked', work_item_id: 'T3', payload: { reason: 'dependency_failed' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getWorkItemStatus)(state, 'T3'), 'blocked');
        strict_1.default.ok(state.blockedWorkItems.has('T3'));
    });
    (0, node_test_1.test)('RunCompleted updates run status and ended_at', () => {
        const now = new Date().toISOString();
        const events = [
            makeEvent({ type: 'RunStarted', payload: { run_id: 'r001', status: 'running', session_id: 's001', graph_version: '1', started_at: now, ended_at: null, initiator: 'user', mode: 'completo' } }),
            makeEvent({ type: 'RunCompleted', payload: { run_id: 'r001', status: 'completed' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.ok(state.run !== null);
        strict_1.default.equal(state.run.status, 'completed');
        strict_1.default.ok(state.run.ended_at !== null);
    });
    (0, node_test_1.test)('WorkspaceAllocated tracks workspace', () => {
        const events = [
            makeEvent({
                type: 'WorkspaceAllocated',
                work_item_id: 'T1',
                payload: { workspace_id: 'ws-T1-a1', strategy: 'inplace', root_path: '/tmp/ws', base_commit: null, branch: null, container_ref: null, status: 'ready' },
            }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.ok(state.workspaces.has('ws-T1-a1'));
        strict_1.default.equal(state.workspaces.get('ws-T1-a1').strategy, 'inplace');
    });
    (0, node_test_1.test)('replay is deterministic', () => {
        const events = [
            makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
            makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: {} }),
        ];
        const s1 = (0, run_state_reducer_1.reduce)(events);
        const s2 = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getWorkItemStatus)(s1, 'T1'), (0, run_state_reducer_1.getWorkItemStatus)(s2, 'T1'));
        strict_1.default.equal(s1.completedWorkItems.size, s2.completedWorkItems.size);
    });
    (0, node_test_1.test)('RetryScheduled increments retry count', () => {
        const events = [
            makeEvent({ type: 'RetryScheduled', work_item_id: 'T1', payload: { next_attempt: 2, reason: 'env' } }),
            makeEvent({ type: 'RetryScheduled', work_item_id: 'T1', payload: { next_attempt: 3, reason: 'env' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getRetryCount)(state, 'T1'), 2);
        strict_1.default.equal((0, run_state_reducer_1.getRetryCount)(state, 'T2'), 0);
    });
    (0, node_test_1.test)('PolicyEvaluated records decision', () => {
        const events = [
            makeEvent({
                type: 'PolicyEvaluated',
                payload: { work_item_id: 'T1', allowed: false, gate_required: false, reason: 'denied by rule r1', rule_id: 'r1' },
            }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        const decision = (0, run_state_reducer_1.getPolicyDecision)(state, 'T1');
        strict_1.default.ok(decision !== null);
        strict_1.default.equal(decision.allowed, false);
        strict_1.default.equal(decision.rule_id, 'r1');
    });
    (0, node_test_1.test)('GateRequested adds to pendingGates', () => {
        const events = [
            makeEvent({ type: 'GateRequested', payload: { gate_id: 'gate-abc', scope: 'deploy', description: 'test' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.ok(state.pendingGates.has('gate-abc'));
        strict_1.default.equal(state.resolvedGates.size, 0);
    });
    (0, node_test_1.test)('GateResolved moves gate from pending to resolved', () => {
        const events = [
            makeEvent({ type: 'GateRequested', payload: { gate_id: 'gate-abc', scope: 'deploy', description: 'test' } }),
            makeEvent({ type: 'GateResolved', payload: { gate_id: 'gate-abc', decision: 'approved', actor: 'user' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal(state.pendingGates.size, 0);
        strict_1.default.ok(state.resolvedGates.has('gate-abc'));
        strict_1.default.equal(state.resolvedGates.get('gate-abc').decision, 'approved');
    });
    (0, node_test_1.test)('VerificationStarted and VerificationCompleted track status', () => {
        const events = [
            makeEvent({ type: 'VerificationStarted', work_item_id: 'T1', payload: {} }),
        ];
        const s1 = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getVerificationStatus)(s1, 'T1'), 'started');
        const events2 = [
            ...events,
            makeEvent({ type: 'VerificationCompleted', work_item_id: 'T1', payload: { status: 'completed' } }),
        ];
        const s2 = (0, run_state_reducer_1.reduce)(events2);
        strict_1.default.equal((0, run_state_reducer_1.getVerificationStatus)(s2, 'T1'), 'completed');
    });
    (0, node_test_1.test)('VerificationCompleted with failed status', () => {
        const events = [
            makeEvent({ type: 'VerificationStarted', work_item_id: 'T1', payload: {} }),
            makeEvent({ type: 'VerificationCompleted', work_item_id: 'T1', payload: { status: 'failed' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.equal((0, run_state_reducer_1.getVerificationStatus)(state, 'T1'), 'failed');
    });
    (0, node_test_1.test)('ToolFailed appends failure record', () => {
        const events = [
            makeEvent({ type: 'ToolFailed', work_item_id: 'T1', payload: { tool: 'npm_test', error: 'exit 1' } }),
            makeEvent({ type: 'ToolFailed', work_item_id: 'T1', payload: { tool: 'eslint', error: 'lint error' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        const failures = (0, run_state_reducer_1.getToolFailures)(state, 'T1');
        strict_1.default.equal(failures.length, 2);
        strict_1.default.equal(failures[0].tool, 'npm_test');
        strict_1.default.equal(failures[1].tool, 'eslint');
    });
    (0, node_test_1.test)('EvidenceCollected accumulates refs', () => {
        const events = [
            makeEvent({ type: 'EvidenceCollected', work_item_id: 'T1', payload: { refs: ['ev-1', 'ev-2'] } }),
            makeEvent({ type: 'EvidenceCollected', work_item_id: 'T1', payload: { ref: 'ev-3' } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        const refs = (0, run_state_reducer_1.getEvidenceRefs)(state, 'T1');
        strict_1.default.equal(refs.length, 3);
        strict_1.default.ok(refs.includes('ev-1'));
        strict_1.default.ok(refs.includes('ev-3'));
    });
    (0, node_test_1.test)('WorkItemCompleted with evidence adds to evidenceRefs', () => {
        const events = [
            makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
            makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: { attempt_number: 1, evidence: ['ev-a', 'ev-b'] } }),
        ];
        const state = (0, run_state_reducer_1.reduce)(events);
        strict_1.default.ok(state.completedWorkItems.has('T1'));
        const refs = (0, run_state_reducer_1.getEvidenceRefs)(state, 'T1');
        strict_1.default.ok(refs.includes('ev-a'));
        strict_1.default.ok(refs.includes('ev-b'));
    });
    (0, node_test_1.test)('createEmptyRunState initializes all Phase 1 fields', () => {
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        strict_1.default.equal(state.retryCounts.size, 0);
        strict_1.default.equal(state.policyDecisions.size, 0);
        strict_1.default.equal(state.pendingGates.size, 0);
        strict_1.default.equal(state.resolvedGates.size, 0);
        strict_1.default.equal(state.verificationStatus.size, 0);
        strict_1.default.equal(state.evidenceRefs.size, 0);
        strict_1.default.equal(state.toolFailures.size, 0);
    });
});
