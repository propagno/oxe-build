import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduce,
  createEmptyRunState,
  getWorkItemStatus,
  getAttemptCount,
  getRetryCount,
  getPolicyDecision,
  getVerificationStatus,
  getEvidenceRefs,
  getToolFailures,
} from '../src/reducers/run-state-reducer';
import type { OxeEvent } from '../src/events/envelope';

function makeEvent(overrides: Partial<OxeEvent> & { type: OxeEvent['type'] }): OxeEvent {
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

describe('RunState Reducer', () => {
  test('starts empty', () => {
    const state = createEmptyRunState();
    assert.equal(state.run, null);
    assert.equal(state.workItems.size, 0);
    assert.equal(state.attempts.size, 0);
  });

  test('RunStarted sets run', () => {
    const events = [
      makeEvent({
        type: 'RunStarted',
        payload: { run_id: 'r001', status: 'running', session_id: 's001', graph_version: '1', started_at: new Date().toISOString(), ended_at: null, initiator: 'user', mode: 'por_onda' },
      }),
    ];
    const state = reduce(events);
    assert.ok(state.run !== null);
    assert.equal((state.run as { run_id: string }).run_id, 'r001');
  });

  test('WorkItemReady adds work item with ready status', () => {
    const events = [
      makeEvent({
        type: 'WorkItemReady',
        work_item_id: 'T1',
        payload: { work_item_id: 'T1', title: 'Setup', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' },
      }),
    ];
    const state = reduce(events);
    assert.equal(getWorkItemStatus(state, 'T1'), 'ready');
  });

  test('AttemptStarted tracks attempts per work item', () => {
    const events = [
      makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
      makeEvent({ type: 'AttemptStarted', work_item_id: 'T1', attempt_id: 'T1-a1', payload: { attempt_number: 1 } }),
      makeEvent({ type: 'AttemptStarted', work_item_id: 'T1', attempt_id: 'T1-a2', payload: { attempt_number: 2 } }),
    ];
    const state = reduce(events);
    assert.equal(getAttemptCount(state, 'T1'), 2);
  });

  test('WorkItemCompleted marks item as completed', () => {
    const events = [
      makeEvent({ type: 'WorkItemReady', work_item_id: 'T2', payload: { work_item_id: 'T2', title: 'T2', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
      makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T2', payload: { attempt_number: 1 } }),
    ];
    const state = reduce(events);
    assert.equal(getWorkItemStatus(state, 'T2'), 'completed');
    assert.ok(state.completedWorkItems.has('T2'));
  });

  test('WorkItemBlocked marks item and adds to blocked set', () => {
    const events = [
      makeEvent({ type: 'WorkItemReady', work_item_id: 'T3', payload: { work_item_id: 'T3', title: 'T3', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
      makeEvent({ type: 'WorkItemBlocked', work_item_id: 'T3', payload: { reason: 'dependency_failed' } }),
    ];
    const state = reduce(events);
    assert.equal(getWorkItemStatus(state, 'T3'), 'blocked');
    assert.ok(state.blockedWorkItems.has('T3'));
  });

  test('RunCompleted updates run status and ended_at', () => {
    const now = new Date().toISOString();
    const events = [
      makeEvent({ type: 'RunStarted', payload: { run_id: 'r001', status: 'running', session_id: 's001', graph_version: '1', started_at: now, ended_at: null, initiator: 'user', mode: 'completo' } }),
      makeEvent({ type: 'RunCompleted', payload: { run_id: 'r001', status: 'completed' } }),
    ];
    const state = reduce(events);
    assert.ok(state.run !== null);
    assert.equal((state.run as { status: string }).status, 'completed');
    assert.ok((state.run as { ended_at: string | null }).ended_at !== null);
  });

  test('WorkspaceAllocated tracks workspace', () => {
    const events = [
      makeEvent({
        type: 'WorkspaceAllocated',
        work_item_id: 'T1',
        payload: { workspace_id: 'ws-T1-a1', strategy: 'inplace', root_path: '/tmp/ws', base_commit: null, branch: null, container_ref: null, status: 'ready' },
      }),
    ];
    const state = reduce(events);
    assert.ok(state.workspaces.has('ws-T1-a1'));
    assert.equal(state.workspaces.get('ws-T1-a1')!.strategy, 'inplace');
  });

  test('replay is deterministic', () => {
    const events = [
      makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
      makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: {} }),
    ];
    const s1 = reduce(events);
    const s2 = reduce(events);
    assert.equal(getWorkItemStatus(s1, 'T1'), getWorkItemStatus(s2, 'T1'));
    assert.equal(s1.completedWorkItems.size, s2.completedWorkItems.size);
  });

  test('RetryScheduled increments retry count', () => {
    const events = [
      makeEvent({ type: 'RetryScheduled', work_item_id: 'T1', payload: { next_attempt: 2, reason: 'env' } }),
      makeEvent({ type: 'RetryScheduled', work_item_id: 'T1', payload: { next_attempt: 3, reason: 'env' } }),
    ];
    const state = reduce(events);
    assert.equal(getRetryCount(state, 'T1'), 2);
    assert.equal(getRetryCount(state, 'T2'), 0);
  });

  test('PolicyEvaluated records decision', () => {
    const events = [
      makeEvent({
        type: 'PolicyEvaluated',
        payload: { work_item_id: 'T1', allowed: false, gate_required: false, reason: 'denied by rule r1', rule_id: 'r1' },
      }),
    ];
    const state = reduce(events);
    const decision = getPolicyDecision(state, 'T1');
    assert.ok(decision !== null);
    assert.equal(decision!.allowed, false);
    assert.equal(decision!.rule_id, 'r1');
  });

  test('GateRequested adds to pendingGates', () => {
    const events = [
      makeEvent({ type: 'GateRequested', payload: { gate_id: 'gate-abc', scope: 'deploy', description: 'test' } }),
    ];
    const state = reduce(events);
    assert.ok(state.pendingGates.has('gate-abc'));
    assert.equal(state.resolvedGates.size, 0);
  });

  test('GateResolved moves gate from pending to resolved', () => {
    const events = [
      makeEvent({ type: 'GateRequested', payload: { gate_id: 'gate-abc', scope: 'deploy', description: 'test' } }),
      makeEvent({ type: 'GateResolved', payload: { gate_id: 'gate-abc', decision: 'approved', actor: 'user' } }),
    ];
    const state = reduce(events);
    assert.equal(state.pendingGates.size, 0);
    assert.ok(state.resolvedGates.has('gate-abc'));
    assert.equal(state.resolvedGates.get('gate-abc')!.decision, 'approved');
  });

  test('VerificationStarted and VerificationCompleted track status', () => {
    const events = [
      makeEvent({ type: 'VerificationStarted', work_item_id: 'T1', payload: {} }),
    ];
    const s1 = reduce(events);
    assert.equal(getVerificationStatus(s1, 'T1'), 'started');

    const events2 = [
      ...events,
      makeEvent({ type: 'VerificationCompleted', work_item_id: 'T1', payload: { status: 'completed' } }),
    ];
    const s2 = reduce(events2);
    assert.equal(getVerificationStatus(s2, 'T1'), 'completed');
  });

  test('VerificationCompleted with failed status', () => {
    const events = [
      makeEvent({ type: 'VerificationStarted', work_item_id: 'T1', payload: {} }),
      makeEvent({ type: 'VerificationCompleted', work_item_id: 'T1', payload: { status: 'failed' } }),
    ];
    const state = reduce(events);
    assert.equal(getVerificationStatus(state, 'T1'), 'failed');
  });

  test('ToolFailed appends failure record', () => {
    const events = [
      makeEvent({ type: 'ToolFailed', work_item_id: 'T1', payload: { tool: 'npm_test', error: 'exit 1' } }),
      makeEvent({ type: 'ToolFailed', work_item_id: 'T1', payload: { tool: 'eslint', error: 'lint error' } }),
    ];
    const state = reduce(events);
    const failures = getToolFailures(state, 'T1');
    assert.equal(failures.length, 2);
    assert.equal(failures[0].tool, 'npm_test');
    assert.equal(failures[1].tool, 'eslint');
  });

  test('EvidenceCollected accumulates refs', () => {
    const events = [
      makeEvent({ type: 'EvidenceCollected', work_item_id: 'T1', payload: { refs: ['ev-1', 'ev-2'] } }),
      makeEvent({ type: 'EvidenceCollected', work_item_id: 'T1', payload: { ref: 'ev-3' } }),
    ];
    const state = reduce(events);
    const refs = getEvidenceRefs(state, 'T1');
    assert.equal(refs.length, 3);
    assert.ok(refs.includes('ev-1'));
    assert.ok(refs.includes('ev-3'));
  });

  test('WorkItemCompleted with evidence adds to evidenceRefs', () => {
    const events = [
      makeEvent({ type: 'WorkItemReady', work_item_id: 'T1', payload: { work_item_id: 'T1', title: 'T1', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: [], status: 'pending', workspace_strategy: 'inplace', run_id: 'r001' } }),
      makeEvent({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: { attempt_number: 1, evidence: ['ev-a', 'ev-b'] } }),
    ];
    const state = reduce(events);
    assert.ok(state.completedWorkItems.has('T1'));
    const refs = getEvidenceRefs(state, 'T1');
    assert.ok(refs.includes('ev-a'));
    assert.ok(refs.includes('ev-b'));
  });

  test('createEmptyRunState initializes all Phase 1 fields', () => {
    const state = createEmptyRunState();
    assert.equal(state.retryCounts.size, 0);
    assert.equal(state.policyDecisions.size, 0);
    assert.equal(state.pendingGates.size, 0);
    assert.equal(state.resolvedGates.size, 0);
    assert.equal(state.verificationStatus.size, 0);
    assert.equal(state.evidenceRefs.size, 0);
    assert.equal(state.toolFailures.size, 0);
  });
});
