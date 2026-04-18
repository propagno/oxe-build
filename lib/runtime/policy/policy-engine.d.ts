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
export declare class PolicyEngine {
    private readonly rules;
    constructor(rules?: PolicyRule[]);
    evaluate(ctx: PolicyContext): PolicyDecision;
    private matches;
    private checkAssert;
    withRule(rule: PolicyRule): PolicyEngine;
    static fromConfig(config: {
        policies?: PolicyRule[];
    }): PolicyEngine;
    static fromConfigFile(configPath: string): PolicyEngine;
}
