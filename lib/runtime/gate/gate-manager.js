"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GateManager = void 0;
exports.listPendingGates = listPendingGates;
exports.resolveGate = resolveGate;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bus_1 = require("../events/bus");
function isStaleGate(gate, maxAgeHours) {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const requested = Date.parse(gate.requested_at);
    return Number.isFinite(requested) && requested <= cutoff;
}
function wasResolvedRecently(gate, maxAgeHours) {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const resolved = Date.parse(gate.resolved_at || '');
    return Number.isFinite(resolved) && resolved >= cutoff;
}
class GateManager {
    constructor(projectRoot, sessionId, runId) {
        this.projectRoot = projectRoot;
        this.sessionId = sessionId;
        this.runId = runId;
    }
    gatesPath() {
        if (this.sessionId) {
            return path_1.default.join(this.projectRoot, '.oxe', this.sessionId, 'execution', 'GATES.json');
        }
        return path_1.default.join(this.projectRoot, '.oxe', 'execution', 'GATES.json');
    }
    readGates() {
        const p = this.gatesPath();
        if (!fs_1.default.existsSync(p))
            return [];
        try {
            return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
        }
        catch {
            return [];
        }
    }
    writeGates(gates) {
        const p = this.gatesPath();
        fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
        fs_1.default.writeFileSync(p, JSON.stringify(gates, null, 2), 'utf8');
    }
    async request(scope, ctx) {
        const token = {
            gate_id: `gate-${crypto_1.default.randomBytes(4).toString('hex')}`,
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
        (0, bus_1.appendEvent)(this.projectRoot, this.sessionId, {
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
    async resolve(token, resolution) {
        const gates = this.readGates();
        const idx = gates.findIndex((g) => g.gate_id === token.gate_id);
        if (idx === -1)
            throw new Error(`Gate ${token.gate_id} not found`);
        const resolvedAt = new Date().toISOString();
        const resolved = {
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
        (0, bus_1.appendEvent)(this.projectRoot, this.sessionId, {
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
    isPending(scope) {
        return this.readGates().some((g) => g.scope === scope && g.status === 'pending');
    }
    listPending() {
        return this.readGates().filter((g) => g.status === 'pending');
    }
    listResolved() {
        return this.readGates().filter((g) => g.status === 'resolved');
    }
    listPendingByRun(runId = this.runId) {
        return this.readGates().filter((g) => g.status === 'pending' && g.run_id === runId);
    }
    listPendingForWorkItem(workItemId) {
        return this.readGates().filter((g) => g.status === 'pending' && g.work_item_id === workItemId);
    }
    stalePending(maxAgeHours = 24) {
        return this.listPending().filter((gate) => isStaleGate(gate, maxAgeHours));
    }
    listRecentResolved(maxAgeHours = 24) {
        return this.listResolved().filter((gate) => wasResolvedRecently(gate, maxAgeHours));
    }
    listAll() {
        return this.readGates();
    }
    get(gateId) {
        return this.readGates().find((g) => g.gate_id === gateId) ?? null;
    }
    filter(query = {}) {
        const all = this.readGates();
        const sla = query.gate_sla_hours ?? 24;
        return all.filter((gate) => {
            if (query.run_id && gate.run_id !== query.run_id)
                return false;
            if (query.scope && gate.scope !== query.scope)
                return false;
            if (query.work_item_id && gate.work_item_id !== query.work_item_id)
                return false;
            if (query.action && gate.action !== query.action)
                return false;
            if (query.status && query.status !== 'all') {
                if (query.status === 'stale') {
                    if (!(gate.status === 'pending' && isStaleGate(gate, sla)))
                        return false;
                }
                else if (gate.status !== query.status) {
                    return false;
                }
            }
            return true;
        });
    }
    snapshot(maxAgeHours = 24, query = {}) {
        const all = this.filter({ ...query, gate_sla_hours: maxAgeHours });
        const pending = all.filter((gate) => gate.status === 'pending');
        const stale_pending = pending.filter((gate) => isStaleGate(gate, maxAgeHours));
        const resolved_recent = all.filter((gate) => gate.status === 'resolved' && wasResolvedRecently(gate, maxAgeHours));
        const byRun = {};
        const byScope = {};
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
exports.GateManager = GateManager;
function listPendingGates(manager, runId, query = {}) {
    return manager.snapshot(query.gate_sla_hours ?? 24, {
        ...query,
        run_id: runId ?? undefined,
    });
}
async function resolveGate(manager, gateId, resolution) {
    const token = manager.get(gateId);
    if (!token)
        throw new Error(`Gate ${gateId} not found`);
    return manager.resolve(token, resolution);
}
