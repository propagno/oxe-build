"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyRunState = createEmptyRunState;
exports.reduce = reduce;
exports.applyEventExported = applyEvent;
exports.getWorkItemStatus = getWorkItemStatus;
exports.getAttemptCount = getAttemptCount;
function createEmptyRunState() {
    return {
        run: null,
        workItems: new Map(),
        attempts: new Map(),
        workspaces: new Map(),
        completedWorkItems: new Set(),
        failedWorkItems: new Set(),
        blockedWorkItems: new Set(),
    };
}
function reduce(events) {
    return events.reduce(applyEvent, createEmptyRunState());
}
function applyEvent(state, event) {
    switch (event.type) {
        case 'RunStarted': {
            const run = event.payload;
            return { ...state, run };
        }
        case 'RunCompleted': {
            if (!state.run)
                return state;
            const status = event.payload.status ?? 'completed';
            return {
                ...state,
                run: { ...state.run, status, ended_at: event.timestamp },
            };
        }
        case 'WorkItemReady': {
            if (!event.work_item_id)
                return state;
            const workItems = new Map(state.workItems);
            const existing = workItems.get(event.work_item_id);
            if (existing) {
                workItems.set(event.work_item_id, { ...existing, status: 'ready' });
            }
            else {
                // First time we see this work item — create from payload
                const item = event.payload;
                workItems.set(event.work_item_id, { ...item, work_item_id: event.work_item_id, status: 'ready' });
            }
            return { ...state, workItems };
        }
        case 'AttemptStarted': {
            if (!event.work_item_id || !event.attempt_id)
                return state;
            const attempts = new Map(state.attempts);
            const attempt = {
                attempt_id: event.attempt_id,
                work_item_id: event.work_item_id,
                attempt_number: event.payload.attempt_number ?? 1,
                workspace_id: null,
                agent_profile: null,
                model: null,
                started_at: event.timestamp,
                ended_at: null,
                outcome: null,
            };
            const existing = attempts.get(event.work_item_id) ?? [];
            attempts.set(event.work_item_id, [...existing, attempt]);
            return { ...state, attempts };
        }
        case 'WorkspaceAllocated': {
            const ws = event.payload;
            if (!ws.workspace_id)
                return state;
            const workspaces = new Map(state.workspaces);
            workspaces.set(ws.workspace_id, { ...ws, status: 'ready' });
            return { ...state, workspaces };
        }
        case 'WorkItemCompleted': {
            if (!event.work_item_id)
                return state;
            const workItems = new Map(state.workItems);
            const item = workItems.get(event.work_item_id);
            if (item)
                workItems.set(event.work_item_id, { ...item, status: 'completed' });
            const completedWorkItems = new Set(state.completedWorkItems);
            completedWorkItems.add(event.work_item_id);
            return { ...state, workItems, completedWorkItems };
        }
        case 'WorkItemBlocked': {
            if (!event.work_item_id)
                return state;
            const workItems = new Map(state.workItems);
            const item = workItems.get(event.work_item_id);
            if (item)
                workItems.set(event.work_item_id, { ...item, status: 'blocked' });
            const blockedWorkItems = new Set(state.blockedWorkItems);
            blockedWorkItems.add(event.work_item_id);
            return { ...state, workItems, blockedWorkItems };
        }
        default:
            return state;
    }
}
function getWorkItemStatus(state, workItemId) {
    return state.workItems.get(workItemId)?.status ?? null;
}
function getAttemptCount(state, workItemId) {
    return state.attempts.get(workItemId)?.length ?? 0;
}
