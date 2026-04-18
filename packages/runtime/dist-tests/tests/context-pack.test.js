"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const context_pack_builder_1 = require("../src/context/context-pack-builder");
const run_state_reducer_1 = require("../src/reducers/run-state-reducer");
function makeWorkItem(overrides = {}) {
    return {
        work_item_id: 'wi-001',
        run_id: 'r-001',
        title: 'Add authentication middleware',
        type: 'task',
        depends_on: [],
        mutation_scope: ['src/auth', 'src/middleware'],
        policy_ref: null,
        verify_ref: [],
        status: 'ready',
        workspace_strategy: 'inplace',
        ...overrides,
    };
}
function makeEvidence(id, type = 'stdout') {
    return {
        evidence_id: id,
        attempt_id: 'a-001',
        type,
        path: `.oxe/evidence/${id}.txt`,
        checksum: 'abc123',
        created_at: new Date().toISOString(),
    };
}
(0, node_test_1.describe)('ContextPackBuilder — basic build', () => {
    (0, node_test_1.it)('returns a ContextPack with metadata', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder();
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const pack = builder.buildLightweight(makeWorkItem(), state, []);
        strict_1.default.equal(pack.work_item_id, 'wi-001');
        strict_1.default.ok(typeof pack.built_at === 'string');
        strict_1.default.ok(typeof pack.total_artifacts_considered === 'number');
        strict_1.default.ok(typeof pack.redundancy_removed === 'number');
        strict_1.default.ok(Array.isArray(pack.artifacts));
    });
    (0, node_test_1.it)('includes run summary when completed items exist', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder();
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        state.completedWorkItems.add('wi-000');
        const pack = builder.buildLightweight(makeWorkItem(), state, []);
        const hasSummary = pack.artifacts.some((a) => a.kind === 'summary');
        strict_1.default.ok(hasSummary);
    });
});
(0, node_test_1.describe)('ContextPackBuilder — evidence scoring', () => {
    (0, node_test_1.it)('includes evidence in artifacts', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder();
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const ev = makeEvidence('src-auth-test', 'junit_xml');
        const contents = new Map([['src-auth-test', 'All auth tests passed.']]);
        const pack = builder.build(makeWorkItem(), state, [ev], contents, []);
        const evidenceArtifacts = pack.artifacts.filter((a) => a.kind === 'evidence');
        strict_1.default.equal(evidenceArtifacts.length, 1);
    });
    (0, node_test_1.it)('scores evidence with scope match higher', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder();
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const evRelevant = makeEvidence('src-auth-relevant', 'junit_xml');
        const evIrrelevant = makeEvidence('unrelated-thing', 'stdout');
        const contents = new Map([
            ['src-auth-relevant', 'Auth module tested successfully.'],
            ['unrelated-thing', 'Some other output.'],
        ]);
        const pack = builder.build(makeWorkItem(), state, [evRelevant, evIrrelevant], contents, []);
        const scores = pack.artifacts.filter((a) => a.kind === 'evidence').map((a) => a.relevanceScore);
        // All evidence collected, first should be higher relevance
        strict_1.default.ok(pack.artifacts.length >= 1);
        // Check descending order
        for (let i = 1; i < scores.length; i++) {
            strict_1.default.ok(scores[i - 1] >= scores[i]);
        }
    });
});
(0, node_test_1.describe)('ContextPackBuilder — lesson scoring', () => {
    (0, node_test_1.it)('includes lessons with tag overlap', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder();
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const lesson = {
            lesson_id: 'l-001',
            title: 'Auth patterns',
            tags: ['auth', 'middleware'],
            content: 'Use JWT middleware for authentication.',
        };
        const pack = builder.buildLightweight(makeWorkItem(), state, [lesson]);
        const lessonArtifacts = pack.artifacts.filter((a) => a.kind === 'lesson');
        strict_1.default.equal(lessonArtifacts.length, 1);
        strict_1.default.ok(lessonArtifacts[0].relevanceScore > 0.3);
    });
});
(0, node_test_1.describe)('ContextPackBuilder — deduplication', () => {
    (0, node_test_1.it)('removes nearly-identical artifacts', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder({ deduplicateThreshold: 0.7 });
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const content = 'All auth middleware tests passed successfully and authentication is working.';
        const ev1 = makeEvidence('ev-001', 'stdout');
        const ev2 = makeEvidence('ev-002', 'stdout');
        const contents = new Map([
            ['ev-001', content],
            ['ev-002', content + ' (same)'],
        ]);
        const pack = builder.build(makeWorkItem(), state, [ev1, ev2], contents, []);
        strict_1.default.ok(pack.redundancy_removed >= 1);
        strict_1.default.ok(pack.artifacts.filter((a) => a.kind === 'evidence').length < 2);
    });
});
(0, node_test_1.describe)('ContextPackBuilder — token budget', () => {
    (0, node_test_1.it)('respects maxTokensEstimate', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder({ maxTokensEstimate: 20 });
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const ev = makeEvidence('big-ev', 'stdout');
        const bigContent = 'A'.repeat(500);
        const contents = new Map([['big-ev', bigContent]]);
        const pack = builder.build(makeWorkItem(), state, [ev], contents, []);
        const totalTokens = pack.artifacts.reduce((sum, a) => sum + Math.ceil(a.content.length / 4), 0);
        strict_1.default.ok(totalTokens <= 20);
    });
    (0, node_test_1.it)('respects maxArtifacts', () => {
        const builder = new context_pack_builder_1.ContextPackBuilder({ maxArtifacts: 2 });
        const state = (0, run_state_reducer_1.createEmptyRunState)();
        const evidences = Array.from({ length: 10 }, (_, i) => makeEvidence(`ev-${i}`, 'stdout'));
        const contents = new Map(evidences.map((e) => [e.evidence_id, `Content for ${e.evidence_id}`]));
        const pack = builder.build(makeWorkItem(), state, evidences, contents, []);
        strict_1.default.ok(pack.artifacts.length <= 2);
    });
});
