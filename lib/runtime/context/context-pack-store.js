"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePack = savePack;
exports.loadPack = loadPack;
exports.markStale = markStale;
exports.isStale = isStale;
exports.diffPacks = diffPacks;
exports.listPackMeta = listPackMeta;
exports.linkPackToAttempt = linkPackToAttempt;
exports.getPackRefForAttempt = getPackRefForAttempt;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function packPath(projectRoot, runId, workItemId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, `context-pack-${workItemId}.json`);
}
function metaIndexPath(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, 'context-packs.index.json');
}
function estimateTokens(pack) {
    return Math.ceil(pack.artifacts.reduce((sum, a) => sum + a.content.length, 0) / 4);
}
function savePack(projectRoot, runId, pack) {
    const p = packPath(projectRoot, runId, pack.work_item_id);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(pack, null, 2), 'utf8');
    const meta = {
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
function loadPack(projectRoot, runId, workItemId) {
    const p = packPath(projectRoot, runId, workItemId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function markStale(projectRoot, runId, workItemId, reason) {
    const index = loadMetaIndex(projectRoot, runId);
    const meta = index.find((m) => m.work_item_id === workItemId);
    if (!meta)
        return;
    meta.stale = true;
    meta.stale_reason = reason;
    saveMetaIndex(projectRoot, runId, index);
}
function isStale(projectRoot, runId, workItemId) {
    const index = loadMetaIndex(projectRoot, runId);
    return index.find((m) => m.work_item_id === workItemId)?.stale ?? false;
}
function diffPacks(before, after) {
    const beforeIds = new Set(before.artifacts.map((a) => a.id));
    const afterIds = new Set(after.artifacts.map((a) => a.id));
    const beforeMap = new Map(before.artifacts.map((a) => [a.id, a]));
    const afterMap = new Map(after.artifacts.map((a) => [a.id, a]));
    const added = [...afterIds].filter((id) => !beforeIds.has(id));
    const removed = [...beforeIds].filter((id) => !afterIds.has(id));
    const score_changed = [];
    for (const id of afterIds) {
        if (!beforeIds.has(id))
            continue;
        const bScore = beforeMap.get(id).relevanceScore;
        const aScore = afterMap.get(id).relevanceScore;
        if (Math.abs(bScore - aScore) > 0.05) {
            score_changed.push({ id, before: bScore, after: aScore });
        }
    }
    return { added, removed, score_changed };
}
function listPackMeta(projectRoot, runId) {
    return loadMetaIndex(projectRoot, runId);
}
function packRefPath(projectRoot, runId, attemptId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId, `context-ref-${attemptId}.json`);
}
function linkPackToAttempt(projectRoot, runId, attemptId, pack, quality) {
    const ref = {
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
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(ref, null, 2), 'utf8');
    return ref;
}
function getPackRefForAttempt(projectRoot, runId, attemptId) {
    const p = packRefPath(projectRoot, runId, attemptId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function loadMetaIndex(projectRoot, runId) {
    const p = metaIndexPath(projectRoot, runId);
    if (!fs_1.default.existsSync(p))
        return [];
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return [];
    }
}
function saveMetaIndex(projectRoot, runId, index) {
    const p = metaIndexPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(index, null, 2), 'utf8');
}
function updateMetaIndex(projectRoot, runId, meta) {
    const index = loadMetaIndex(projectRoot, runId);
    const idx = index.findIndex((m) => m.work_item_id === meta.work_item_id);
    if (idx >= 0)
        index[idx] = meta;
    else
        index.push(meta);
    saveMetaIndex(projectRoot, runId, index);
}
