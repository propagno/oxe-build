import path from 'path';
import fs from 'fs';
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
  scheduler_state: 'running' | 'paused' | 'cancelled' | 'completed' | 'blocked' | 'failed' | 'aborted' | 'interrupted';
  partial_result: Omit<RunResult, 'status'> | null;
  /** Lease (1.20c): process that owns a `running` journal and when it last wrote it. */
  owner_pid?: number | null;
  heartbeat_at?: string | null;
  /** Set when recover found the owner dead (OOM, kill) and reclaimed the run. */
  interrupted_at?: string | null;
}

function journalPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'journal.json');
}

export function saveJournal(projectRoot: string, runId: string, journal: RunJournal): void {
  const p = journalPath(projectRoot, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamped = journal.scheduler_state === 'running'
    ? { ...journal, owner_pid: process.pid, heartbeat_at: new Date().toISOString() }
    : journal;
  fs.writeFileSync(p, JSON.stringify(stamped, null, 2), 'utf8');
}

export function loadJournal(projectRoot: string, runId: string): RunJournal | null {
  const p = journalPath(projectRoot, runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as RunJournal;
  } catch {
    return null;
  }
}

export function deleteJournal(projectRoot: string, runId: string): void {
  const p = journalPath(projectRoot, runId);
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore if not found
  }
}

export function createJournal(runId: string): RunJournal {
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
export function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but not ours — still alive.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * A `running` journal whose owner process is gone (killed by OOM, closed terminal) or whose heartbeat is older than
 * `maxAgeMs` is stale: nothing will ever finish it. Journals from before the lease (no owner_pid) count as stale.
 */
export function isJournalStale(
  journal: RunJournal,
  options: { now?: number; maxAgeMs?: number; isAlive?: (pid: number | null | undefined) => boolean } = {},
): boolean {
  if (journal.scheduler_state !== 'running') return false;
  const alive = options.isAlive ?? isProcessAlive;
  if (!journal.owner_pid || !alive(journal.owner_pid)) return true;
  if (journal.owner_pid === process.pid) return false;
  const beat = journal.heartbeat_at ? Date.parse(journal.heartbeat_at) : NaN;
  const age = (options.now ?? Date.now()) - beat;
  return Number.isFinite(age) && age > (options.maxAgeMs ?? 6 * 60 * 60 * 1000);
}

/** Reclaims a stale run: `interrupted` is recoverable and keeps the completed/failed/blocked lists. */
export function markInterrupted(journal: RunJournal): RunJournal {
  return { ...journal, scheduler_state: 'interrupted', interrupted_at: new Date().toISOString(), owner_pid: null };
}

