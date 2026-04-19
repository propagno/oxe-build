export type PolicyAction = 'allow' | 'deny' | 'require_human_gate';
export type SideEffectClass = 'read_fs' | 'write_fs' | 'spawn_process' | 'network_call' | 'git_mutation' | 'db_change' | 'secret_access' | 'infra_operation';
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
export declare class PolicyEngine {
    private readonly rules;
    private readonly guardrail;
    constructor(rules?: PolicyRule[], guardrail?: EnvironmentGuardrail);
    evaluate(ctx: PolicyContext): PolicyDecision;
    private checkGuardrails;
    private checkAutonomyTier;
    private checkMutationBudget;
    private matches;
    private checkAssert;
    withRule(rule: PolicyRule): PolicyEngine;
    withGuardrail(guardrail: EnvironmentGuardrail): PolicyEngine;
    getGuardrail(): EnvironmentGuardrail;
    static fromConfig(config: {
        policies?: PolicyRule[];
        guardrail?: EnvironmentGuardrail;
    }): PolicyEngine;
    static fromConfigFile(configPath: string): PolicyEngine;
    static defaultGuardrail(): EnvironmentGuardrail;
}
