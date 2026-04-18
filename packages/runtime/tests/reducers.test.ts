import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, createEmptyRunState, getWorkItemStatus, getAttemptCount } from '../src/reducers/run-state-reducer';
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
});
