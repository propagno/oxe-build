import type { RunResult } from './scheduler';
export interface RunJournal {
    run_id: string;
    paused_at: string | null;
    cancelled: boolean;
    eligible_work_items: string[];
    completed_work_items: string[];
    failed_work_items: string[];
    blocked_work_items: string[];
    pending_gates: string[];
    replay_cursor: string | null;
    scheduler_state: 'running' | 'paused' | 'cancelled' | 'completed';
    partial_result: Omit<RunResult, 'status'> | null;
}
export declare function saveJournal(projectRoot: string, runId: string, journal: RunJournal): void;
export declare function loadJournal(projectRoot: string, runId: string): RunJournal | null;
export declare function deleteJournal(projectRoot: string, runId: string): void;
export declare function createJournal(runId: string): RunJournal;
