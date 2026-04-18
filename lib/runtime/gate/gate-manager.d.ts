import type { GateScope, GateDecisionValue } from '../models/gate-decision';
export interface GateContext {
    work_item_id?: string;
    run_id?: string;
    description: string;
    evidence_refs: string[];
    risks: string[];
}
export interface GateToken {
    gate_id: string;
    scope: GateScope;
    requested_at: string;
    context: GateContext;
    status: 'pending' | 'resolved';
    decision?: GateDecisionValue;
    actor?: string;
    reason?: string;
    resolved_at?: string;
}
export interface GateResolution {
    decision: GateDecisionValue;
    actor: string;
    reason?: string;
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
    listAll(): GateToken[];
    get(gateId: string): GateToken | null;
}
