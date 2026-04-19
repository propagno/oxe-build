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
export interface AuditMetrics {
    total_entries: number;
    critical_count: number;
    warn_count: number;
    by_action: Partial<Record<AuditAction, number>>;
    actors: string[];
    oldest: string | null;
    newest: string | null;
}
export type AuditAction = 'run_started' | 'run_completed' | 'run_paused' | 'run_recovered' | 'gate_requested' | 'gate_resolved' | 'policy_denied' | 'plugin_registered' | 'plugin_invoked' | 'secret_accessed' | 'infra_mutation' | 'pr_created' | 'merge_approved' | 'merge_blocked';
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
export declare class AuditTrail {
    private readonly projectRoot;
    private readonly remoteSink?;
    constructor(projectRoot: string, remoteSink?: RemoteAuditSink | undefined);
    record(action: AuditAction, actor: string, options?: {
        runId?: string;
        workItemId?: string;
        resource?: string;
        detail?: Record<string, unknown>;
    }): AuditEntry;
    query(filter?: {
        action?: AuditAction;
        severity?: AuditSeverity;
        runId?: string;
        since?: string;
    }): AuditEntry[];
    critical(): AuditEntry[];
    metrics(): AuditMetrics;
    private append;
    private load;
    private trailPath;
}
export declare function createQuota(runId: string, limits?: Partial<Omit<RunQuota, 'run_id' | 'consumed_work_items' | 'consumed_mutations' | 'consumed_retries'>>): RunQuota;
export declare function checkQuota(quota: RunQuota): QuotaViolation | null;
export declare function consumeQuota(quota: RunQuota, type: QuotaViolation['quota_type'], amount?: number): RunQuota;
