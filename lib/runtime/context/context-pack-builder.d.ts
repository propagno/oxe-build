import type { WorkItem } from '../models/work-item';
import type { Evidence } from '../models/evidence';
import type { RunState } from '../reducers/run-state-reducer';
import type { ContextProfile } from './context-profiles';
import type { AutonomyTier } from '../policy/policy-engine';
export interface ContextArtifact {
    id: string;
    kind: 'evidence' | 'lesson' | 'file' | 'summary';
    content: string;
    relevanceScore: number;
    tags: string[];
}
export interface LessonMetric {
    lesson_id: string;
    title: string;
    tags: string[];
    embedding?: number[];
    content: string;
}
export interface ContextPackOptions {
    maxArtifacts?: number;
    maxTokensEstimate?: number;
    deduplicateThreshold?: number;
}
export interface ContextPack {
    work_item_id: string;
    artifacts: ContextArtifact[];
    total_artifacts_considered: number;
    redundancy_removed: number;
    built_at: string;
}
export interface ContextQualityScore {
    completeness: number;
    relevance_mean: number;
    redundancy: number;
    recency_score: number;
    overall: number;
}
export declare function scorePackQuality(pack: ContextPack, profile: ContextProfile): ContextQualityScore;
export declare class ContextPackBuilder {
    private readonly opts;
    constructor(opts?: ContextPackOptions);
    build(workItem: WorkItem, state: RunState, evidenceItems: Evidence[], evidenceContents: Map<string, string>, lessons: LessonMetric[]): ContextPack;
    /** Convenience: build with no evidence, just lessons and state summary */
    buildLightweight(workItem: WorkItem, state: RunState, lessons: LessonMetric[]): ContextPack;
    /**
     * Filter artifacts to those whose path-like tags are within mutation_scope.
     * L0/L1 tiers apply the filter; L2/L3 skip it (full access).
     */
    filterByMutationScope(artifacts: ContextArtifact[], mutationScope: string[], autonomyTier: AutonomyTier): ContextArtifact[];
}
