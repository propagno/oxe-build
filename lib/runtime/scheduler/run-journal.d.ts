import type { RunResult } from './scheduler';
export interface RunJournal {
    run_id: string;
    /** OXB-129: stream dispatch — what runs and what waits, with the reason. */
    dispatch?: {
        running: string[];
        waiting: Array<{
            id: string;
            reason: string;
        }>;
    };
    paused_at: string | null;
    cancelled: boolean;
    eligible_work_items: string[];
    completed_work_items: string[];
    failed_work_items: string[];
    blocked_work_items: string[];
    pending_gates: string[];
    replay_cursor: string | null;
    scheduler_state: 'running' | 'paused' | 'cancelled' | 'completed' | 'blocked' | 'failed' | 'aborted' | 'interrupted';
    partial_result: Omit<RunResult, 'status'> | null;
    /** Lease (1.20c): process that owns a `running` journal and when it last wrote it. */
    owner_pid?: number | null;
    heartbeat_at?: string | null;
    /** Set when recover found the owner dead (OOM, kill) and reclaimed the run. */
    interrupted_at?: string | null;
}
export declare function saveJournal(projectRoot: string, runId: string, journal: RunJournal): void;
export declare function loadJournal(projectRoot: string, runId: string): RunJournal | null;
export declare function deleteJournal(projectRoot: string, runId: string): void;
export declare function createJournal(runId: string): RunJournal;
/** Whether a process id is alive on this machine (signal 0 probes without killing). */
export declare function isProcessAlive(pid: number | null | undefined): boolean;
/**
 * A `running` journal whose owner process is gone (killed by OOM, closed terminal) or whose heartbeat is older than
 * `maxAgeMs` is stale: nothing will ever finish it. Journals from before the lease (no owner_pid) count as stale.
 */
export declare function isJournalStale(journal: RunJournal, options?: {
    now?: number;
    maxAgeMs?: number;
    isAlive?: (pid: number | null | undefined) => boolean;
}): boolean;
/** Reclaims a stale run: `interrupted` is recoverable and keeps the completed/failed/blocked lists. */
export declare function markInterrupted(journal: RunJournal): RunJournal;
