"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategySelector = void 0;
exports.buildBlastRadius = buildBlastRadius;
exports.buildRollbackPlan = buildRollbackPlan;
exports.buildMemo = buildMemo;
exports.saveMemo = saveMemo;
exports.loadMemo = loadMemo;
exports.listMemos = listMemos;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// ─── BlastRadius estimation ───────────────────────────────────────────────────
function deriveSubsystems(mutationScope) {
    const seen = new Set();
    for (const p of mutationScope) {
        const parts = p.replace(/\\/g, '/').split('/');
        if (parts.length >= 2)
            seen.add(parts[0]);
        else
            seen.add(p);
    }
    return [...seen];
}
function estimateRiskScore(mutationScope, retryCount, riskLevel) {
    let score = 0;
    score += Math.min(0.4, mutationScope.length * 0.05);
    score += retryCount > 0 ? Math.min(0.2, retryCount * 0.05) : 0;
    switch (riskLevel) {
        case 'critical':
            score += 0.4;
            break;
        case 'high':
            score += 0.3;
            break;
        case 'medium':
            score += 0.15;
            break;
        case 'low':
            score += 0.05;
            break;
        default: break;
    }
    return Math.min(1, score);
}
function buildBlastRadius(mutationScope, retryCount, riskLevel) {
    const risk_score = estimateRiskScore(mutationScope, retryCount, riskLevel);
    return {
        estimated_files: mutationScope.length,
        subsystems: deriveSubsystems(mutationScope),
        risk_score: Math.round(risk_score * 100) / 100,
        reversible: riskLevel !== 'critical' && mutationScope.length <= 10,
    };
}
// ─── RollbackPlan ─────────────────────────────────────────────────────────────
function buildRollbackPlan(blastRadius, retryCount) {
    if (blastRadius.risk_score >= 0.7 || !blastRadius.reversible) {
        return {
            strategy: 'restore_workspace',
            steps: ['snapshot workspace before mutation', 'restore snapshot on failure', 'verify clean state'],
            estimated_cost: 'high',
            preconditions: ['workspace snapshot available', 'no shared-state mutations'],
        };
    }
    if (retryCount > 1 || blastRadius.estimated_files > 5) {
        return {
            strategy: 'revert_commit',
            steps: ['record commit SHA before change', 'git revert on failure'],
            estimated_cost: 'medium',
            preconditions: ['git repo initialized', 'changes committed atomically'],
        };
    }
    return {
        strategy: 'undo_patch',
        steps: ['apply inverse patch'],
        estimated_cost: 'low',
        preconditions: ['original file state recorded'],
    };
}
// ─── StrategySelector ────────────────────────────────────────────────────────
class StrategySelector {
    select(mutationScope, retryCount, riskLevel) {
        if (riskLevel === 'critical')
            return 'feature_flag';
        if (retryCount > 1)
            return 'minimal_patch';
        if (mutationScope.length > 8)
            return 'isolated_refactor';
        if (riskLevel === 'high')
            return 'feature_flag';
        if (mutationScope.length > 3)
            return 'expand_contract';
        if (mutationScope.length === 0)
            return 'no_op';
        return 'minimal_patch';
    }
    alternatives(chosen, mutationScope, riskLevel) {
        const all = ['minimal_patch', 'isolated_refactor', 'expand_contract', 'feature_flag', 'no_op'];
        return all
            .filter((s) => s !== chosen)
            .map((s) => ({ strategy: s, reason: this.rejectionReason(s, chosen, mutationScope, riskLevel) }));
    }
    rejectionReason(s, chosen, mutationScope, riskLevel) {
        switch (s) {
            case 'no_op': return 'mutation scope is non-empty; no-op would not satisfy requirements';
            case 'feature_flag': return riskLevel !== 'critical' && riskLevel !== 'high' ? 'risk level does not warrant feature flag overhead' : `${chosen} preferred for scope size`;
            case 'isolated_refactor': return mutationScope.length <= 8 ? 'scope is small enough for simpler strategy' : `${chosen} preferred`;
            case 'expand_contract': return 'expand-contract requires coordinated deployment; overhead not justified here';
            case 'minimal_patch': return `${chosen} preferred due to scope or risk level`;
            default: return 'not applicable';
        }
    }
}
exports.StrategySelector = StrategySelector;
function buildMemo(input) {
    const selector = new StrategySelector();
    const chosen = selector.select(input.mutation_scope, input.retry_count, input.risk_level);
    const blast_radius = buildBlastRadius(input.mutation_scope, input.retry_count, input.risk_level);
    const rollback_plan = buildRollbackPlan(blast_radius, input.retry_count);
    const alternatives_rejected = selector.alternatives(chosen, input.mutation_scope, input.risk_level);
    return {
        memo_id: `memo-${crypto_1.default.randomBytes(4).toString('hex')}`,
        work_item_id: input.work_item_id,
        run_id: input.run_id,
        problem_summary: input.problem_summary,
        chosen_strategy: chosen,
        alternatives_rejected,
        blast_radius,
        rollback_plan,
        min_evidence_required: input.min_evidence_required ?? [],
        confidence: input.confidence ?? (1 - blast_radius.risk_score),
        created_at: new Date().toISOString(),
    };
}
function memoDir(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'memos');
}
function saveMemo(projectRoot, memo) {
    const dir = memoDir(projectRoot, memo.run_id);
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(dir, `${memo.memo_id}.json`), JSON.stringify(memo, null, 2), 'utf8');
}
function loadMemo(projectRoot, runId, memoId) {
    const p = path_1.default.join(memoDir(projectRoot, runId), `${memoId}.json`);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function listMemos(projectRoot, runId) {
    const dir = memoDir(projectRoot, runId);
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
        try {
            return JSON.parse(fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf8'));
        }
        catch {
            return null;
        }
    })
        .filter((m) => m !== null);
}
