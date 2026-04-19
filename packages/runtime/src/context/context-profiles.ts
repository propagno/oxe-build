import type { ContextArtifact } from './context-pack-builder';

export type ContextDecisionType = 'execute' | 'verify' | 'plan' | 'review' | 'debug' | 'migration';

export interface ContextProfile {
  decision_type: ContextDecisionType;
  artifact_kind_weights: Record<ContextArtifact['kind'], number>;
  quality_threshold: number;
  max_artifacts: number;
  max_tokens: number;
}

export const DEFAULT_PROFILES: Record<ContextDecisionType, ContextProfile> = {
  execute: {
    decision_type: 'execute',
    artifact_kind_weights: { evidence: 0.8, lesson: 0.3, file: 0.6, summary: 0.4 },
    quality_threshold: 0.6,
    max_artifacts: 20,
    max_tokens: 8000,
  },
  verify: {
    decision_type: 'verify',
    artifact_kind_weights: { evidence: 0.9, lesson: 0.2, file: 0.5, summary: 0.5 },
    quality_threshold: 0.7,
    max_artifacts: 15,
    max_tokens: 6000,
  },
  plan: {
    decision_type: 'plan',
    artifact_kind_weights: { evidence: 0.4, lesson: 0.9, file: 0.7, summary: 0.6 },
    quality_threshold: 0.5,
    max_artifacts: 25,
    max_tokens: 10000,
  },
  review: {
    decision_type: 'review',
    artifact_kind_weights: { evidence: 0.6, lesson: 0.5, file: 0.8, summary: 0.5 },
    quality_threshold: 0.55,
    max_artifacts: 20,
    max_tokens: 8000,
  },
  debug: {
    decision_type: 'debug',
    artifact_kind_weights: { evidence: 0.9, lesson: 0.6, file: 0.7, summary: 0.4 },
    quality_threshold: 0.6,
    max_artifacts: 20,
    max_tokens: 8000,
  },
  migration: {
    decision_type: 'migration',
    artifact_kind_weights: { evidence: 0.7, lesson: 0.7, file: 0.9, summary: 0.5 },
    quality_threshold: 0.65,
    max_artifacts: 30,
    max_tokens: 12000,
  },
};

export function getProfile(decisionType: ContextDecisionType): ContextProfile {
  return DEFAULT_PROFILES[decisionType];
}
