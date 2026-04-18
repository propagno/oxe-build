import type { EventType } from './catalog';
export interface OxeEvent {
    id: string;
    type: EventType;
    timestamp: string;
    session_id: string | null;
    run_id: string | null;
    work_item_id: string | null;
    attempt_id: string | null;
    causation_id: string | null;
    correlation_id: string | null;
    payload: Record<string, unknown>;
}
