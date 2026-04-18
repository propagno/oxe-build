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
export declare function createEmptyRunState(): RunState;
export declare function reduce(events: OxeEvent[]): RunState;
export { applyEvent as applyEventExported };
declare function applyEvent(state: RunState, event: OxeEvent): RunState;
export declare function getWorkItemStatus(state: RunState, workItemId: string): WorkItem['status'] | null;
export declare function getAttemptCount(state: RunState, workItemId: string): number;
