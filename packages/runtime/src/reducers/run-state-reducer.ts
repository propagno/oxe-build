import type { OxeEvent } from '../events/envelope';
import type { Run } from '../models/run';
import type { WorkItem } from '../models/work-item';
import type { Attempt } from '../models/attempt';
import type { Workspace } from '../models/workspace';

export interface RunState {
  run: Run | null;
  workItems: Map<string, WorkItem>;
  attempts: Map<string, Attempt[]>;
  workspaces: Map<string, Workspace>;
  completedWorkItems: Set<string>;
  failedWorkItems: Set<string>;
  blockedWorkItems: Set<string>;
}

export function createEmptyRunState(): RunState {
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

export function reduce(events: OxeEvent[]): RunState {
  return events.reduce(applyEvent, createEmptyRunState());
}

// Exported alias so debug-reducer can import applyEvent without circular issues
export { applyEvent as applyEventExported };

function applyEvent(state: RunState, event: OxeEvent): RunState {
  switch (event.type) {
    case 'RunStarted': {
      const run = event.payload as unknown as Run;
      return { ...state, run };
    }

    case 'RunCompleted': {
      if (!state.run) return state;
      const status = (event.payload as { status?: Run['status'] }).status ?? 'completed';
      return {
        ...state,
        run: { ...state.run, status, ended_at: event.timestamp },
      };
    }

    case 'WorkItemReady': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const existing = workItems.get(event.work_item_id);
      if (existing) {
        workItems.set(event.work_item_id, { ...existing, status: 'ready' });
      } else {
        // First time we see this work item — create from payload
        const item = event.payload as unknown as WorkItem;
        workItems.set(event.work_item_id, { ...item, work_item_id: event.work_item_id, status: 'ready' });
      }
      return { ...state, workItems };
    }

    case 'AttemptStarted': {
      if (!event.work_item_id || !event.attempt_id) return state;
      const attempts = new Map(state.attempts);
      const attempt: Attempt = {
        attempt_id: event.attempt_id,
        work_item_id: event.work_item_id,
        attempt_number: (event.payload as { attempt_number?: number }).attempt_number ?? 1,
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
      const ws = event.payload as unknown as Workspace;
      if (!ws.workspace_id) return state;
      const workspaces = new Map(state.workspaces);
      workspaces.set(ws.workspace_id, { ...ws, status: 'ready' });
      return { ...state, workspaces };
    }

    case 'WorkItemCompleted': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const item = workItems.get(event.work_item_id);
      if (item) workItems.set(event.work_item_id, { ...item, status: 'completed' });
      const completedWorkItems = new Set(state.completedWorkItems);
      completedWorkItems.add(event.work_item_id);
      return { ...state, workItems, completedWorkItems };
    }

    case 'WorkItemBlocked': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const item = workItems.get(event.work_item_id);
      if (item) workItems.set(event.work_item_id, { ...item, status: 'blocked' });
      const blockedWorkItems = new Set(state.blockedWorkItems);
      blockedWorkItems.add(event.work_item_id);
      return { ...state, workItems, blockedWorkItems };
    }

    default:
      return state;
  }
}

export function getWorkItemStatus(
  state: RunState,
  workItemId: string
): WorkItem['status'] | null {
  return state.workItems.get(workItemId)?.status ?? null;
}

export function getAttemptCount(state: RunState, workItemId: string): number {
  return state.attempts.get(workItemId)?.length ?? 0;
}
