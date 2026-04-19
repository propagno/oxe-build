"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const context_profiles_1 = require("../src/context/context-profiles");
const context_pack_builder_1 = require("../src/context/context-pack-builder");
const context_pack_store_1 = require("../src/context/context-pack-store");
const run_state_reducer_1 = require("../src/reducers/run-state-reducer");
function makeRunState() {
    return (0, run_state_reducer_1.createEmptyRunState)();
}
function makePack(artifactCount = 3) {
    return {
        work_item_id: 'T1',
        artifacts: Array.from({ length: artifactCount }, (_, i) => ({
            id: `art-${i}`,
            kind: (i % 2 === 0 ? 'evidence' : 'lesson'),
            content: `content for artifact ${i}`.repeat(10),
            relevanceScore: 0.7 + i * 0.05,
            tags: ['test'],
        })),
        total_artifacts_considered: artifactCount + 2,
        redundancy_removed: 2,
        built_at: new Date().toISOString(),
    };
}
(0, node_test_1.describe)('ContextProfiles', () => {
    (0, node_test_1.test)('all decision types have a default profile', () => {
        const types = ['execute', 'verify', 'plan', 'review', 'debug', 'migration'];
        for (const t of types) {
            const p = context_profiles_1.DEFAULT_PROFILES[t];
            strict_1.default.ok(p, `missing profile for ${t}`);
            strict_1.default.equal(p.decision_type, t);
            strict_1.default.ok(p.quality_threshold >= 0 && p.quality_threshold <= 1);
            strict_1.default.ok(p.max_artifacts > 0);
            strict_1.default.ok(p.max_tokens > 0);
        }
    });
    (0, node_test_1.test)('getProfile returns the correct profile', () => {
        const p = (0, context_profiles_1.getProfile)('plan');
        strict_1.default.equal(p.decision_type, 'plan');
        strict_1.default.ok(p.artifact_kind_weights['lesson'] > p.artifact_kind_weights['evidence'], 'plan profile should weight lessons more than evidence');
    });
    (0, node_test_1.test)('verify profile has higher quality threshold than execute', () => {
        strict_1.default.ok(context_profiles_1.DEFAULT_PROFILES.verify.quality_threshold > context_profiles_1.DEFAULT_PROFILES.execute.quality_threshold);
    });
    (0, node_test_1.test)('migration profile has more max_artifacts than execute', () => {
        strict_1.default.ok(context_profiles_1.DEFAULT_PROFILES.migration.max_artifacts >= context_profiles_1.DEFAULT_PROFILES.execute.max_artifacts);
    });
});
(0, node_test_1.describe)('scorePackQuality', () => {
    (0, node_test_1.test)('returns a valid ContextQualityScore', () => {
        const pack = makePack(4);
        const profile = (0, context_profiles_1.getProfile)('execute');
        const score = (0, context_pack_builder_1.scorePackQuality)(pack, profile);
        strict_1.default.ok(score.completeness >= 0 && score.completeness <= 1);
        strict_1.default.ok(score.relevance_mean >= 0 && score.relevance_mean <= 1);
        strict_1.default.ok(score.redundancy >= 0 && score.redundancy <= 1);
        strict_1.default.ok(score.recency_score >= 0 && score.recency_score <= 1);
        strict_1.default.ok(score.overall >= 0 && score.overall <= 1);
    });
    (0, node_test_1.test)('pack with no artifacts gets zero relevance_mean', () => {
        const pack = {
            work_item_id: 'T2',
            artifacts: [],
            total_artifacts_considered: 0,
            redundancy_removed: 0,
            built_at: new Date().toISOString(),
        };
        const score = (0, context_pack_builder_1.scorePackQuality)(pack, (0, context_profiles_1.getProfile)('execute'));
        strict_1.default.equal(score.relevance_mean, 0);
    });
    (0, node_test_1.test)('freshly built pack has high recency_score', () => {
        const pack = makePack(3);
        const score = (0, context_pack_builder_1.scorePackQuality)(pack, (0, context_profiles_1.getProfile)('execute'));
        strict_1.default.ok(score.recency_score > 0.9, `expected high recency, got ${score.recency_score}`);
    });
    (0, node_test_1.test)('old pack has zero recency_score', () => {
        const pack = makePack(2);
        pack.built_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const score = (0, context_pack_builder_1.scorePackQuality)(pack, (0, context_profiles_1.getProfile)('execute'));
        strict_1.default.equal(score.recency_score, 0);
    });
});
(0, node_test_1.describe)('filterByMutationScope', () => {
    const builder = new context_pack_builder_1.ContextPackBuilder();
    (0, node_test_1.test)('L2 tier returns all artifacts', () => {
        const artifacts = [
            { id: '1', kind: 'file', content: 'x', relevanceScore: 0.5, tags: ['src/other/file.ts'] },
            { id: '2', kind: 'file', content: 'x', relevanceScore: 0.5, tags: ['src/api/handler.ts'] },
        ];
        const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L2');
        strict_1.default.equal(result.length, 2);
    });
    (0, node_test_1.test)('L1 tier filters artifacts outside scope', () => {
        const artifacts = [
            { id: '1', kind: 'file', content: 'x', relevanceScore: 0.5, tags: ['src/api/handler.ts'] },
            { id: '2', kind: 'file', content: 'x', relevanceScore: 0.5, tags: ['src/other/handler.ts'] },
        ];
        const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L1');
        strict_1.default.equal(result.length, 1);
        strict_1.default.equal(result[0].id, '1');
    });
    (0, node_test_1.test)('artifacts with no path tags are always kept', () => {
        const artifacts = [
            { id: '1', kind: 'evidence', content: 'x', relevanceScore: 0.5, tags: ['junit', 'T1'] },
        ];
        const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L0');
        strict_1.default.equal(result.length, 1);
    });
});
(0, node_test_1.describe)('ContextPackRef', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-cpref-'));
    });
    (0, node_test_1.test)('linkPackToAttempt saves and returns ref', () => {
        const pack = makePack(3);
        const profile = (0, context_profiles_1.getProfile)('execute');
        const quality = (0, context_pack_builder_1.scorePackQuality)(pack, profile);
        const ref = (0, context_pack_store_1.linkPackToAttempt)(tmpDir, 'run-1', 'attempt-1', pack, quality);
        strict_1.default.ok(ref.ref_id.startsWith('ref-'));
        strict_1.default.equal(ref.attempt_id, 'attempt-1');
        strict_1.default.equal(ref.work_item_id, 'T1');
        strict_1.default.equal(ref.artifacts_used.length, 3);
    });
    (0, node_test_1.test)('getPackRefForAttempt retrieves saved ref', () => {
        const pack = makePack(2);
        const quality = (0, context_pack_builder_1.scorePackQuality)(pack, (0, context_profiles_1.getProfile)('verify'));
        (0, context_pack_store_1.linkPackToAttempt)(tmpDir, 'run-2', 'attempt-2', pack, quality);
        const loaded = (0, context_pack_store_1.getPackRefForAttempt)(tmpDir, 'run-2', 'attempt-2');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.attempt_id, 'attempt-2');
    });
    (0, node_test_1.test)('getPackRefForAttempt returns null for unknown attempt', () => {
        const result = (0, context_pack_store_1.getPackRefForAttempt)(tmpDir, 'run-x', 'no-such-attempt');
        strict_1.default.equal(result, null);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
