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
  scheduler_state: 'running' | 'paused' | 'cancelled' | 'completed';
  partial_result: Omit<RunResult, 'status'> | null;
}

function journalPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'journal.json');
}

export function saveJournal(projectRoot: string, runId: string, journal: RunJournal): void {
  const p = journalPath(projectRoot, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(journal, null, 2), 'utf8');
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
