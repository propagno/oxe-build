import type { WorkItem } from '../models/work-item';
import type { Evidence } from '../models/evidence';
import type { RunState } from '../reducers/run-state-reducer';

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

// ─── Relevance scoring ────────────────────────────────────────────────────────

function scoreEvidenceRelevance(evidence: Evidence, workItem: WorkItem): number {
  let score = 0.5;
  const eid = evidence.evidence_id.toLowerCase();
  const title = workItem.title.toLowerCase();
  const scope = workItem.mutation_scope ?? [];

  if (scope.some((s) => eid.includes(s.toLowerCase()))) score += 0.3;
  if (title.split(/\s+/).some((w) => w.length > 3 && eid.includes(w))) score += 0.1;
  if (evidence.type === 'junit_xml') score += 0.05;
  if (evidence.type === 'diff') score += 0.05;

  return Math.min(score, 1.0);
}

function scoreLessonRelevance(lesson: LessonMetric, workItem: WorkItem): number {
  const itemTags = new Set([
    ...workItem.mutation_scope.map((s) => s.toLowerCase()),
    ...workItem.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  ]);

  const lessonTags = lesson.tags.map((t) => t.toLowerCase());
  const overlap = lessonTags.filter((t) => itemTags.has(t)).length;
  const jaccard = overlap / (itemTags.size + lessonTags.length - overlap || 1);

  return Math.min(0.3 + jaccard * 0.7, 1.0);
}

// ─── Redundancy elimination ───────────────────────────────────────────────────

function cosineSimilarity(a: ContextArtifact, b: ContextArtifact): number {
  const wordsA = new Set(a.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  return intersection / Math.sqrt(wordsA.size * wordsB.size);
}

function deduplicateArtifacts(artifacts: ContextArtifact[], threshold: number): { kept: ContextArtifact[]; removed: number } {
  const kept: ContextArtifact[] = [];
  let removed = 0;

  for (const candidate of artifacts) {
    const isDuplicate = kept.some((existing) => cosineSimilarity(candidate, existing) >= threshold);
    if (isDuplicate) {
      removed++;
    } else {
      kept.push(candidate);
    }
  }

  return { kept, removed };
}

// ─── Token budget estimation ──────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyTokenBudget(artifacts: ContextArtifact[], maxTokens: number): ContextArtifact[] {
  let used = 0;
  const result: ContextArtifact[] = [];
  for (const a of artifacts) {
    const t = estimateTokens(a.content);
    if (used + t > maxTokens) break;
    result.push(a);
    used += t;
  }
  return result;
}

// ─── Context Pack Builder ─────────────────────────────────────────────────────

export class ContextPackBuilder {
  constructor(private readonly opts: ContextPackOptions = {}) {}

  build(
    workItem: WorkItem,
    state: RunState,
    evidenceItems: Evidence[],
    evidenceContents: Map<string, string>,
    lessons: LessonMetric[],
  ): ContextPack {
    const {
      maxArtifacts = 20,
      maxTokensEstimate = 8000,
      deduplicateThreshold = 0.85,
    } = this.opts;

    const raw: ContextArtifact[] = [];

    // Score and collect evidence
    for (const ev of evidenceItems) {
      const content = evidenceContents.get(ev.evidence_id) ?? '';
      if (!content) continue;
      raw.push({
        id: ev.evidence_id,
        kind: 'evidence',
        content,
        relevanceScore: scoreEvidenceRelevance(ev, workItem),
        tags: [ev.type, workItem.work_item_id],
      });
    }

    // Score and collect lessons
    for (const lesson of lessons) {
      raw.push({
        id: lesson.lesson_id,
        kind: 'lesson',
        content: lesson.content,
        relevanceScore: scoreLessonRelevance(lesson, workItem),
        tags: lesson.tags,
      });
    }

    // Add run-level summary if available
    const completedCount = state.completedWorkItems.size;
    if (completedCount > 0) {
      raw.push({
        id: `run-summary-${workItem.run_id}`,
        kind: 'summary',
        content: `Run progress: ${completedCount} completed, ${state.failedWorkItems.size} failed, ${state.blockedWorkItems.size} blocked.`,
        relevanceScore: 0.4,
        tags: ['run-context'],
      });
    }

    const totalConsidered = raw.length;

    // Sort by relevance descending
    raw.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Deduplicate
    const { kept, removed } = deduplicateArtifacts(raw, deduplicateThreshold);

    // Apply max artifacts cap
    const capped = kept.slice(0, maxArtifacts);

    // Apply token budget
    const final = applyTokenBudget(capped, maxTokensEstimate);

    return {
      work_item_id: workItem.work_item_id,
      artifacts: final,
      total_artifacts_considered: totalConsidered,
      redundancy_removed: removed,
      built_at: new Date().toISOString(),
    };
  }

  /** Convenience: build with no evidence, just lessons and state summary */
  buildLightweight(workItem: WorkItem, state: RunState, lessons: LessonMetric[]): ContextPack {
    return this.build(workItem, state, [], new Map(), lessons);
  }
}
