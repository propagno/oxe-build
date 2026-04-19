import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  savePack,
  loadPack,
  markStale,
  isStale,
  diffPacks,
  listPackMeta,
} from '../src/context/context-pack-store';
import type { ContextPack } from '../src/context/context-pack-builder';

function makePack(workItemId: string, overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    work_item_id: workItemId,
    artifacts: [
      { id: 'a1', kind: 'evidence', content: 'test output passed', relevanceScore: 0.9, tags: ['unit'] },
      { id: 'a2', kind: 'lesson', content: 'always write tests first', relevanceScore: 0.6, tags: ['tdd'] },
    ],
    total_artifacts_considered: 5,
    redundancy_removed: 3,
    built_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ContextPackStore', () => {
  let tmpDir: string;

  test('setup', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cpstore-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  test('savePack and loadPack round-trip', () => {
    const pack = makePack('T1');
    const meta = savePack(tmpDir, 'run-1', pack);
    assert.equal(meta.work_item_id, 'T1');
    assert.equal(meta.artifact_count, 2);
    assert.ok(meta.estimated_tokens > 0);

    const loaded = loadPack(tmpDir, 'run-1', 'T1');
    assert.ok(loaded !== null);
    assert.equal(loaded!.work_item_id, 'T1');
    assert.equal(loaded!.artifacts.length, 2);
  });

  test('loadPack returns null for unknown workItem', () => {
    assert.equal(loadPack(tmpDir, 'run-1', 'UNKNOWN'), null);
  });

  test('markStale and isStale work correctly', () => {
    const pack = makePack('T2');
    savePack(tmpDir, 'run-2', pack);
    assert.equal(isStale(tmpDir, 'run-2', 'T2'), false);

    markStale(tmpDir, 'run-2', 'T2', 'state changed after T1 completed');
    assert.equal(isStale(tmpDir, 'run-2', 'T2'), true);
  });

  test('isStale returns false for unknown workItem', () => {
    assert.equal(isStale(tmpDir, 'run-x', 'NO_SUCH'), false);
  });

  test('listPackMeta returns all saved packs', () => {
    const runId = 'run-list';
    savePack(tmpDir, runId, makePack('TA'));
    savePack(tmpDir, runId, makePack('TB'));
    const metas = listPackMeta(tmpDir, runId);
    assert.equal(metas.length, 2);
    const ids = metas.map((m) => m.work_item_id);
    assert.ok(ids.includes('TA'));
    assert.ok(ids.includes('TB'));
  });

  test('listPackMeta returns empty array for unknown run', () => {
    assert.deepEqual(listPackMeta(tmpDir, 'no-such-run'), []);
  });

  test('savePack updates existing entry in index', () => {
    const runId = 'run-update';
    const pack1 = makePack('T3');
    savePack(tmpDir, runId, pack1);

    const pack2 = makePack('T3', {
      artifacts: [{ id: 'a1', kind: 'evidence', content: 'updated', relevanceScore: 1.0, tags: [] }],
    });
    savePack(tmpDir, runId, pack2);

    const metas = listPackMeta(tmpDir, runId);
    assert.equal(metas.length, 1);
    assert.equal(metas[0].artifact_count, 1);
  });

  test('diffPacks detects added, removed, score_changed', () => {
    const before: ContextPack = makePack('T4');
    const after: ContextPack = {
      ...makePack('T4'),
      artifacts: [
        { id: 'a1', kind: 'evidence', content: 'test output passed', relevanceScore: 0.5, tags: [] },
        { id: 'a3', kind: 'summary', content: 'run progress 2/3', relevanceScore: 0.8, tags: [] },
      ],
    };

    const diff = diffPacks(before, after);
    assert.ok(diff.added.includes('a3'));
    assert.ok(diff.removed.includes('a2'));
    assert.equal(diff.score_changed.length, 1);
    assert.equal(diff.score_changed[0].id, 'a1');
    assert.ok(diff.score_changed[0].before > diff.score_changed[0].after);
  });

  test('diffPacks returns empty diff for identical packs', () => {
    const pack = makePack('T5');
    const diff = diffPacks(pack, pack);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.score_changed.length, 0);
  });

  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
