"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const run_journal_1 = require("../src/scheduler/run-journal");
// OXB-010: depois do OOM da F1 do OxeVoice, `recover` via `Journal: running` e não reconciliava. 1.20c: lease.
(0, node_test_1.describe)('lease do journal', () => {
    (0, node_test_1.test)('saveJournal carimba dono e heartbeat quando running', () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-lease-'));
        try {
            (0, run_journal_1.saveJournal)(dir, 'r1', (0, run_journal_1.createJournal)('r1'));
            const j = (0, run_journal_1.loadJournal)(dir, 'r1');
            strict_1.default.equal(j.owner_pid, process.pid);
            strict_1.default.ok(j.heartbeat_at);
            strict_1.default.equal((0, run_journal_1.isJournalStale)(j), false, 'dono vivo (este processo) não é stale');
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('dono morto, sem dono (journal antigo) ou heartbeat velho = stale; outros estados nunca', () => {
        const base = { ...(0, run_journal_1.createJournal)('r'), owner_pid: 999999, heartbeat_at: new Date().toISOString() };
        strict_1.default.equal((0, run_journal_1.isJournalStale)(base, { isAlive: () => false }), true);
        strict_1.default.equal((0, run_journal_1.isJournalStale)({ ...base, owner_pid: null }), true);
        const old = { ...base, heartbeat_at: new Date(Date.now() - 7 * 3600000).toISOString() };
        strict_1.default.equal((0, run_journal_1.isJournalStale)(old, { isAlive: () => true }), true);
        strict_1.default.equal((0, run_journal_1.isJournalStale)({ ...base, heartbeat_at: new Date().toISOString() }, { isAlive: () => true }), false);
        strict_1.default.equal((0, run_journal_1.isJournalStale)({ ...base, scheduler_state: 'paused' }, { isAlive: () => false }), false);
    });
    (0, node_test_1.test)('markInterrupted preserva o progresso e libera o dono', () => {
        const j = { ...(0, run_journal_1.createJournal)('r'), completed_work_items: ['T1', 'T2'], owner_pid: 123 };
        const m = (0, run_journal_1.markInterrupted)(j);
        strict_1.default.equal(m.scheduler_state, 'interrupted');
        strict_1.default.deepEqual(m.completed_work_items, ['T1', 'T2']);
        strict_1.default.equal(m.owner_pid, null);
        strict_1.default.ok(m.interrupted_at);
    });
    (0, node_test_1.test)('isProcessAlive', () => {
        strict_1.default.equal((0, run_journal_1.isProcessAlive)(process.pid), true);
        strict_1.default.equal((0, run_journal_1.isProcessAlive)(0), false);
        strict_1.default.equal((0, run_journal_1.isProcessAlive)(2147483000), false);
    });
});
