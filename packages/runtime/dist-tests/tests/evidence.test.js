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
const evidence_store_1 = require("../src/evidence/evidence-store");
function tmpDir() {
    return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-ev-test-'));
}
const opts = { work_item_id: 'T1', run_id: 'r001', attempt_number: 1 };
(0, node_test_1.describe)('EvidenceStore', () => {
    let dir;
    (0, node_test_1.test)('setup', () => { dir = tmpDir(); });
    (0, node_test_1.test)('collect creates file and returns Evidence record', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const ev = await store.collect('stdout', 'hello world', opts);
        strict_1.default.ok(ev.evidence_id.includes('r001'));
        strict_1.default.ok(ev.evidence_id.includes('T1'));
        strict_1.default.equal(ev.type, 'stdout');
        strict_1.default.ok(ev.checksum !== null && ev.checksum.length === 16);
        strict_1.default.ok(fs_1.default.existsSync(path_1.default.join(dir, ev.path)));
    });
    (0, node_test_1.test)('collect writes correct content to disk', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const content = JSON.stringify({ exit_code: 0, tests: 42 });
        const ev = await store.collect('summary', content, opts);
        const onDisk = fs_1.default.readFileSync(path_1.default.join(dir, ev.path), 'utf8');
        strict_1.default.equal(onDisk, content);
    });
    (0, node_test_1.test)('list returns all evidence for an attempt', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const o = { ...opts, run_id: 'r002' };
        await store.collect('diff', '--- a\n+++ b', o);
        await store.collect('stdout', 'test output', o);
        const items = await store.list(o);
        strict_1.default.equal(items.length, 2);
    });
    (0, node_test_1.test)('list returns empty for unknown attempt', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const items = await store.list({ ...opts, run_id: 'r-unknown' });
        strict_1.default.deepEqual(items, []);
    });
    (0, node_test_1.test)('get retrieves content by evidence_id', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const o = { ...opts, run_id: 'r003' };
        const ev = await store.collect('log', 'build output', o);
        const result = await store.get(ev.evidence_id, o);
        strict_1.default.ok(result !== null);
        strict_1.default.equal(result.content.toString('utf8'), 'build output');
    });
    (0, node_test_1.test)('get returns null for unknown evidence_id', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const result = await store.get('ev-nonexistent', opts);
        strict_1.default.equal(result, null);
    });
    (0, node_test_1.test)('multiple collects of same type get sequenced filenames', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const o = { ...opts, run_id: 'r004' };
        const ev1 = await store.collect('stdout', 'first', o);
        const ev2 = await store.collect('stdout', 'second', o);
        strict_1.default.notEqual(ev1.path, ev2.path);
        strict_1.default.ok(ev1.path.endsWith('stdout.txt'));
        strict_1.default.ok(ev2.path.endsWith('stdout-2.txt'));
    });
    (0, node_test_1.test)('binary content stored without corruption', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const o = { ...opts, run_id: 'r005' };
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const ev = await store.collect('screenshot', buf, o);
        const result = await store.get(ev.evidence_id, o);
        strict_1.default.ok(result !== null);
        strict_1.default.deepEqual(result.content, buf);
    });
    (0, node_test_1.test)('listByRun aggregates across work items', async () => {
        const store = new evidence_store_1.EvidenceStore(dir);
        const runId = 'r006';
        await store.collect('stdout', 'T1 output', { work_item_id: 'T1', run_id: runId, attempt_number: 1 });
        await store.collect('diff', 'T2 diff', { work_item_id: 'T2', run_id: runId, attempt_number: 1 });
        const all = await store.listByRun(runId);
        strict_1.default.equal(all.length, 2);
        strict_1.default.ok(all.some((e) => e.type === 'stdout'));
        strict_1.default.ok(all.some((e) => e.type === 'diff'));
    });
    (0, node_test_1.test)('cleanup', () => { fs_1.default.rmSync(dir, { recursive: true, force: true }); });
});
