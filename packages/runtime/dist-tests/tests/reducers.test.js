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
});
