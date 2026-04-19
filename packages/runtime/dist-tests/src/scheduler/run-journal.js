"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveJournal = saveJournal;
exports.loadJournal = loadJournal;
exports.deleteJournal = deleteJournal;
exports.createJournal = createJournal;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function journalPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'journal.json');
}
function saveJournal(projectRoot, runId, journal) {
    const p = journalPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(journal, null, 2), 'utf8');
}
function loadJournal(projectRoot, runId) {
    const p = journalPath(projectRoot, runId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function deleteJournal(projectRoot, runId) {
    const p = journalPath(projectRoot, runId);
    try {
        fs_1.default.unlinkSync(p);
    }
    catch {
        // ignore if not found
    }
}
function createJournal(runId) {
    return {
        run_id: runId,
        paused_at: null,
        cancelled: false,
        eligible_work_items: [],
        completed_work_items: [],
        failed_work_items: [],
        blocked_work_items: [],
        pending_gates: [],
        replay_cursor: null,
        scheduler_state: 'running',
        partial_result: null,
    };
}
