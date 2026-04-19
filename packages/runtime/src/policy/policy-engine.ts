export type PolicyAction = 'allow' | 'deny' | 'require_human_gate';

export type SideEffectClass =
  | 'read_fs'
  | 'write_fs'
  | 'spawn_process'
  | 'network_call'
  | 'git_mutation'
  | 'db_change'
  | 'secret_access'
  | 'infra_operation';

export type AutonomyTier = 'L0' | 'L1' | 'L2' | 'L3';

export interface PolicyWhenClause {
  tool?: string;
  env?: string;
  kind?: string;
  side_effect_class?: SideEffectClass;
  autonomy_tier?: AutonomyTier;
}

export interface PolicyAssertClause {
  diff_within_scope?: boolean;
}

export interface NodePolicyConfig {
  max_retries: number;
  mutation_budget?: number;
  autonomy_tier?: AutonomyTier;
  allowed_side_effects?: SideEffectClass[];
}

export interface EnvironmentGuardrail {
  protected_paths: string[];
  protected_branches: string[];
  require_human_gate_on: SideEffectClass[];
}

export interface PolicyRule {
  id: string;
  when: PolicyWhenClause;
  assert?: PolicyAssertClause;
  action: PolicyAction;
}

export interface PolicyContext {
  tool: string;
  env?: string;
  kind?: string;
  mutation_scope?: string[];
  affected_paths?: string[];
  side_effect_class?: SideEffectClass;
  autonomy_tier?: AutonomyTier;
  mutation_count?: number;
  node_policy?: NodePolicyConfig;
}

export interface PolicyDecision {
  allowed: boolean;
  gate_required: boolean;
  reason: string;
  rule_id: string | null;
}

const ALLOW_ALL: PolicyDecision = {
  allowed: true,
  gate_required: false,
  reason: 'no matching policy — default allow',
  rule_id: null,
};

const DEFAULT_GUARDRAIL: EnvironmentGuardrail = {
  protected_paths: ['.oxe/config.json', '.env', 'package.json'],
  protected_branches: ['main', 'master', 'production', 'release'],
  require_human_gate_on: ['infra_operation', 'db_change', 'secret_access'],
};

// Autonomy tier → max side effect class allowed without a gate
const TIER_SIDE_EFFECT_MAP: Record<AutonomyTier, SideEffectClass[]> = {
  L0: ['read_fs'],
  L1: ['read_fs', 'write_fs', 'spawn_process'],
  L2: ['read_fs', 'write_fs', 'spawn_process', 'network_call', 'git_mutation'],
  L3: ['read_fs', 'write_fs', 'spawn_process', 'network_call', 'git_mutation', 'db_change', 'secret_access', 'infra_operation'],
};

export class PolicyEngine {
  constructor(
    private readonly rules: PolicyRule[] = [],
    private readonly guardrail: EnvironmentGuardrail = DEFAULT_GUARDRAIL
  ) {}

  evaluate(ctx: PolicyContext): PolicyDecision {
    // Check autonomy tier first — a denial takes priority over guardrail gates
    const tierDecision = this.checkAutonomyTier(ctx);
    if (tierDecision) return tierDecision;

    // Check environment guardrails (may require gate even when tier permits)
    const guardrailDecision = this.checkGuardrails(ctx);
    if (guardrailDecision) return guardrailDecision;

    // Check mutation budget
    const budgetDecision = this.checkMutationBudget(ctx);
    if (budgetDecision) return budgetDecision;

    // Evaluate rules (first match wins)
    for (const rule of this.rules) {
      if (!this.matches(rule.when, ctx)) continue;

      if (rule.assert) {
        const assertFailed = this.checkAssert(rule.assert, ctx);
        if (assertFailed) {
          return {
            allowed: false,
            gate_required: false,
            reason: `Assert failed for rule ${rule.id}: ${assertFailed}`,
            rule_id: rule.id,
          };
        }
      }

      switch (rule.action) {
        case 'allow':
          return { allowed: true, gate_required: false, reason: `Allowed by rule ${rule.id}`, rule_id: rule.id };
        case 'deny':
          return { allowed: false, gate_required: false, reason: `Denied by rule ${rule.id}`, rule_id: rule.id };
        case 'require_human_gate':
          return { allowed: true, gate_required: true, reason: `Gate required by rule ${rule.id}`, rule_id: rule.id };
      }
    }

    return ALLOW_ALL;
  }

  private checkGuardrails(ctx: PolicyContext): PolicyDecision | null {
    // Protected path check
    const affected = ctx.affected_paths ?? [];
    for (const p of affected) {
      if (this.guardrail.protected_paths.some((pp) => p === pp || p.startsWith(pp + '/'))) {
        return {
          allowed: true,
          gate_required: true,
          reason: `Protected path affected: ${p}`,
          rule_id: '__guardrail_path',
        };
      }
    }

    // Side effect class requiring gate
    if (ctx.side_effect_class && this.guardrail.require_human_gate_on.includes(ctx.side_effect_class)) {
      return {
        allowed: true,
        gate_required: true,
        reason: `Side effect class '${ctx.side_effect_class}' requires human gate`,
        rule_id: '__guardrail_side_effect',
      };
    }

    return null;
  }

  private checkAutonomyTier(ctx: PolicyContext): PolicyDecision | null {
    if (!ctx.autonomy_tier || !ctx.side_effect_class) return null;
    const allowed = TIER_SIDE_EFFECT_MAP[ctx.autonomy_tier] ?? [];
    if (!allowed.includes(ctx.side_effect_class)) {
      return {
        allowed: false,
        gate_required: false,
        reason: `Autonomy tier ${ctx.autonomy_tier} does not permit side effect '${ctx.side_effect_class}'`,
        rule_id: '__autonomy_tier',
      };
    }
    return null;
  }

  private checkMutationBudget(ctx: PolicyContext): PolicyDecision | null {
    const budget = ctx.node_policy?.mutation_budget;
    if (budget === undefined || budget === null) return null;
    const count = ctx.mutation_count ?? 0;
    if (count >= budget) {
      return {
        allowed: false,
        gate_required: false,
        reason: `Mutation budget exhausted: ${count}/${budget}`,
        rule_id: '__mutation_budget',
      };
    }
    return null;
  }

  private matches(when: PolicyWhenClause, ctx: PolicyContext): boolean {
    if (when.tool && when.tool !== ctx.tool) return false;
    if (when.env && when.env !== ctx.env) return false;
    if (when.kind && when.kind !== ctx.kind) return false;
    if (when.side_effect_class && when.side_effect_class !== ctx.side_effect_class) return false;
    if (when.autonomy_tier && when.autonomy_tier !== ctx.autonomy_tier) return false;
    return true;
  }

  private checkAssert(assert: PolicyAssertClause, ctx: PolicyContext): string | null {
    if (assert.diff_within_scope === true) {
      const scope = ctx.mutation_scope ?? [];
      const affected = ctx.affected_paths ?? [];
      if (scope.length === 0) return null;
      const outsideScope = affected.filter(
        (p) => !scope.some((s) => p.startsWith(s) || s.startsWith(p))
      );
      if (outsideScope.length > 0) {
        return `paths outside mutation scope: ${outsideScope.join(', ')}`;
      }
    }
    return null;
  }

  withRule(rule: PolicyRule): PolicyEngine {
    return new PolicyEngine([...this.rules, rule], this.guardrail);
  }

  withGuardrail(guardrail: EnvironmentGuardrail): PolicyEngine {
    return new PolicyEngine(this.rules, guardrail);
  }

  getGuardrail(): EnvironmentGuardrail {
    return this.guardrail;
  }

  static fromConfig(config: { policies?: PolicyRule[]; guardrail?: EnvironmentGuardrail }): PolicyEngine {
    return new PolicyEngine(config.policies ?? [], config.guardrail ?? DEFAULT_GUARDRAIL);
  }

  static fromConfigFile(configPath: string): PolicyEngine {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require(configPath) as { policies?: PolicyRule[]; guardrail?: EnvironmentGuardrail };
      return PolicyEngine.fromConfig(cfg);
    } catch {
      return new PolicyEngine();
    }
  }

  static defaultGuardrail(): EnvironmentGuardrail {
    return { ...DEFAULT_GUARDRAIL };
  }
}
