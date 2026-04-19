"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePolicyPack = savePolicyPack;
exports.loadPolicyPack = loadPolicyPack;
exports.listPolicyPacks = listPolicyPacks;
exports.applyPolicyPack = applyPolicyPack;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function packDir(projectRoot) {
    return path_1.default.join(projectRoot, '.oxe', 'policy-packs');
}
function packFilePath(projectRoot, packId) {
    return path_1.default.join(packDir(projectRoot), `${packId}.json`);
}
function savePolicyPack(projectRoot, pack) {
    const dir = packDir(projectRoot);
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(packFilePath(projectRoot, pack.pack_id), JSON.stringify(pack, null, 2), 'utf8');
}
function loadPolicyPack(projectRoot, packId) {
    const p = packFilePath(projectRoot, packId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function listPolicyPacks(projectRoot) {
    const dir = packDir(projectRoot);
    if (!fs_1.default.existsSync(dir))
        return [];
    return fs_1.default
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
        try {
            return JSON.parse(fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf8'));
        }
        catch {
            return null;
        }
    })
        .filter((p) => p !== null);
}
function applyPolicyPack(engine, pack) {
    let result = engine.withGuardrail(pack.guardrail);
    for (const rule of pack.policies) {
        result = result.withRule(rule);
    }
    return result;
}
