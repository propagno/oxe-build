import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { Evidence, EvidenceType } from '../models/evidence';

export interface EvidenceCollectOptions {
  work_item_id: string;
  run_id: string;
  attempt_number: number;
}

export interface EvidenceContent {
  evidence: Evidence;
  content: Buffer;
}

const EXT_MAP: Record<EvidenceType, string> = {
  diff: 'patch',
  stdout: 'txt',
  stderr: 'txt',
  junit_xml: 'xml',
  coverage: 'json',
  screenshot: 'png',
  trace: 'json',
  log: 'txt',
  security_report: 'json',
  api_output: 'json',
  summary: 'json',
};

export class EvidenceStore {
  constructor(private readonly projectRoot: string) {}

  private evidenceDir(runId: string, workItemId: string, attemptNumber: number): string {
    return path.join(
      this.projectRoot,
      '.oxe',
      'evidence',
      'runs',
      runId,
      workItemId,
      `attempt-${attemptNumber}`
    );
  }

  private indexPath(runId: string, workItemId: string, attemptNumber: number): string {
    return path.join(this.evidenceDir(runId, workItemId, attemptNumber), 'index.json');
  }

  private readIndex(runId: string, workItemId: string, attemptNumber: number): Evidence[] {
    const p = this.indexPath(runId, workItemId, attemptNumber);
    if (!fs.existsSync(p)) return [];
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as Evidence[];
    } catch {
      return [];
    }
  }

  private writeIndex(runId: string, workItemId: string, attemptNumber: number, items: Evidence[]): void {
    fs.writeFileSync(this.indexPath(runId, workItemId, attemptNumber), JSON.stringify(items, null, 2), 'utf8');
  }

  async collect(
    type: EvidenceType,
    content: Buffer | string,
    opts: EvidenceCollectOptions
  ): Promise<Evidence> {
    const { work_item_id, run_id, attempt_number } = opts;
    const dir = this.evidenceDir(run_id, work_item_id, attempt_number);
    fs.mkdirSync(dir, { recursive: true });

    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const checksum = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const ext = EXT_MAP[type] ?? 'bin';

    const existing = this.readIndex(run_id, work_item_id, attempt_number);
    const seq = existing.filter((e) => e.type === type).length + 1;
    const filename = `${type}-${seq}.${ext}`;
    const filePath = path.join(dir, filename);

    fs.writeFileSync(filePath, buf);

    const evidence: Evidence = {
      evidence_id: `ev-${run_id}-${work_item_id}-a${attempt_number}-${type}-${seq}`,
      attempt_id: `${work_item_id}-a${attempt_number}`,
      type,
      path: path.relative(this.projectRoot, filePath),
      checksum,
      created_at: new Date().toISOString(),
    };

    this.writeIndex(run_id, work_item_id, attempt_number, [...existing, evidence]);
    return evidence;
  }

  async list(opts: EvidenceCollectOptions): Promise<Evidence[]> {
    return this.readIndex(opts.run_id, opts.work_item_id, opts.attempt_number);
  }

  async get(evidenceId: string, opts: EvidenceCollectOptions): Promise<EvidenceContent | null> {
    const items = this.readIndex(opts.run_id, opts.work_item_id, opts.attempt_number);
    const ev = items.find((e) => e.evidence_id === evidenceId);
    if (!ev) return null;
    const absPath = path.join(this.projectRoot, ev.path);
    if (!fs.existsSync(absPath)) return null;
    return { evidence: ev, content: fs.readFileSync(absPath) };
  }

  async listByRun(runId: string): Promise<Evidence[]> {
    const runDir = path.join(this.projectRoot, '.oxe', 'evidence', 'runs', runId);
    if (!fs.existsSync(runDir)) return [];
    const all: Evidence[] = [];
    for (const workItem of fs.readdirSync(runDir)) {
      const wiDir = path.join(runDir, workItem);
      for (const attempt of fs.readdirSync(wiDir)) {
        const indexPath = path.join(wiDir, attempt, 'index.json');
        if (fs.existsSync(indexPath)) {
          try {
            const items = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Evidence[];
            all.push(...items);
          } catch {
            // skip corrupt index
          }
        }
      }
    }
    return all;
  }
}
