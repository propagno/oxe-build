import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { appendEvent } from '../events/bus';
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

function isStaleGate(gate: GateToken, maxAgeHours: number): boolean {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const requested = Date.parse(gate.requested_at);
  return Number.isFinite(requested) && requested <= cutoff;
}

function wasResolvedRecently(gate: GateToken, maxAgeHours: number): boolean {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const resolved = Date.parse(gate.resolved_at || '');
  return Number.isFinite(resolved) && resolved >= cutoff;
}

export class GateManager {
  constructor(
    private readonly projectRoot: string,
    private readonly sessionId: string | null,
    private readonly runId: string
  ) {}

  private gatesPath(): string {
    if (this.sessionId) {
      return path.join(this.projectRoot, '.oxe', this.sessionId, 'execution', 'GATES.json');
    }
    return path.join(this.projectRoot, '.oxe', 'execution', 'GATES.json');
  }

  private readGates(): GateToken[] {
    const p = this.gatesPath();
    if (!fs.existsSync(p)) return [];
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as GateToken[];
    } catch {
      return [];
    }
  }

  private writeGates(gates: GateToken[]): void {
    const p = this.gatesPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(gates, null, 2), 'utf8');
  }

  async request(scope: GateScope, ctx: GateContext): Promise<GateToken> {
    const token: GateToken = {
      gate_id: `gate-${crypto.randomBytes(4).toString('hex')}`,
      scope,
      run_id: ctx.run_id ?? this.runId,
      work_item_id: ctx.work_item_id ?? null,
      action: ctx.action ?? null,
      requested_at: new Date().toISOString(),
      context: ctx,
      status: 'pending',
      resolution_history: [],
    };

    const gates = this.readGates();
    gates.push(token);
    this.writeGates(gates);

    appendEvent(this.projectRoot, this.sessionId, {
      type: 'GateRequested',
      run_id: this.runId,
      work_item_id: ctx.work_item_id ?? null,
      payload: {
        gate_id: token.gate_id,
        scope,
        action: token.action,
        description: ctx.description,
        evidence_refs: ctx.evidence_refs,
        risks: ctx.risks,
        rationale: ctx.rationale ?? null,
        policy_decision_id: ctx.policy_decision_id ?? null,
      },
    });

    return token;
  }

  async resolve(token: GateToken, resolution: GateResolution): Promise<GateToken> {
    const gates = this.readGates();
    const idx = gates.findIndex((g) => g.gate_id === token.gate_id);
    if (idx === -1) throw new Error(`Gate ${token.gate_id} not found`);

    const resolvedAt = new Date().toISOString();
    const resolved: GateToken = {
      ...gates[idx],
      status: 'resolved',
      decision: resolution.decision,
      actor: resolution.actor,
      reason: resolution.reason ?? undefined,
      resolved_at: resolvedAt,
      resolution_history: [
        ...(Array.isArray(gates[idx].resolution_history) ? gates[idx].resolution_history : []),
        {
          decision: resolution.decision,
          actor: resolution.actor,
          reason: resolution.reason ?? undefined,
          resolved_at: resolvedAt,
        },
      ],
    };
    gates[idx] = resolved;
    this.writeGates(gates);

    appendEvent(this.projectRoot, this.sessionId, {
      type: 'GateResolved',
      run_id: this.runId,
      payload: {
        gate_id: token.gate_id,
        scope: token.scope,
        action: token.action,
        decision: resolution.decision,
        actor: resolution.actor,
        reason: resolution.reason ?? null,
      },
    });

    return resolved;
  }

  isPending(scope: GateScope): boolean {
    return this.readGates().some((g) => g.scope === scope && g.status === 'pending');
  }

  listPending(): GateToken[] {
    return this.readGates().filter((g) => g.status === 'pending');
  }

  listResolved(): GateToken[] {
    return this.readGates().filter((g) => g.status === 'resolved');
  }

  listPendingByRun(runId = this.runId): GateToken[] {
    return this.readGates().filter((g) => g.status === 'pending' && g.run_id === runId);
  }

  listPendingForWorkItem(workItemId: string): GateToken[] {
    return this.readGates().filter((g) => g.status === 'pending' && g.work_item_id === workItemId);
  }

  stalePending(maxAgeHours = 24): GateToken[] {
    return this.listPending().filter((gate) => isStaleGate(gate, maxAgeHours));
  }

  listRecentResolved(maxAgeHours = 24): GateToken[] {
    return this.listResolved().filter((gate) => wasResolvedRecently(gate, maxAgeHours));
  }

  listAll(): GateToken[] {
    return this.readGates();
  }

  get(gateId: string): GateToken | null {
    return this.readGates().find((g) => g.gate_id === gateId) ?? null;
  }

  filter(query: GateQuery = {}): GateToken[] {
    const all = this.readGates();
    const sla = query.gate_sla_hours ?? 24;
    return all.filter((gate) => {
      if (query.run_id && gate.run_id !== query.run_id) return false;
      if (query.scope && gate.scope !== query.scope) return false;
      if (query.work_item_id && gate.work_item_id !== query.work_item_id) return false;
      if (query.action && gate.action !== query.action) return false;
      if (query.status && query.status !== 'all') {
        if (query.status === 'stale') {
          if (!(gate.status === 'pending' && isStaleGate(gate, sla))) return false;
        } else if (gate.status !== query.status) {
          return false;
        }
      }
      return true;
    });
  }

  snapshot(maxAgeHours = 24, query: Omit<GateQuery, 'gate_sla_hours'> = {}): GateQueueSnapshot {
    const all = this.filter({ ...query, gate_sla_hours: maxAgeHours });
    const pending = all.filter((gate) => gate.status === 'pending');
    const stale_pending = pending.filter((gate) => isStaleGate(gate, maxAgeHours));
    const resolved_recent = all.filter((gate) => gate.status === 'resolved' && wasResolvedRecently(gate, maxAgeHours));
    const byRun: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    for (const gate of all) {
      const runKey = gate.run_id || 'unscoped';
      const scopeKey = gate.scope || 'unknown';
      byRun[runKey] = (byRun[runKey] || 0) + 1;
      byScope[scopeKey] = (byScope[scopeKey] || 0) + 1;
    }
    return {
      total: all.length,
      gate_sla_hours: maxAgeHours,
      pending,
      stale_pending,
      staleCount: stale_pending.length,
      resolved_recent,
      byRun,
      byScope,
      all,
    };
  }
}

export function listPendingGates(
  manager: GateManager,
  runId?: string,
  query: Omit<GateQuery, 'run_id'> = {}
): GateQueueSnapshot {
  return manager.snapshot(query.gate_sla_hours ?? 24, {
    ...query,
    run_id: runId ?? undefined,
  });
}

export async function resolveGate(
  manager: GateManager,
  gateId: string,
  resolution: GateResolution
): Promise<GateToken> {
  const token = manager.get(gateId);
  if (!token) throw new Error(`Gate ${gateId} not found`);
  return manager.resolve(token, resolution);
}
