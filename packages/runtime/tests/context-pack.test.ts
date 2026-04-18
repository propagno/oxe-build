import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextPackBuilder } from '../src/context/context-pack-builder';
import { createEmptyRunState } from '../src/reducers/run-state-reducer';
import type { WorkItem } from '../src/models/work-item';
import type { Evidence } from '../src/models/evidence';
import type { LessonMetric } from '../src/context/context-pack-builder';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
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

function makeEvidence(id: string, type: Evidence['type'] = 'stdout'): Evidence {
  return {
    evidence_id: id,
    attempt_id: 'a-001',
    type,
    path: `.oxe/evidence/${id}.txt`,
    checksum: 'abc123',
    created_at: new Date().toISOString(),
  };
}

describe('ContextPackBuilder — basic build', () => {
  it('returns a ContextPack with metadata', () => {
    const builder = new ContextPackBuilder();
    const state = createEmptyRunState();
    const pack = builder.buildLightweight(makeWorkItem(), state, []);
    assert.equal(pack.work_item_id, 'wi-001');
    assert.ok(typeof pack.built_at === 'string');
    assert.ok(typeof pack.total_artifacts_considered === 'number');
    assert.ok(typeof pack.redundancy_removed === 'number');
    assert.ok(Array.isArray(pack.artifacts));
  });

  it('includes run summary when completed items exist', () => {
    const builder = new ContextPackBuilder();
    const state = createEmptyRunState();
    state.completedWorkItems.add('wi-000');
    const pack = builder.buildLightweight(makeWorkItem(), state, []);
    const hasSummary = pack.artifacts.some((a) => a.kind === 'summary');
    assert.ok(hasSummary);
  });
});

describe('ContextPackBuilder — evidence scoring', () => {
  it('includes evidence in artifacts', () => {
    const builder = new ContextPackBuilder();
    const state = createEmptyRunState();
    const ev = makeEvidence('src-auth-test', 'junit_xml');
    const contents = new Map([['src-auth-test', 'All auth tests passed.']]);
    const pack = builder.build(makeWorkItem(), state, [ev], contents, []);
    const evidenceArtifacts = pack.artifacts.filter((a) => a.kind === 'evidence');
    assert.equal(evidenceArtifacts.length, 1);
  });

  it('scores evidence with scope match higher', () => {
    const builder = new ContextPackBuilder();
    const state = createEmptyRunState();
    const evRelevant = makeEvidence('src-auth-relevant', 'junit_xml');
    const evIrrelevant = makeEvidence('unrelated-thing', 'stdout');
    const contents = new Map([
      ['src-auth-relevant', 'Auth module tested successfully.'],
      ['unrelated-thing', 'Some other output.'],
    ]);
    const pack = builder.build(makeWorkItem(), state, [evRelevant, evIrrelevant], contents, []);
    const scores = pack.artifacts.filter((a) => a.kind === 'evidence').map((a) => a.relevanceScore);
    // All evidence collected, first should be higher relevance
    assert.ok(pack.artifacts.length >= 1);
    // Check descending order
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i]);
    }
  });
});

describe('ContextPackBuilder — lesson scoring', () => {
  it('includes lessons with tag overlap', () => {
    const builder = new ContextPackBuilder();
    const state = createEmptyRunState();
    const lesson: LessonMetric = {
      lesson_id: 'l-001',
      title: 'Auth patterns',
      tags: ['auth', 'middleware'],
      content: 'Use JWT middleware for authentication.',
    };
    const pack = builder.buildLightweight(makeWorkItem(), state, [lesson]);
    const lessonArtifacts = pack.artifacts.filter((a) => a.kind === 'lesson');
    assert.equal(lessonArtifacts.length, 1);
    assert.ok(lessonArtifacts[0].relevanceScore > 0.3);
  });
});

describe('ContextPackBuilder — deduplication', () => {
  it('removes nearly-identical artifacts', () => {
    const builder = new ContextPackBuilder({ deduplicateThreshold: 0.7 });
    const state = createEmptyRunState();
    const content = 'All auth middleware tests passed successfully and authentication is working.';
    const ev1 = makeEvidence('ev-001', 'stdout');
    const ev2 = makeEvidence('ev-002', 'stdout');
    const contents = new Map([
      ['ev-001', content],
      ['ev-002', content + ' (same)'],
    ]);
    const pack = builder.build(makeWorkItem(), state, [ev1, ev2], contents, []);
    assert.ok(pack.redundancy_removed >= 1);
    assert.ok(pack.artifacts.filter((a) => a.kind === 'evidence').length < 2);
  });
});

describe('ContextPackBuilder — token budget', () => {
  it('respects maxTokensEstimate', () => {
    const builder = new ContextPackBuilder({ maxTokensEstimate: 20 });
    const state = createEmptyRunState();
    const ev = makeEvidence('big-ev', 'stdout');
    const bigContent = 'A'.repeat(500);
    const contents = new Map([['big-ev', bigContent]]);
    const pack = builder.build(makeWorkItem(), state, [ev], contents, []);
    const totalTokens = pack.artifacts.reduce((sum, a) => sum + Math.ceil(a.content.length / 4), 0);
    assert.ok(totalTokens <= 20);
  });

  it('respects maxArtifacts', () => {
    const builder = new ContextPackBuilder({ maxArtifacts: 2 });
    const state = createEmptyRunState();
    const evidences = Array.from({ length: 10 }, (_, i) => makeEvidence(`ev-${i}`, 'stdout'));
    const contents = new Map(evidences.map((e) => [e.evidence_id, `Content for ${e.evidence_id}`]));
    const pack = builder.build(makeWorkItem(), state, evidences, contents, []);
    assert.ok(pack.artifacts.length <= 2);
  });
});
