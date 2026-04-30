"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvidenceStore = void 0;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const EXT_MAP = {
    diff: 'patch',
    stdout: 'txt',
    stderr: 'txt',
    junit_xml: 'xml',
    coverage: 'json',
    screenshot: 'png',
    trace: 'json',
    log: 'txt',
    security_report: 'json',
    api_output: 'json',
    summary: 'json',
};
class EvidenceStore {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    evidenceDir(runId, workItemId, attemptNumber) {
        return path_1.default.join(this.projectRoot, '.oxe', 'evidence', 'runs', runId, workItemId, `attempt-${attemptNumber}`);
    }
    indexPath(runId, workItemId, attemptNumber) {
        return path_1.default.join(this.evidenceDir(runId, workItemId, attemptNumber), 'index.json');
    }
    readIndex(runId, workItemId, attemptNumber) {
        const p = this.indexPath(runId, workItemId, attemptNumber);
        if (!fs_1.default.existsSync(p))
            return [];
        try {
            return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
        }
        catch {
            return [];
        }
    }
    writeIndex(runId, workItemId, attemptNumber, items) {
        fs_1.default.writeFileSync(this.indexPath(runId, workItemId, attemptNumber), JSON.stringify(items, null, 2), 'utf8');
    }
    async collect(type, content, opts) {
        const { work_item_id, run_id, attempt_number } = opts;
        const dir = this.evidenceDir(run_id, work_item_id, attempt_number);
        fs_1.default.mkdirSync(dir, { recursive: true });
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        const checksum = crypto_1.default.createHash('sha256').update(buf).digest('hex').slice(0, 16);
        const ext = EXT_MAP[type] ?? 'bin';
        const existing = this.readIndex(run_id, work_item_id, attempt_number);
        const seq = existing.filter((e) => e.type === type).length + 1;
        const filename = `${type}-${seq}.${ext}`;
        const filePath = path_1.default.join(dir, filename);
        fs_1.default.writeFileSync(filePath, buf);
        const evidence = {
            evidence_id: `ev-${run_id}-${work_item_id}-a${attempt_number}-${type}-${seq}`,
            attempt_id: `${work_item_id}-a${attempt_number}`,
            type,
            path: path_1.default.relative(this.projectRoot, filePath),
            checksum,
            created_at: new Date().toISOString(),
        };
        this.writeIndex(run_id, work_item_id, attempt_number, [...existing, evidence]);
        return evidence;
    }
    async list(opts) {
        return this.readIndex(opts.run_id, opts.work_item_id, opts.attempt_number);
    }
    async get(evidenceId, opts) {
        const items = this.readIndex(opts.run_id, opts.work_item_id, opts.attempt_number);
        const ev = items.find((e) => e.evidence_id === evidenceId);
        if (!ev)
            return null;
        const absPath = path_1.default.join(this.projectRoot, ev.path);
        if (!fs_1.default.existsSync(absPath))
            return null;
        return { evidence: ev, content: fs_1.default.readFileSync(absPath) };
    }
    async listByRun(runId) {
        const runDir = path_1.default.join(this.projectRoot, '.oxe', 'evidence', 'runs', runId);
        if (!fs_1.default.existsSync(runDir))
            return [];
        const all = [];
        for (const workItem of fs_1.default.readdirSync(runDir)) {
            const wiDir = path_1.default.join(runDir, workItem);
            for (const attempt of fs_1.default.readdirSync(wiDir)) {
                const indexPath = path_1.default.join(wiDir, attempt, 'index.json');
                if (fs_1.default.existsSync(indexPath)) {
                    try {
                        const items = JSON.parse(fs_1.default.readFileSync(indexPath, 'utf8'));
                        all.push(...items);
                    }
                    catch {
                        // skip corrupt index
                    }
                }
            }
        }
        return all;
    }
}
exports.EvidenceStore = EvidenceStore;
