import fs from 'fs';
import path from 'path';

export type PromotionTarget = 'local_commit' | 'remote_promotion';
export type PromotionRemoteTarget = 'pr_draft' | 'branch_push';

export interface CommitRecord {
  run_id: string;
  branch: string;
  commit_sha: string | null;
  status: 'pending' | 'committed' | 'blocked';
  created_at: string;
  committed_at: string | null;
  message: string | null;
  summary_path: string | null;
}

export interface PromotionRecord {
  run_id: string;
  target: PromotionTarget;
  target_kind: PromotionRemoteTarget;
  branch: string;
  status: 'pending' | 'open' | 'merged' | 'closed' | 'blocked' | 'promoted';
  created_at: string;
  promoted_at: string | null;
  summary_path: string | null;
  remote: string | null;
  target_ref: string | null;
  pr_url: string | null;
  pr_number: number | null;
  reasons?: string[];
  coverage_percent?: number | null;
}

function runDir(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId);
}

function saveJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function loadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function commitRecordPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), 'commit-record.json');
}

export function promotionRecordPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), 'promotion-record.json');
}

export function saveCommitRecord(projectRoot: string, runId: string, record: CommitRecord): void {
  saveJson(commitRecordPath(projectRoot, runId), record);
}

export function loadCommitRecord(projectRoot: string, runId: string): CommitRecord | null {
  return loadJson<CommitRecord>(commitRecordPath(projectRoot, runId));
}

export function savePromotionRecord(projectRoot: string, runId: string, record: PromotionRecord): void {
  saveJson(promotionRecordPath(projectRoot, runId), record);
}

export function loadPromotionRecord(projectRoot: string, runId: string): PromotionRecord | null {
  return loadJson<PromotionRecord>(promotionRecordPath(projectRoot, runId));
}
