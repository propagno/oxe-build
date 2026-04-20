"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyEngine = void 0;
exports.savePolicyDecision = savePolicyDecision;
exports.loadPolicyDecisions = loadPolicyDecisions;
exports.summarizePolicyDecisions = summarizePolicyDecisions;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ALLOW_ALL = {
    decision_id: '__default_allow',
    allowed: true,
    gate_required: false,
    reason: 'no matching policy — default allow',
    rule_id: null,
    timestamp: new Date().toISOString(),
};
const DEFAULT_GUARDRAIL = {
    protected_paths: ['.oxe/config.json', '.env', 'package.json'],
    protected_branches: ['main', 'master', 'production', 'release'],
    require_human_gate_on: ['infra_operation', 'db_change', 'secret_access'],
};
// Autonomy tier → max side effect class allowed without a gate
const TIER_SIDE_EFFECT_MAP = {
    L0: ['read_fs'],
    L1: ['read_fs', 'write_fs', 'spawn_process'],
    L2: ['read_fs', 'write_fs', 'spawn_process', 'network_call', 'git_mutation'],
    L3: ['read_fs', 'write_fs', 'spawn_process', 'network_call', 'git_mutation', 'db_change', 'secret_access', 'infra_operation'],
};
class PolicyEngine {
    constructor(rules = [], guardrail = DEFAULT_GUARDRAIL) {
        this.rules = rules;
        this.guardrail = guardrail;
    }
    evaluate(ctx) {
        // Check autonomy tier first — a denial takes priority over guardrail gates
        const tierDecision = this.checkAutonomyTier(ctx);
        if (tierDecision)
            return tierDecision;
        // Check environment guardrails (may require gate even when tier permits)
        const guardrailDecision = this.checkGuardrails(ctx);
        if (guardrailDecision)
            return guardrailDecision;
        // Check mutation budget
        const budgetDecision = this.checkMutationBudget(ctx);
        if (budgetDecision)
            return budgetDecision;
        // Evaluate rules (first match wins)
        for (const rule of this.rules) {
            if (!this.matches(rule.when, ctx))
                continue;
            if (rule.assert) {
                const assertFailed = this.checkAssert(rule.assert, ctx);
                if (assertFailed) {
                    return {
                        decision_id: rule.id,
                        allowed: false,
                        gate_required: false,
                        reason: `Assert failed for rule ${rule.id}: ${assertFailed}`,
                        rule_id: rule.id,
                        timestamp: new Date().toISOString(),
                    };
                }
            }
            switch (rule.action) {
                case 'allow':
                    return {
                        decision_id: rule.id,
                        allowed: true,
                        gate_required: false,
                        reason: `Allowed by rule ${rule.id}`,
                        rule_id: rule.id,
                        timestamp: new Date().toISOString(),
                    };
                case 'deny':
                    return {
                        decision_id: rule.id,
                        allowed: false,
                        gate_required: false,
                        reason: `Denied by rule ${rule.id}`,
                        rule_id: rule.id,
                        timestamp: new Date().toISOString(),
                    };
                case 'require_human_gate':
                    return {
                        decision_id: rule.id,
                        allowed: true,
                        gate_required: true,
                        reason: `Gate required by rule ${rule.id}`,
                        rule_id: rule.id,
                        timestamp: new Date().toISOString(),
                    };
            }
        }
        return { ...ALLOW_ALL, timestamp: new Date().toISOString() };
    }
    checkGuardrails(ctx) {
        // Protected path check
        const affected = ctx.affected_paths ?? [];
        for (const p of affected) {
            if (this.guardrail.protected_paths.some((pp) => p === pp || p.startsWith(pp + '/'))) {
                return {
                    decision_id: '__guardrail_path',
                    allowed: true,
                    gate_required: true,
                    reason: `Protected path affected: ${p}`,
                    rule_id: '__guardrail_path',
                    timestamp: new Date().toISOString(),
                };
            }
        }
        // Side effect class requiring gate
        if (ctx.side_effect_class && this.guardrail.require_human_gate_on.includes(ctx.side_effect_class)) {
            return {
                decision_id: '__guardrail_side_effect',
                allowed: true,
                gate_required: true,
                reason: `Side effect class '${ctx.side_effect_class}' requires human gate`,
                rule_id: '__guardrail_side_effect',
                timestamp: new Date().toISOString(),
            };
        }
        return null;
    }
    checkAutonomyTier(ctx) {
        if (!ctx.autonomy_tier || !ctx.side_effect_class)
            return null;
        const allowed = TIER_SIDE_EFFECT_MAP[ctx.autonomy_tier] ?? [];
        if (!allowed.includes(ctx.side_effect_class)) {
            return {
                decision_id: '__autonomy_tier',
                allowed: false,
                gate_required: false,
                reason: `Autonomy tier ${ctx.autonomy_tier} does not permit side effect '${ctx.side_effect_class}'`,
                rule_id: '__autonomy_tier',
                timestamp: new Date().toISOString(),
            };
        }
        return null;
    }
    checkMutationBudget(ctx) {
        const budget = ctx.node_policy?.mutation_budget;
        if (budget === undefined || budget === null)
            return null;
        const count = ctx.mutation_count ?? 0;
        if (count >= budget) {
            return {
                decision_id: '__mutation_budget',
                allowed: false,
                gate_required: false,
                reason: `Mutation budget exhausted: ${count}/${budget}`,
                rule_id: '__mutation_budget',
                timestamp: new Date().toISOString(),
            };
        }
        return null;
    }
    matches(when, ctx) {
        if (when.tool && when.tool !== ctx.tool)
            return false;
        if (when.env && when.env !== ctx.env)
            return false;
        if (when.kind && when.kind !== ctx.kind)
            return false;
        if (when.side_effect_class && when.side_effect_class !== ctx.side_effect_class)
            return false;
        if (when.autonomy_tier && when.autonomy_tier !== ctx.autonomy_tier)
            return false;
        return true;
    }
    checkAssert(assert, ctx) {
        if (assert.diff_within_scope === true) {
            const scope = ctx.mutation_scope ?? [];
            const affected = ctx.affected_paths ?? [];
            if (scope.length === 0)
                return null;
            const outsideScope = affected.filter((p) => !scope.some((s) => p.startsWith(s) || s.startsWith(p)));
            if (outsideScope.length > 0) {
                return `paths outside mutation scope: ${outsideScope.join(', ')}`;
            }
        }
        return null;
    }
    withRule(rule) {
        return new PolicyEngine([...this.rules, rule], this.guardrail);
    }
    withGuardrail(guardrail) {
        return new PolicyEngine(this.rules, guardrail);
    }
    getGuardrail() {
        return this.guardrail;
    }
    static fromConfig(config) {
        return new PolicyEngine(config.policies ?? [], config.guardrail ?? DEFAULT_GUARDRAIL);
    }
    static fromConfigFile(configPath) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cfg = require(configPath);
            return PolicyEngine.fromConfig(cfg);
        }
        catch {
            return new PolicyEngine();
        }
    }
    static defaultGuardrail() {
        return { ...DEFAULT_GUARDRAIL };
    }
}
exports.PolicyEngine = PolicyEngine;
function policyDecisionPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'policy-decisions.json');
}
function savePolicyDecision(projectRoot, decision) {
    const target = policyDecisionPath(projectRoot, decision.run_id);
    fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
    const existing = loadPolicyDecisions(projectRoot, decision.run_id);
    const next = [...existing.filter((item) => item.decision_id !== decision.decision_id), decision];
    fs_1.default.writeFileSync(target, JSON.stringify(next, null, 2), 'utf8');
    return decision;
}
function loadPolicyDecisions(projectRoot, runId) {
    const target = policyDecisionPath(projectRoot, runId);
    if (!fs_1.default.existsSync(target))
        return [];
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(target, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    }
    catch {
        return [];
    }
}
function summarizePolicyDecisions(decisions) {
    return {
        total: decisions.length,
        denied: decisions.filter((decision) => !decision.allowed).length,
        gated: decisions.filter((decision) => decision.gate_required).length,
        overridesWithoutRationale: decisions.filter((decision) => decision.override && !decision.rationale).length,
    };
}
