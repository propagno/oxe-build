"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stepReplay = stepReplay;
exports.replayUntil = replayUntil;
exports.replaySlice = replaySlice;
const run_state_reducer_1 = require("./run-state-reducer");
function* stepReplay(events) {
    let state = (0, run_state_reducer_1.createEmptyRunState)();
    for (let i = 0; i < events.length; i++) {
        state = (0, run_state_reducer_1.applyEventExported)(state, events[i]);
        yield { index: i, event: events[i], state };
    }
}
function replayUntil(events, predicate) {
    for (const step of stepReplay(events)) {
        if (predicate(step))
            return step;
    }
    return null;
}
function replaySlice(events, from, to) {
    const steps = [];
    for (const step of stepReplay(events)) {
        if (step.index >= from && step.index <= to)
            steps.push(step);
        if (step.index > to)
            break;
    }
    return steps;
}
