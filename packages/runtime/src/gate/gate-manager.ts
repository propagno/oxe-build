import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { appendEvent } from '../events/bus';
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
      requested_at: new Date().toISOString(),
      context: ctx,
      status: 'pending',
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
        description: ctx.description,
        evidence_refs: ctx.evidence_refs,
        risks: ctx.risks,
      },
    });

    return token;
  }

  async resolve(token: GateToken, resolution: GateResolution): Promise<GateToken> {
    const gates = this.readGates();
    const idx = gates.findIndex((g) => g.gate_id === token.gate_id);
    if (idx === -1) throw new Error(`Gate ${token.gate_id} not found`);

    const resolved: GateToken = {
      ...gates[idx],
      status: 'resolved',
      decision: resolution.decision,
      actor: resolution.actor,
      reason: resolution.reason ?? undefined,
      resolved_at: new Date().toISOString(),
    };
    gates[idx] = resolved;
    this.writeGates(gates);

    appendEvent(this.projectRoot, this.sessionId, {
      type: 'GateResolved',
      run_id: this.runId,
      payload: {
        gate_id: token.gate_id,
        scope: token.scope,
        decision: resolution.decision,
        actor: resolution.actor,
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

  listAll(): GateToken[] {
    return this.readGates();
  }

  get(gateId: string): GateToken | null {
    return this.readGates().find((g) => g.gate_id === gateId) ?? null;
  }
}
