import type { GateScope, GateDecisionValue } from '../models/gate-decision';
export interface GateContext {
    work_item_id?: string;
    run_id?: string;
    action?: string;
    description: string;
    evidence_refs: string[];
    risks: string[];
    rationale?: string;
    policy_decision_id?: string | null;
}
export interface GateResolutionRecord {
    decision: GateDecisionValue;
    actor: string;
    reason?: string;
    resolved_at: string;
}
export interface GateToken {
    gate_id: string;
    scope: GateScope;
    run_id: string | null;
    work_item_id: string | null;
    action: string | null;
    requested_at: string;
    context: GateContext;
    status: 'pending' | 'resolved';
    decision?: GateDecisionValue;
    actor?: string;
    reason?: string;
    resolved_at?: string;
    resolution_history?: GateResolutionRecord[];
}
export interface GateResolution {
    decision: GateDecisionValue;
    actor: string;
    reason?: string;
}
export interface GateQuery {
    run_id?: string | null;
    status?: 'pending' | 'stale' | 'resolved' | 'all';
    scope?: GateScope;
    work_item_id?: string | null;
    action?: string | null;
    gate_sla_hours?: number;
}
export interface GateQueueSnapshot {
    total: number;
    gate_sla_hours: number;
    pending: GateToken[];
    stale_pending: GateToken[];
    staleCount: number;
    resolved_recent: GateToken[];
    byRun: Record<string, number>;
    byScope: Record<string, number>;
    all: GateToken[];
}
export declare class GateManager {
    private readonly projectRoot;
    private readonly sessionId;
    private readonly runId;
    constructor(projectRoot: string, sessionId: string | null, runId: string);
    private gatesPath;
    private readGates;
    private writeGates;
    request(scope: GateScope, ctx: GateContext): Promise<GateToken>;
    resolve(token: GateToken, resolution: GateResolution): Promise<GateToken>;
    isPending(scope: GateScope): boolean;
    listPending(): GateToken[];
    listResolved(): GateToken[];
    listPendingByRun(runId?: string): GateToken[];
    listPendingForWorkItem(workItemId: string): GateToken[];
    stalePending(maxAgeHours?: number): GateToken[];
    listRecentResolved(maxAgeHours?: number): GateToken[];
    listAll(): GateToken[];
    get(gateId: string): GateToken | null;
    filter(query?: GateQuery): GateToken[];
    snapshot(maxAgeHours?: number, query?: Omit<GateQuery, 'gate_sla_hours'>): GateQueueSnapshot;
}
export declare function listPendingGates(manager: GateManager, runId?: string, query?: Omit<GateQuery, 'run_id'>): GateQueueSnapshot;
export declare function resolveGate(manager: GateManager, gateId: string, resolution: GateResolution): Promise<GateToken>;
