import type { OxeEvent } from '../events/envelope';
import type { RunState } from './run-state-reducer';
export interface ReplayStep {
    index: number;
    event: OxeEvent;
    state: RunState;
}
export declare function stepReplay(events: OxeEvent[]): Generator<ReplayStep>;
export declare function replayUntil(events: OxeEvent[], predicate: (step: ReplayStep) => boolean): ReplayStep | null;
export declare function replaySlice(events: OxeEvent[], from: number, to: number): ReplayStep[];
