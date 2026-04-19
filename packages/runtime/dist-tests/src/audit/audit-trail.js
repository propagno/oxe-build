"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditTrail = void 0;
exports.createQuota = createQuota;
exports.checkQuota = checkQuota;
exports.consumeQuota = consumeQuota;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ACTION_SEVERITY = {
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
class AuditTrail {
    constructor(projectRoot, remoteSink) {
        this.projectRoot = projectRoot;
        this.remoteSink = remoteSink;
    }
    record(action, actor, options = {}) {
        const entry = {
            audit_id: `aud-${crypto_1.default.randomBytes(4).toString('hex')}`,
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
    query(filter = {}) {
        return this.load().filter((e) => {
            if (filter.action && e.action !== filter.action)
                return false;
            if (filter.severity && e.severity !== filter.severity)
                return false;
            if (filter.runId && e.run_id !== filter.runId)
                return false;
            if (filter.since && e.timestamp < filter.since)
                return false;
            return true;
        });
    }
    critical() {
        return this.query({ severity: 'critical' });
    }
    metrics() {
        const entries = this.load();
        const by_action = {};
        const actorSet = new Set();
        let oldest = null;
        let newest = null;
        let critical_count = 0;
        let warn_count = 0;
        for (const e of entries) {
            by_action[e.action] = (by_action[e.action] ?? 0) + 1;
            actorSet.add(e.actor);
            if (e.severity === 'critical')
                critical_count++;
            if (e.severity === 'warn')
                warn_count++;
            if (!oldest || e.timestamp < oldest)
                oldest = e.timestamp;
            if (!newest || e.timestamp > newest)
                newest = e.timestamp;
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
    append(entry) {
        const p = this.trailPath();
        fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
        fs_1.default.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
        // Fire-and-forget remote sink (failures are non-fatal)
        if (this.remoteSink) {
            this.remoteSink.write(entry).catch(() => { });
        }
    }
    load() {
        const p = this.trailPath();
        if (!fs_1.default.existsSync(p))
            return [];
        try {
            return fs_1.default
                .readFileSync(p, 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        }
        catch {
            return [];
        }
    }
    trailPath() {
        return path_1.default.join(this.projectRoot, '.oxe', 'AUDIT-TRAIL.ndjson');
    }
}
exports.AuditTrail = AuditTrail;
// ─── RunQuota ─────────────────────────────────────────────────────────────────
function createQuota(runId, limits = {}) {
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
function checkQuota(quota) {
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
function consumeQuota(quota, type, amount = 1) {
    switch (type) {
        case 'work_items': return { ...quota, consumed_work_items: quota.consumed_work_items + amount };
        case 'mutations': return { ...quota, consumed_mutations: quota.consumed_mutations + amount };
        case 'retries': return { ...quota, consumed_retries: quota.consumed_retries + amount };
    }
}
