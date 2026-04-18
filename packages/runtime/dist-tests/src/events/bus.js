"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendEvent = appendEvent;
exports.readEvents = readEvents;
exports.filterByRun = filterByRun;
exports.filterByWorkItem = filterByWorkItem;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function loadOperationalModule() {
    const candidates = [
        path_1.default.resolve(__dirname, '../../../bin/lib/oxe-operational.cjs'),
        path_1.default.resolve(__dirname, '../../../../bin/lib/oxe-operational.cjs'),
        path_1.default.resolve(__dirname, '../../../../../bin/lib/oxe-operational.cjs'),
    ];
    for (const candidate of candidates) {
        if (!fs_1.default.existsSync(candidate))
            continue;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(candidate);
    }
    throw new Error(`Unable to locate oxe-operational.cjs from ${__dirname}`);
}
const operational = loadOperationalModule();
function fromOperationalEvent(raw) {
    return {
        id: String(raw.event_id || ''),
        type: String(raw.type || 'RunStarted'),
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
function appendEvent(projectRoot, sessionId, input, causationId) {
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
function readEvents(projectRoot, sessionId) {
    return operational.readEvents(projectRoot, sessionId).map(fromOperationalEvent);
}
function filterByRun(events, runId) {
    return events.filter((e) => e.run_id === runId);
}
function filterByWorkItem(events, workItemId) {
    return events.filter((e) => e.work_item_id === workItemId);
}
