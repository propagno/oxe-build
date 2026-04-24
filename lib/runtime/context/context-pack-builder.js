"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextPackBuilder = void 0;
exports.scorePackQuality = scorePackQuality;
function scorePackQuality(pack, profile) {
    const expectedKinds = Object.keys(profile.artifact_kind_weights);
    const presentKinds = new Set(pack.artifacts.map((a) => a.kind));
    const completeness = expectedKinds.length > 0
        ? expectedKinds.filter((k) => presentKinds.has(k)).length / expectedKinds.length
        : 0;
    const relevance_mean = pack.artifacts.length > 0
        ? pack.artifacts.reduce((sum, a) => sum + a.relevanceScore, 0) / pack.artifacts.length
        : 0;
    const total = pack.total_artifacts_considered;
    const redundancy = total > 0 ? 1 - (pack.artifacts.length / total) : 0;
    const ageMs = Date.now() - new Date(pack.built_at).getTime();
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const recency_score = Math.max(0, 1 - ageMs / maxAgeMs);
    const overall = Math.min(1, 0.3 * completeness +
        0.35 * relevance_mean +
        0.1 * (1 - redundancy) +
        0.25 * recency_score);
    return {
        completeness: Math.round(completeness * 100) / 100,
        relevance_mean: Math.round(relevance_mean * 100) / 100,
        redundancy: Math.round(redundancy * 100) / 100,
        recency_score: Math.round(recency_score * 100) / 100,
        overall: Math.round(overall * 100) / 100,
    };
}
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
    /**
     * Remove artifacts with lowest relevance until the pack fits within targetTokens.
     * Artifacts already sorted by relevance; we trim the tail.
     */
    compact(pack, targetTokens) {
        if (estimateTokens(pack.artifacts.map((a) => a.content).join('\n')) <= targetTokens) {
            return pack;
        }
        const sorted = [...pack.artifacts].sort((a, b) => b.relevanceScore - a.relevanceScore);
        const trimmed = [];
        let used = 0;
        for (const artifact of sorted) {
            const t = estimateTokens(artifact.content);
            if (used + t > targetTokens)
                break;
            trimmed.push(artifact);
            used += t;
        }
        return {
            ...pack,
            artifacts: trimmed,
            redundancy_removed: pack.redundancy_removed + (pack.artifacts.length - trimmed.length),
        };
    }
    /**
     * Merge groups of similar artifacts (cosine similarity >= threshold) into single
     * combined artifacts to reduce redundancy without discarding information entirely.
     */
    microCompact(artifacts, similarityThreshold = 0.7) {
        const merged = [];
        const used = new Set();
        for (let i = 0; i < artifacts.length; i++) {
            if (used.has(i))
                continue;
            const group = [artifacts[i]];
            for (let j = i + 1; j < artifacts.length; j++) {
                if (!used.has(j) && cosineSimilarity(artifacts[i], artifacts[j]) >= similarityThreshold) {
                    group.push(artifacts[j]);
                    used.add(j);
                }
            }
            used.add(i);
            if (group.length === 1) {
                merged.push(group[0]);
            }
            else {
                const combinedContent = group
                    .map((a) => a.content)
                    .join('\n---\n')
                    .slice(0, 4000);
                merged.push({
                    id: group[0].id,
                    kind: group[0].kind,
                    content: combinedContent,
                    relevanceScore: group.reduce((s, a) => s + a.relevanceScore, 0) / group.length,
                    tags: [...new Set(group.flatMap((a) => a.tags))],
                });
            }
        }
        return merged;
    }
    /**
     * Automatically compact a pack to fit within hardLimitTokens.
     * First applies microCompact (lossless merging), then compact (trimming by relevance).
     */
    autoCompact(pack, hardLimitTokens) {
        const currentTokens = estimateTokens(pack.artifacts.map((a) => a.content).join('\n'));
        if (currentTokens <= hardLimitTokens)
            return pack;
        const microCompacted = this.microCompact(pack.artifacts);
        const removedByMicro = pack.artifacts.length - microCompacted.length;
        const interim = {
            ...pack,
            artifacts: microCompacted,
            redundancy_removed: pack.redundancy_removed + removedByMicro,
        };
        return this.compact(interim, hardLimitTokens);
    }
    /**
     * Filter artifacts to those whose path-like tags are within mutation_scope.
     * L0/L1 tiers apply the filter; L2/L3 skip it (full access).
     */
    filterByMutationScope(artifacts, mutationScope, autonomyTier) {
        if (autonomyTier === 'L2' || autonomyTier === 'L3')
            return artifacts;
        const scope = mutationScope.map((s) => s.toLowerCase());
        return artifacts.filter((a) => {
            const pathTags = a.tags.filter((t) => t.includes('/') || t.includes('\\'));
            if (pathTags.length === 0)
                return true;
            return pathTags.some((tag) => scope.some((s) => tag.toLowerCase().includes(s) || s.includes(tag.toLowerCase())));
        });
    }
}
exports.ContextPackBuilder = ContextPackBuilder;
