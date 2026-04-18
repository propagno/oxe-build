"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GateManager = void 0;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bus_1 = require("../events/bus");
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
            requested_at: new Date().toISOString(),
            context: ctx,
            status: 'pending',
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
                description: ctx.description,
                evidence_refs: ctx.evidence_refs,
                risks: ctx.risks,
            },
        });
        return token;
    }
    async resolve(token, resolution) {
        const gates = this.readGates();
        const idx = gates.findIndex((g) => g.gate_id === token.gate_id);
        if (idx === -1)
            throw new Error(`Gate ${token.gate_id} not found`);
        const resolved = {
            ...gates[idx],
            status: 'resolved',
            decision: resolution.decision,
            actor: resolution.actor,
            reason: resolution.reason ?? undefined,
            resolved_at: new Date().toISOString(),
        };
        gates[idx] = resolved;
        this.writeGates(gates);
        (0, bus_1.appendEvent)(this.projectRoot, this.sessionId, {
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
    isPending(scope) {
        return this.readGates().some((g) => g.scope === scope && g.status === 'pending');
    }
    listPending() {
        return this.readGates().filter((g) => g.status === 'pending');
    }
    listAll() {
        return this.readGates();
    }
    get(gateId) {
        return this.readGates().find((g) => g.gate_id === gateId) ?? null;
    }
}
exports.GateManager = GateManager;
