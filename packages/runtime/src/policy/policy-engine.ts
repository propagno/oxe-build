export type PolicyAction = 'allow' | 'deny' | 'require_human_gate';

export interface PolicyWhenClause {
  tool?: string;
  env?: string;
  kind?: string;
}

export interface PolicyAssertClause {
  diff_within_scope?: boolean;
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

export class PolicyEngine {
  constructor(private readonly rules: PolicyRule[] = []) {}

  evaluate(ctx: PolicyContext): PolicyDecision {
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

  private matches(when: PolicyWhenClause, ctx: PolicyContext): boolean {
    if (when.tool && when.tool !== ctx.tool) return false;
    if (when.env && when.env !== ctx.env) return false;
    if (when.kind && when.kind !== ctx.kind) return false;
    return true;
  }

  private checkAssert(assert: PolicyAssertClause, ctx: PolicyContext): string | null {
    if (assert.diff_within_scope === true) {
      const scope = ctx.mutation_scope ?? [];
      const affected = ctx.affected_paths ?? [];
      if (scope.length === 0) return null; // no scope declared — pass
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
    return new PolicyEngine([...this.rules, rule]);
  }

  static fromConfig(config: { policies?: PolicyRule[] }): PolicyEngine {
    return new PolicyEngine(config.policies ?? []);
  }

  static fromConfigFile(configPath: string): PolicyEngine {
    try {
      // Dynamic require to avoid bundling issues
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cfg = require(configPath) as { policies?: PolicyRule[] };
      return PolicyEngine.fromConfig(cfg);
    } catch {
      return new PolicyEngine();
    }
  }
}
