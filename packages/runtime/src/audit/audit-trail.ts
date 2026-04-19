import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

// ─── RemoteAuditSink ─────────────────────────────────────────────────────────

export interface AuditQueryFilter {
  action?: AuditAction;
  severity?: AuditSeverity;
  runId?: string;
  since?: string;
}

export interface RemoteAuditSink {
  write(entry: AuditEntry): Promise<void>;
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;
}

// ─── AuditMetrics ────────────────────────────────────────────────────────────

export interface AuditMetrics {
  total_entries: number;
  critical_count: number;
  warn_count: number;
  by_action: Partial<Record<AuditAction, number>>;
  actors: string[];
  oldest: string | null;
  newest: string | null;
}

export type AuditAction =
  | 'run_started'
  | 'run_completed'
  | 'run_paused'
  | 'run_recovered'
  | 'gate_requested'
  | 'gate_resolved'
  | 'policy_denied'
  | 'plugin_registered'
  | 'plugin_invoked'
  | 'secret_accessed'
  | 'infra_mutation'
  | 'pr_created'
  | 'merge_approved'
  | 'merge_blocked';

export type AuditSeverity = 'info' | 'warn' | 'critical';

export interface AuditEntry {
  audit_id: string;
  action: AuditAction;
  severity: AuditSeverity;
  run_id: string | null;
  work_item_id: string | null;
  actor: string;
  resource: string | null;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface RunQuota {
  run_id: string;
  max_work_items: number;
  max_mutations: number;
  max_retries_total: number;
  consumed_work_items: number;
  consumed_mutations: number;
  consumed_retries: number;
}

export interface QuotaViolation {
  quota_type: 'work_items' | 'mutations' | 'retries';
  limit: number;
  consumed: number;
}

const ACTION_SEVERITY: Record<AuditAction, AuditSeverity> = {
  run_started: 'info',
  run_completed: 'info',
  run_paused: 'info',
  run_recovered: 'warn',
  gate_requested: 'warn',
  gate_resolved: 'info',
  policy_denied: 'warn',
  plugin_registered: 'info',
  plugin_invoked: 'info',
  secret_accessed: 'critical',
  infra_mutation: 'critical',
  pr_created: 'info',
  merge_approved: 'warn',
  merge_blocked: 'warn',
};

export class AuditTrail {
  constructor(
    private readonly projectRoot: string,
    private readonly remoteSink?: RemoteAuditSink
  ) {}

  record(
    action: AuditAction,
    actor: string,
    options: {
      runId?: string;
      workItemId?: string;
      resource?: string;
      detail?: Record<string, unknown>;
    } = {}
  ): AuditEntry {
    const entry: AuditEntry = {
      audit_id: `aud-${crypto.randomBytes(4).toString('hex')}`,
      action,
      severity: ACTION_SEVERITY[action],
      run_id: options.runId ?? null,
      work_item_id: options.workItemId ?? null,
      actor,
      resource: options.resource ?? null,
      detail: options.detail ?? {},
      timestamp: new Date().toISOString(),
    };

    this.append(entry);
    return entry;
  }

  query(filter: {
    action?: AuditAction;
    severity?: AuditSeverity;
    runId?: string;
    since?: string;
  } = {}): AuditEntry[] {
    return this.load().filter((e) => {
      if (filter.action && e.action !== filter.action) return false;
      if (filter.severity && e.severity !== filter.severity) return false;
      if (filter.runId && e.run_id !== filter.runId) return false;
      if (filter.since && e.timestamp < filter.since) return false;
      return true;
    });
  }

  critical(): AuditEntry[] {
    return this.query({ severity: 'critical' });
  }

  metrics(): AuditMetrics {
    const entries = this.load();
    const by_action: Partial<Record<AuditAction, number>> = {};
    const actorSet = new Set<string>();
    let oldest: string | null = null;
    let newest: string | null = null;
    let critical_count = 0;
    let warn_count = 0;

    for (const e of entries) {
      by_action[e.action] = (by_action[e.action] ?? 0) + 1;
      actorSet.add(e.actor);
      if (e.severity === 'critical') critical_count++;
      if (e.severity === 'warn') warn_count++;
      if (!oldest || e.timestamp < oldest) oldest = e.timestamp;
      if (!newest || e.timestamp > newest) newest = e.timestamp;
    }

    return {
      total_entries: entries.length,
      critical_count,
      warn_count,
      by_action,
      actors: [...actorSet],
      oldest,
      newest,
    };
  }

  private append(entry: AuditEntry): void {
    const p = this.trailPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
    // Fire-and-forget remote sink (failures are non-fatal)
    if (this.remoteSink) {
      this.remoteSink.write(entry).catch(() => {});
    }
  }

  private load(): AuditEntry[] {
    const p = this.trailPath();
    if (!fs.existsSync(p)) return [];
    try {
      return fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  private trailPath(): string {
    return path.join(this.projectRoot, '.oxe', 'AUDIT-TRAIL.ndjson');
  }
}

// ─── RunQuota ─────────────────────────────────────────────────────────────────

export function createQuota(
  runId: string,
  limits: Partial<Omit<RunQuota, 'run_id' | 'consumed_work_items' | 'consumed_mutations' | 'consumed_retries'>> = {}
): RunQuota {
  return {
    run_id: runId,
    max_work_items: limits.max_work_items ?? Infinity,
    max_mutations: limits.max_mutations ?? Infinity,
    max_retries_total: limits.max_retries_total ?? Infinity,
    consumed_work_items: 0,
    consumed_mutations: 0,
    consumed_retries: 0,
  };
}

export function checkQuota(quota: RunQuota): QuotaViolation | null {
  if (quota.consumed_work_items > quota.max_work_items) {
    return { quota_type: 'work_items', limit: quota.max_work_items, consumed: quota.consumed_work_items };
  }
  if (quota.consumed_mutations > quota.max_mutations) {
    return { quota_type: 'mutations', limit: quota.max_mutations, consumed: quota.consumed_mutations };
  }
  if (quota.consumed_retries > quota.max_retries_total) {
    return { quota_type: 'retries', limit: quota.max_retries_total, consumed: quota.consumed_retries };
  }
  return null;
}

export function consumeQuota(
  quota: RunQuota,
  type: QuotaViolation['quota_type'],
  amount = 1
): RunQuota {
  switch (type) {
    case 'work_items': return { ...quota, consumed_work_items: quota.consumed_work_items + amount };
    case 'mutations': return { ...quota, consumed_mutations: quota.consumed_mutations + amount };
    case 'retries': return { ...quota, consumed_retries: quota.consumed_retries + amount };
  }
}
