import type { ContextPack, ContextQualityScore } from './context-pack-builder';
export interface ContextPackMeta {
    pack_id: string;
    work_item_id: string;
    run_id: string;
    built_at: string;
    artifact_count: number;
    estimated_tokens: number;
    stale: boolean;
    stale_reason: string | null;
}
export interface ContextPackDiff {
    added: string[];
    removed: string[];
    score_changed: Array<{
        id: string;
        before: number;
        after: number;
    }>;
}
export declare function savePack(projectRoot: string, runId: string, pack: ContextPack): ContextPackMeta;
export declare function loadPack(projectRoot: string, runId: string, workItemId: string): ContextPack | null;
export declare function markStale(projectRoot: string, runId: string, workItemId: string, reason: string): void;
export declare function isStale(projectRoot: string, runId: string, workItemId: string): boolean;
export declare function diffPacks(before: ContextPack, after: ContextPack): ContextPackDiff;
export declare function listPackMeta(projectRoot: string, runId: string): ContextPackMeta[];
export interface ContextPackRef {
    ref_id: string;
    pack_id: string;
    attempt_id: string;
    work_item_id: string;
    run_id: string;
    artifacts_used: string[];
    quality: ContextQualityScore;
    linked_at: string;
}
export declare function linkPackToAttempt(projectRoot: string, runId: string, attemptId: string, pack: ContextPack, quality: ContextQualityScore): ContextPackRef;
export declare function getPackRefForAttempt(projectRoot: string, runId: string, attemptId: string): ContextPackRef | null;
