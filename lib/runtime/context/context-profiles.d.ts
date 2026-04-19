import type { ContextArtifact } from './context-pack-builder';
export type ContextDecisionType = 'execute' | 'verify' | 'plan' | 'review' | 'debug' | 'migration';
export interface ContextProfile {
    decision_type: ContextDecisionType;
    artifact_kind_weights: Record<ContextArtifact['kind'], number>;
    quality_threshold: number;
    max_artifacts: number;
    max_tokens: number;
}
export declare const DEFAULT_PROFILES: Record<ContextDecisionType, ContextProfile>;
export declare function getProfile(decisionType: ContextDecisionType): ContextProfile;
