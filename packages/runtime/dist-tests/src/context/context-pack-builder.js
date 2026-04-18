"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextPackBuilder = void 0;
// ─── Relevance scoring ────────────────────────────────────────────────────────
function scoreEvidenceRelevance(evidence, workItem) {
    let score = 0.5;
    const eid = evidence.evidence_id.toLowerCase();
    const title = workItem.title.toLowerCase();
    const scope = workItem.mutation_scope ?? [];
    if (scope.some((s) => eid.includes(s.toLowerCase())))
        score += 0.3;
    if (title.split(/\s+/).some((w) => w.length > 3 && eid.includes(w)))
        score += 0.1;
    if (evidence.type === 'junit_xml')
        score += 0.05;
    if (evidence.type === 'diff')
        score += 0.05;
    return Math.min(score, 1.0);
}
function scoreLessonRelevance(lesson, workItem) {
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
function cosineSimilarity(a, b) {
    const wordsA = new Set(a.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.content.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0)
        return 0;
    let intersection = 0;
    for (const w of wordsA)
        if (wordsB.has(w))
            intersection++;
    return intersection / Math.sqrt(wordsA.size * wordsB.size);
}
function deduplicateArtifacts(artifacts, threshold) {
    const kept = [];
    let removed = 0;
    for (const candidate of artifacts) {
        const isDuplicate = kept.some((existing) => cosineSimilarity(candidate, existing) >= threshold);
        if (isDuplicate) {
            removed++;
        }
        else {
            kept.push(candidate);
        }
    }
    return { kept, removed };
}
// ─── Token budget estimation ──────────────────────────────────────────────────
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function applyTokenBudget(artifacts, maxTokens) {
    let used = 0;
    const result = [];
    for (const a of artifacts) {
        const t = estimateTokens(a.content);
        if (used + t > maxTokens)
            break;
        result.push(a);
        used += t;
    }
    return result;
}
// ─── Context Pack Builder ─────────────────────────────────────────────────────
class ContextPackBuilder {
    constructor(opts = {}) {
        this.opts = opts;
    }
    build(workItem, state, evidenceItems, evidenceContents, lessons) {
        const { maxArtifacts = 20, maxTokensEstimate = 8000, deduplicateThreshold = 0.85, } = this.opts;
        const raw = [];
        // Score and collect evidence
        for (const ev of evidenceItems) {
            const content = evidenceContents.get(ev.evidence_id) ?? '';
            if (!content)
                continue;
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
    buildLightweight(workItem, state, lessons) {
        return this.build(workItem, state, [], new Map(), lessons);
    }
}
exports.ContextPackBuilder = ContextPackBuilder;
