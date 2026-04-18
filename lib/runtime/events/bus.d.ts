import type { OxeEvent } from './envelope';
import type { EventType } from './catalog';
export type EventInput = Partial<Omit<OxeEvent, 'type'>> & {
    type: EventType;
};
export declare function appendEvent(projectRoot: string, sessionId: string | null, input: EventInput, causationId?: string): OxeEvent;
export declare function readEvents(projectRoot: string, sessionId: string | null): OxeEvent[];
export declare function filterByRun(events: OxeEvent[], runId: string): OxeEvent[];
export declare function filterByWorkItem(events: OxeEvent[], workItemId: string): OxeEvent[];
