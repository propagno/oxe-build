"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitRecordPath = commitRecordPath;
exports.promotionRecordPath = promotionRecordPath;
exports.saveCommitRecord = saveCommitRecord;
exports.loadCommitRecord = loadCommitRecord;
exports.savePromotionRecord = savePromotionRecord;
exports.loadPromotionRecord = loadPromotionRecord;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function runDir(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId);
}
function saveJson(filePath, payload) {
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}
function loadJson(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function commitRecordPath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'commit-record.json');
}
function promotionRecordPath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'promotion-record.json');
}
function saveCommitRecord(projectRoot, runId, record) {
    saveJson(commitRecordPath(projectRoot, runId), record);
}
function loadCommitRecord(projectRoot, runId) {
    return loadJson(commitRecordPath(projectRoot, runId));
}
function savePromotionRecord(projectRoot, runId, record) {
    saveJson(promotionRecordPath(projectRoot, runId), record);
}
function loadPromotionRecord(projectRoot, runId) {
    return loadJson(promotionRecordPath(projectRoot, runId));
}
