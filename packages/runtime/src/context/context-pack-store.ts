import path from 'path';
import fs from 'fs';
import type { ContextPack, ContextArtifact, ContextQualityScore } from './context-pack-builder';

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
  score_changed: Array<{ id: string; before: number; after: number }>;
}

function packPath(projectRoot: string, runId: string, workItemId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, `context-pack-${workItemId}.json`);
}

function metaIndexPath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'context-packs.index.json');
}

function estimateTokens(pack: ContextPack): number {
  return Math.ceil(pack.artifacts.reduce((sum, a) => sum + a.content.length, 0) / 4);
}

export function savePack(
  projectRoot: string,
  runId: string,
  pack: ContextPack
): ContextPackMeta {
  const p = packPath(projectRoot, runId, pack.work_item_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(pack, null, 2), 'utf8');

  const meta: ContextPackMeta = {
    pack_id: `cp-${runId}-${pack.work_item_id}`,
    work_item_id: pack.work_item_id,
    run_id: runId,
    built_at: pack.built_at,
    artifact_count: pack.artifacts.length,
    estimated_tokens: estimateTokens(pack),
    stale: false,
    stale_reason: null,
  };

  updateMetaIndex(projectRoot, runId, meta);
  return meta;
}

export function loadPack(
  projectRoot: string,
  runId: string,
  workItemId: string
): ContextPack | null {
  const p = packPath(projectRoot, runId, workItemId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ContextPack;
  } catch {
    return null;
  }
}

export function markStale(
  projectRoot: string,
  runId: string,
  workItemId: string,
  reason: string
): void {
  const index = loadMetaIndex(projectRoot, runId);
  const meta = index.find((m) => m.work_item_id === workItemId);
  if (!meta) return;
  meta.stale = true;
  meta.stale_reason = reason;
  saveMetaIndex(projectRoot, runId, index);
}

export function isStale(
  projectRoot: string,
  runId: string,
  workItemId: string
): boolean {
  const index = loadMetaIndex(projectRoot, runId);
  return index.find((m) => m.work_item_id === workItemId)?.stale ?? false;
}

export function diffPacks(before: ContextPack, after: ContextPack): ContextPackDiff {
  const beforeIds = new Set(before.artifacts.map((a) => a.id));
  const afterIds = new Set(after.artifacts.map((a) => a.id));
  const beforeMap = new Map(before.artifacts.map((a) => [a.id, a]));
  const afterMap = new Map(after.artifacts.map((a) => [a.id, a]));

  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));

  const score_changed: ContextPackDiff['score_changed'] = [];
  for (const id of afterIds) {
    if (!beforeIds.has(id)) continue;
    const bScore = beforeMap.get(id)!.relevanceScore;
    const aScore = afterMap.get(id)!.relevanceScore;
    if (Math.abs(bScore - aScore) > 0.05) {
      score_changed.push({ id, before: bScore, after: aScore });
    }
  }

  return { added, removed, score_changed };
}

export function listPackMeta(projectRoot: string, runId: string): ContextPackMeta[] {
  return loadMetaIndex(projectRoot, runId);
}

// ─── ContextPackRef — link pack to a specific execution attempt ───────────────

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

function packRefPath(projectRoot: string, runId: string, attemptId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, `context-ref-${attemptId}.json`);
}

export function linkPackToAttempt(
  projectRoot: string,
  runId: string,
  attemptId: string,
  pack: ContextPack,
  quality: ContextQualityScore
): ContextPackRef {
  const ref: ContextPackRef = {
    ref_id: `ref-${runId}-${attemptId}`,
    pack_id: `cp-${runId}-${pack.work_item_id}`,
    attempt_id: attemptId,
    work_item_id: pack.work_item_id,
    run_id: runId,
    artifacts_used: pack.artifacts.map((a) => a.id),
    quality,
    linked_at: new Date().toISOString(),
  };
  const p = packRefPath(projectRoot, runId, attemptId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ref, null, 2), 'utf8');
  return ref;
}

export function getPackRefForAttempt(
  projectRoot: string,
  runId: string,
  attemptId: string
): ContextPackRef | null {
  const p = packRefPath(projectRoot, runId, attemptId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ContextPackRef;
  } catch {
    return null;
  }
}

function loadMetaIndex(projectRoot: string, runId: string): ContextPackMeta[] {
  const p = metaIndexPath(projectRoot, runId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ContextPackMeta[];
  } catch {
    return [];
  }
}

function saveMetaIndex(projectRoot: string, runId: string, index: ContextPackMeta[]): void {
  const p = metaIndexPath(projectRoot, runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(index, null, 2), 'utf8');
}

function updateMetaIndex(projectRoot: string, runId: string, meta: ContextPackMeta): void {
  const index = loadMetaIndex(projectRoot, runId);
  const idx = index.findIndex((m) => m.work_item_id === meta.work_item_id);
  if (idx >= 0) index[idx] = meta;
  else index.push(meta);
  saveMetaIndex(projectRoot, runId, index);
}
