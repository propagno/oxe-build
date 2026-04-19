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
const context_pack_store_1 = require("../src/context/context-pack-store");
function makePack(workItemId, overrides = {}) {
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
(0, node_test_1.describe)('ContextPackStore', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-cpstore-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('savePack and loadPack round-trip', () => {
        const pack = makePack('T1');
        const meta = (0, context_pack_store_1.savePack)(tmpDir, 'run-1', pack);
        strict_1.default.equal(meta.work_item_id, 'T1');
        strict_1.default.equal(meta.artifact_count, 2);
        strict_1.default.ok(meta.estimated_tokens > 0);
        const loaded = (0, context_pack_store_1.loadPack)(tmpDir, 'run-1', 'T1');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.work_item_id, 'T1');
        strict_1.default.equal(loaded.artifacts.length, 2);
    });
    (0, node_test_1.test)('loadPack returns null for unknown workItem', () => {
        strict_1.default.equal((0, context_pack_store_1.loadPack)(tmpDir, 'run-1', 'UNKNOWN'), null);
    });
    (0, node_test_1.test)('markStale and isStale work correctly', () => {
        const pack = makePack('T2');
        (0, context_pack_store_1.savePack)(tmpDir, 'run-2', pack);
        strict_1.default.equal((0, context_pack_store_1.isStale)(tmpDir, 'run-2', 'T2'), false);
        (0, context_pack_store_1.markStale)(tmpDir, 'run-2', 'T2', 'state changed after T1 completed');
        strict_1.default.equal((0, context_pack_store_1.isStale)(tmpDir, 'run-2', 'T2'), true);
    });
    (0, node_test_1.test)('isStale returns false for unknown workItem', () => {
        strict_1.default.equal((0, context_pack_store_1.isStale)(tmpDir, 'run-x', 'NO_SUCH'), false);
    });
    (0, node_test_1.test)('listPackMeta returns all saved packs', () => {
        const runId = 'run-list';
        (0, context_pack_store_1.savePack)(tmpDir, runId, makePack('TA'));
        (0, context_pack_store_1.savePack)(tmpDir, runId, makePack('TB'));
        const metas = (0, context_pack_store_1.listPackMeta)(tmpDir, runId);
        strict_1.default.equal(metas.length, 2);
        const ids = metas.map((m) => m.work_item_id);
        strict_1.default.ok(ids.includes('TA'));
        strict_1.default.ok(ids.includes('TB'));
    });
    (0, node_test_1.test)('listPackMeta returns empty array for unknown run', () => {
        strict_1.default.deepEqual((0, context_pack_store_1.listPackMeta)(tmpDir, 'no-such-run'), []);
    });
    (0, node_test_1.test)('savePack updates existing entry in index', () => {
        const runId = 'run-update';
        const pack1 = makePack('T3');
        (0, context_pack_store_1.savePack)(tmpDir, runId, pack1);
        const pack2 = makePack('T3', {
            artifacts: [{ id: 'a1', kind: 'evidence', content: 'updated', relevanceScore: 1.0, tags: [] }],
        });
        (0, context_pack_store_1.savePack)(tmpDir, runId, pack2);
        const metas = (0, context_pack_store_1.listPackMeta)(tmpDir, runId);
        strict_1.default.equal(metas.length, 1);
        strict_1.default.equal(metas[0].artifact_count, 1);
    });
    (0, node_test_1.test)('diffPacks detects added, removed, score_changed', () => {
        const before = makePack('T4');
        const after = {
            ...makePack('T4'),
            artifacts: [
                { id: 'a1', kind: 'evidence', content: 'test output passed', relevanceScore: 0.5, tags: [] },
                { id: 'a3', kind: 'summary', content: 'run progress 2/3', relevanceScore: 0.8, tags: [] },
            ],
        };
        const diff = (0, context_pack_store_1.diffPacks)(before, after);
        strict_1.default.ok(diff.added.includes('a3'));
        strict_1.default.ok(diff.removed.includes('a2'));
        strict_1.default.equal(diff.score_changed.length, 1);
        strict_1.default.equal(diff.score_changed[0].id, 'a1');
        strict_1.default.ok(diff.score_changed[0].before > diff.score_changed[0].after);
    });
    (0, node_test_1.test)('diffPacks returns empty diff for identical packs', () => {
        const pack = makePack('T5');
        const diff = (0, context_pack_store_1.diffPacks)(pack, pack);
        strict_1.default.equal(diff.added.length, 0);
        strict_1.default.equal(diff.removed.length, 0);
        strict_1.default.equal(diff.score_changed.length, 0);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
