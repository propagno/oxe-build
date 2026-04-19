import type { PolicyRule, EnvironmentGuardrail } from '../policy/policy-engine';
import { PolicyEngine } from '../policy/policy-engine';
export interface PolicyPack {
    pack_id: string;
    org_id: string;
    name: string;
    version: string;
    policies: PolicyRule[];
    guardrail: EnvironmentGuardrail;
    created_at: string;
}
export declare function savePolicyPack(projectRoot: string, pack: PolicyPack): void;
export declare function loadPolicyPack(projectRoot: string, packId: string): PolicyPack | null;
export declare function listPolicyPacks(projectRoot: string): PolicyPack[];
export declare function applyPolicyPack(engine: PolicyEngine, pack: PolicyPack): PolicyEngine;
