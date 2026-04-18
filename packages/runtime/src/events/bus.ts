import type { OxeEvent } from './envelope';
import type { EventType } from './catalog';
import path from 'path';
import fs from 'fs';

export type EventInput = Partial<Omit<OxeEvent, 'type'>> & { type: EventType };

interface OperationalEvent {
  event_id?: string;
  type?: string;
  timestamp?: string;
  session_id?: string | null;
  run_id?: string | null;
  task_id?: string | null;
  work_item_id?: string | null;
  attempt_id?: string | null;
  causation_id?: string | null;
  correlation_id?: string | null;
  payload?: Record<string, unknown>;
}

function loadOperationalModule(): {
  appendEvent: (projectRoot: string, sessionId: string | null, event: Record<string, unknown>) => OperationalEvent;
  readEvents: (projectRoot: string, sessionId: string | null) => OperationalEvent[];
} {
  const candidates = [
    path.resolve(__dirname, '../../../bin/lib/oxe-operational.cjs'),
    path.resolve(__dirname, '../../../../bin/lib/oxe-operational.cjs'),
    path.resolve(__dirname, '../../../../../bin/lib/oxe-operational.cjs'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(candidate) as {
      appendEvent: (projectRoot: string, sessionId: string | null, event: Record<string, unknown>) => OperationalEvent;
      readEvents: (projectRoot: string, sessionId: string | null) => OperationalEvent[];
    };
  }
  throw new Error(`Unable to locate oxe-operational.cjs from ${__dirname}`);
}

const operational = loadOperationalModule();

function fromOperationalEvent(raw: OperationalEvent): OxeEvent {
  return {
    id: String(raw.event_id || ''),
    type: String(raw.type || 'RunStarted') as EventType,
    timestamp: String(raw.timestamp || new Date().toISOString()),
    session_id: raw.session_id ?? null,
    run_id: raw.run_id ?? null,
    work_item_id: raw.work_item_id ?? raw.task_id ?? null,
    attempt_id: raw.attempt_id ?? null,
    causation_id: raw.causation_id ?? null,
    correlation_id: raw.correlation_id ?? null,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
  };
}

export function appendEvent(
  projectRoot: string,
  sessionId: string | null,
  input: EventInput,
  causationId?: string
): OxeEvent {
  const event = operational.appendEvent(projectRoot, sessionId, {
    event_id: input.id,
    type: input.type,
    timestamp: input.timestamp,
    run_id: input.run_id ?? null,
    work_item_id: input.work_item_id ?? null,
    attempt_id: input.attempt_id ?? null,
    causation_id: input.causation_id ?? causationId ?? null,
    correlation_id: input.correlation_id ?? null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  });
  return fromOperationalEvent(event);
}

export function readEvents(
  projectRoot: string,
  sessionId: string | null
): OxeEvent[] {
  return operational.readEvents(projectRoot, sessionId).map(fromOperationalEvent);
}

export function filterByRun(events: OxeEvent[], runId: string): OxeEvent[] {
  return events.filter((e) => e.run_id === runId);
}

export function filterByWorkItem(events: OxeEvent[], workItemId: string): OxeEvent[] {
  return events.filter((e) => e.work_item_id === workItemId);
}
