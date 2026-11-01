"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveJournal = saveJournal;
exports.loadJournal = loadJournal;
exports.deleteJournal = deleteJournal;
exports.createJournal = createJournal;
exports.isProcessAlive = isProcessAlive;
exports.isJournalStale = isJournalStale;
exports.markInterrupted = markInterrupted;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function journalPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'journal.json');
}
function saveJournal(projectRoot, runId, journal) {
    const p = journalPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    const stamped = journal.scheduler_state === 'running'
        ? { ...journal, owner_pid: process.pid, heartbeat_at: new Date().toISOString() }
        : journal;
    fs_1.default.writeFileSync(p, JSON.stringify(stamped, null, 2), 'utf8');
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
/** Whether a process id is alive on this machine (signal 0 probes without killing). */
function isProcessAlive(pid) {
    if (!pid || !Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM: exists but not ours — still alive.
        return err?.code === 'EPERM';
    }
}
/**
 * A `running` journal whose owner process is gone (killed by OOM, closed terminal) or whose heartbeat is older than
 * `maxAgeMs` is stale: nothing will ever finish it. Journals from before the lease (no owner_pid) count as stale.
 */
function isJournalStale(journal, options = {}) {
    if (journal.scheduler_state !== 'running')
        return false;
    const alive = options.isAlive ?? isProcessAlive;
    if (!journal.owner_pid || !alive(journal.owner_pid))
        return true;
    if (journal.owner_pid === process.pid)
        return false;
    const beat = journal.heartbeat_at ? Date.parse(journal.heartbeat_at) : NaN;
    const age = (options.now ?? Date.now()) - beat;
    return Number.isFinite(age) && age > (options.maxAgeMs ?? 6 * 60 * 60 * 1000);
}
/** Reclaims a stale run: `interrupted` is recoverable and keeps the completed/failed/blocked lists. */
function markInterrupted(journal) {
    return { ...journal, scheduler_state: 'interrupted', interrupted_at: new Date().toISOString(), owner_pid: null };
}
