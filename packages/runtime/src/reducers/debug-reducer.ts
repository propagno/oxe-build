import type { OxeEvent } from '../events/envelope';
import { createEmptyRunState, applyEventExported as applyEvent } from './run-state-reducer';
import type { RunState } from './run-state-reducer';

export interface ReplayStep {
  index: number;
  event: OxeEvent;
  state: RunState;
}

export function* stepReplay(events: OxeEvent[]): Generator<ReplayStep> {
  let state = createEmptyRunState();
  for (let i = 0; i < events.length; i++) {
    state = applyEvent(state, events[i]);
    yield { index: i, event: events[i], state };
  }
}

export function replayUntil(
  events: OxeEvent[],
  predicate: (step: ReplayStep) => boolean
): ReplayStep | null {
  for (const step of stepReplay(events)) {
    if (predicate(step)) return step;
  }
  return null;
}

export function replaySlice(events: OxeEvent[], from: number, to: number): ReplayStep[] {
  const steps: ReplayStep[] = [];
  for (const step of stepReplay(events)) {
    if (step.index >= from && step.index <= to) steps.push(step);
    if (step.index > to) break;
  }
  return steps;
}
