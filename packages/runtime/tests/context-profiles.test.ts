import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  DEFAULT_PROFILES,
  getProfile,
} from '../src/context/context-profiles';
import type { ContextDecisionType } from '../src/context/context-profiles';
import {
  ContextPackBuilder,
  scorePackQuality,
} from '../src/context/context-pack-builder';
import type { ContextPack } from '../src/context/context-pack-builder';
import {
  savePack,
  linkPackToAttempt,
  getPackRefForAttempt,
} from '../src/context/context-pack-store';
import { createEmptyRunState } from '../src/reducers/run-state-reducer';

function makeRunState() {
  return createEmptyRunState();
}

function makePack(artifactCount = 3): ContextPack {
  return {
    work_item_id: 'T1',
    artifacts: Array.from({ length: artifactCount }, (_, i) => ({
      id: `art-${i}`,
      kind: (i % 2 === 0 ? 'evidence' : 'lesson') as 'evidence' | 'lesson',
      content: `content for artifact ${i}`.repeat(10),
      relevanceScore: 0.7 + i * 0.05,
      tags: ['test'],
    })),
    total_artifacts_considered: artifactCount + 2,
    redundancy_removed: 2,
    built_at: new Date().toISOString(),
  };
}

describe('ContextProfiles', () => {
  test('all decision types have a default profile', () => {
    const types: ContextDecisionType[] = ['execute', 'verify', 'plan', 'review', 'debug', 'migration'];
    for (const t of types) {
      const p = DEFAULT_PROFILES[t];
      assert.ok(p, `missing profile for ${t}`);
      assert.equal(p.decision_type, t);
      assert.ok(p.quality_threshold >= 0 && p.quality_threshold <= 1);
      assert.ok(p.max_artifacts > 0);
      assert.ok(p.max_tokens > 0);
    }
  });

  test('getProfile returns the correct profile', () => {
    const p = getProfile('plan');
    assert.equal(p.decision_type, 'plan');
    assert.ok(p.artifact_kind_weights['lesson'] > p.artifact_kind_weights['evidence'],
      'plan profile should weight lessons more than evidence');
  });

  test('verify profile has higher quality threshold than execute', () => {
    assert.ok(DEFAULT_PROFILES.verify.quality_threshold > DEFAULT_PROFILES.execute.quality_threshold);
  });

  test('migration profile has more max_artifacts than execute', () => {
    assert.ok(DEFAULT_PROFILES.migration.max_artifacts >= DEFAULT_PROFILES.execute.max_artifacts);
  });
});

describe('scorePackQuality', () => {
  test('returns a valid ContextQualityScore', () => {
    const pack = makePack(4);
    const profile = getProfile('execute');
    const score = scorePackQuality(pack, profile);
    assert.ok(score.completeness >= 0 && score.completeness <= 1);
    assert.ok(score.relevance_mean >= 0 && score.relevance_mean <= 1);
    assert.ok(score.redundancy >= 0 && score.redundancy <= 1);
    assert.ok(score.recency_score >= 0 && score.recency_score <= 1);
    assert.ok(score.overall >= 0 && score.overall <= 1);
  });

  test('pack with no artifacts gets zero relevance_mean', () => {
    const pack: ContextPack = {
      work_item_id: 'T2',
      artifacts: [],
      total_artifacts_considered: 0,
      redundancy_removed: 0,
      built_at: new Date().toISOString(),
    };
    const score = scorePackQuality(pack, getProfile('execute'));
    assert.equal(score.relevance_mean, 0);
  });

  test('freshly built pack has high recency_score', () => {
    const pack = makePack(3);
    const score = scorePackQuality(pack, getProfile('execute'));
    assert.ok(score.recency_score > 0.9, `expected high recency, got ${score.recency_score}`);
  });

  test('old pack has zero recency_score', () => {
    const pack = makePack(2);
    pack.built_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const score = scorePackQuality(pack, getProfile('execute'));
    assert.equal(score.recency_score, 0);
  });
});

describe('filterByMutationScope', () => {
  const builder = new ContextPackBuilder();

  test('L2 tier returns all artifacts', () => {
    const artifacts = [
      { id: '1', kind: 'file' as const, content: 'x', relevanceScore: 0.5, tags: ['src/other/file.ts'] },
      { id: '2', kind: 'file' as const, content: 'x', relevanceScore: 0.5, tags: ['src/api/handler.ts'] },
    ];
    const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L2');
    assert.equal(result.length, 2);
  });

  test('L1 tier filters artifacts outside scope', () => {
    const artifacts = [
      { id: '1', kind: 'file' as const, content: 'x', relevanceScore: 0.5, tags: ['src/api/handler.ts'] },
      { id: '2', kind: 'file' as const, content: 'x', relevanceScore: 0.5, tags: ['src/other/handler.ts'] },
    ];
    const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L1');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('artifacts with no path tags are always kept', () => {
    const artifacts = [
      { id: '1', kind: 'evidence' as const, content: 'x', relevanceScore: 0.5, tags: ['junit', 'T1'] },
    ];
    const result = builder.filterByMutationScope(artifacts, ['src/api'], 'L0');
    assert.equal(result.length, 1);
  });
});

describe('ContextPackRef', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cpref-'));
  });

  test('linkPackToAttempt saves and returns ref', () => {
    const pack = makePack(3);
    const profile = getProfile('execute');
    const quality = scorePackQuality(pack, profile);
    const ref = linkPackToAttempt(tmpDir, 'run-1', 'attempt-1', pack, quality);
    assert.ok(ref.ref_id.startsWith('ref-'));
    assert.equal(ref.attempt_id, 'attempt-1');
    assert.equal(ref.work_item_id, 'T1');
    assert.equal(ref.artifacts_used.length, 3);
  });

  test('getPackRefForAttempt retrieves saved ref', () => {
    const pack = makePack(2);
    const quality = scorePackQuality(pack, getProfile('verify'));
    linkPackToAttempt(tmpDir, 'run-2', 'attempt-2', pack, quality);
    const loaded = getPackRefForAttempt(tmpDir, 'run-2', 'attempt-2');
    assert.ok(loaded !== null);
    assert.equal(loaded!.attempt_id, 'attempt-2');
  });

  test('getPackRefForAttempt returns null for unknown attempt', () => {
    const result = getPackRefForAttempt(tmpDir, 'run-x', 'no-such-attempt');
    assert.equal(result, null);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
