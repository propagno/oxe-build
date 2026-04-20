"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ci_checks_1 = require("../src/delivery/ci-checks");
const branch_manager_1 = require("../src/delivery/branch-manager");
const pr_manager_1 = require("../src/delivery/pr-manager");
const promotion_pipeline_1 = require("../src/delivery/promotion-pipeline");
const delivery_records_1 = require("../src/delivery/delivery-records");
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function tmpDir() {
    return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-delivery-'));
}
function setupOxeDir(root, sessionId = null) {
    const base = sessionId ? path_1.default.join(root, '.oxe', sessionId) : path_1.default.join(root, '.oxe');
    fs_1.default.mkdirSync(path_1.default.join(base, 'execution'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(base, 'verification'), { recursive: true });
    return base;
}
(0, node_test_1.describe)('CI Checks — planConsistencyCheck', () => {
    (0, node_test_1.it)('skips when no ACTIVE-RUN.json', async () => {
        const root = tmpDir();
        const res = await ci_checks_1.planConsistencyCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'skip');
    });
    (0, node_test_1.it)('fails when run_id missing', async () => {
        const root = tmpDir();
        setupOxeDir(root);
        fs_1.default.writeFileSync(path_1.default.join(root, '.oxe', 'ACTIVE-RUN.json'), JSON.stringify({ compiled_graph: {} }));
        const res = await ci_checks_1.planConsistencyCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'fail');
    });
    (0, node_test_1.it)('passes with valid ACTIVE-RUN.json', async () => {
        const root = tmpDir();
        setupOxeDir(root);
        fs_1.default.writeFileSync(path_1.default.join(root, '.oxe', 'ACTIVE-RUN.json'), JSON.stringify({ run_id: 'r-001', compiled_graph: { nodes: {}, metadata: {} } }));
        const res = await ci_checks_1.planConsistencyCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'pass');
    });
});
(0, node_test_1.describe)('CI Checks — verifyAcceptanceCheck', () => {
    (0, node_test_1.it)('skips when no VERIFY.md', async () => {
        const root = tmpDir();
        const res = await ci_checks_1.verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'skip');
    });
    (0, node_test_1.it)('fails when VERIFY.md has fail lines', async () => {
        const root = tmpDir();
        setupOxeDir(root);
        fs_1.default.writeFileSync(path_1.default.join(root, '.oxe', 'VERIFY.md'), '✗ FAIL criterion A\n✓ PASS criterion B\n');
        const res = await ci_checks_1.verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'fail');
    });
    (0, node_test_1.it)('passes when VERIFY.md has only pass lines', async () => {
        const root = tmpDir();
        setupOxeDir(root);
        fs_1.default.writeFileSync(path_1.default.join(root, '.oxe', 'VERIFY.md'), '✓ PASS criterion A\n✓ PASS criterion B\n');
        const res = await ci_checks_1.verifyAcceptanceCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'pass');
    });
});
(0, node_test_1.describe)('CI Checks — policyCheck', () => {
    (0, node_test_1.it)('passes when no GATES.json', async () => {
        const root = tmpDir();
        const res = await ci_checks_1.policyCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'pass');
    });
    (0, node_test_1.it)('fails when pending gates exist', async () => {
        const root = tmpDir();
        fs_1.default.mkdirSync(path_1.default.join(root, '.oxe', 'execution'), { recursive: true });
        const gates = [{ gate_id: 'g1', scope: 'work_item:t1', status: 'pending' }];
        fs_1.default.writeFileSync(path_1.default.join(root, '.oxe', 'execution', 'GATES.json'), JSON.stringify(gates));
        const res = await ci_checks_1.policyCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'fail');
    });
});
(0, node_test_1.describe)('CI Checks — securityBaselineCheck', () => {
    (0, node_test_1.it)('skips when no evidence store provided', async () => {
        const root = tmpDir();
        const res = await ci_checks_1.securityBaselineCheck.run({ projectRoot: root, sessionId: null });
        strict_1.default.equal(res.status, 'skip');
    });
    (0, node_test_1.it)('skips when no evidence directory for run', async () => {
        const root = tmpDir();
        const res = await ci_checks_1.securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-001', evidenceStore: {} });
        strict_1.default.equal(res.status, 'skip');
    });
    (0, node_test_1.it)('detects secret patterns', async () => {
        const root = tmpDir();
        const runDir = path_1.default.join(root, '.oxe', 'evidence', 'runs', 'r-001');
        fs_1.default.mkdirSync(runDir, { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(runDir, 'output.txt'), 'api_key: "supersecretvalue123"');
        const res = await ci_checks_1.securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-001', evidenceStore: {} });
        strict_1.default.equal(res.status, 'fail');
    });
    (0, node_test_1.it)('passes when no secrets found', async () => {
        const root = tmpDir();
        const runDir = path_1.default.join(root, '.oxe', 'evidence', 'runs', 'r-002');
        fs_1.default.mkdirSync(runDir, { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(runDir, 'output.txt'), 'All tests passed.');
        const res = await ci_checks_1.securityBaselineCheck.run({ projectRoot: root, sessionId: null, runId: 'r-002', evidenceStore: {} });
        strict_1.default.equal(res.status, 'pass');
    });
});
(0, node_test_1.describe)('CI Checks — runCIChecks + summarize', () => {
    (0, node_test_1.it)('runs all default checks', async () => {
        const root = tmpDir();
        const results = await (0, ci_checks_1.runCIChecks)({ projectRoot: root, sessionId: null });
        strict_1.default.equal(results.length, ci_checks_1.OXE_CI_CHECKS.length);
    });
    (0, node_test_1.it)('summarizeCIResults counts correctly', () => {
        const results = [
            { check: 'a', status: 'pass', message: '' },
            { check: 'b', status: 'fail', message: '' },
            { check: 'c', status: 'skip', message: '' },
        ];
        const summary = (0, ci_checks_1.summarizeCIResults)(results);
        strict_1.default.equal(summary.total, 3);
        strict_1.default.equal(summary.pass, 1);
        strict_1.default.equal(summary.fail, 1);
        strict_1.default.equal(summary.skip, 1);
        strict_1.default.equal(summary.allPassed, false);
    });
});
(0, node_test_1.describe)('BranchManager', () => {
    (0, node_test_1.it)('instantiates without throwing', () => {
        const bm = new branch_manager_1.BranchManager(process.cwd());
        strict_1.default.ok(bm);
    });
    (0, node_test_1.it)('currentBranch returns a string', () => {
        const bm = new branch_manager_1.BranchManager(process.cwd());
        const branch = bm.currentBranch();
        strict_1.default.equal(typeof branch, 'string');
        strict_1.default.ok(branch.length > 0);
    });
    (0, node_test_1.it)('currentCommit returns a string', () => {
        const bm = new branch_manager_1.BranchManager(process.cwd());
        const commit = bm.currentCommit();
        strict_1.default.equal(typeof commit, 'string');
    });
    (0, node_test_1.it)('listOxeBranches returns array', () => {
        const bm = new branch_manager_1.BranchManager(process.cwd());
        const branches = bm.listOxeBranches();
        strict_1.default.ok(Array.isArray(branches));
    });
});
(0, node_test_1.describe)('PRManager', () => {
    (0, node_test_1.it)('instantiates without throwing', () => {
        const pm = new pr_manager_1.PRManager(process.cwd());
        strict_1.default.ok(pm);
    });
    (0, node_test_1.it)('isAvailable returns boolean', () => {
        const pm = new pr_manager_1.PRManager(process.cwd());
        strict_1.default.equal(typeof pm.isAvailable(), 'boolean');
    });
});
(0, node_test_1.describe)('PromotionPipeline', () => {
    function runResult(overrides = {}) {
        return {
            run_id: 'run-delivery',
            status: 'completed',
            completed: ['T1'],
            failed: [],
            blocked: [],
            ...overrides,
        };
    }
    (0, node_test_1.it)('records local commit separately from promotion', () => {
        const root = tmpDir();
        const pipeline = new promotion_pipeline_1.PromotionPipeline(root, new branch_manager_1.BranchManager(process.cwd()), new pr_manager_1.PRManager(process.cwd()));
        const record = pipeline.recordLocalCommit(runResult(), null, null, {
            commitMessage: 'feat(runtime): close enterprise loop',
            commitSha: 'abc123',
            summaryPath: '.oxe/COMMIT-SUMMARY.md',
        });
        strict_1.default.equal(record.status, 'committed');
        strict_1.default.equal(record.message, 'feat(runtime): close enterprise loop');
        const stored = (0, delivery_records_1.loadCommitRecord)(root, 'run-delivery');
        strict_1.default.ok(stored);
        strict_1.default.equal(stored.commit_sha, 'abc123');
    });
    (0, node_test_1.it)('blocks promotion when pending gates exist', async () => {
        const root = tmpDir();
        const pipeline = new promotion_pipeline_1.PromotionPipeline(root, new branch_manager_1.BranchManager(process.cwd()), new pr_manager_1.PRManager(process.cwd()), new promotion_pipeline_1.MergeGateEvaluator());
        const promotion = await pipeline.promote(runResult(), null, null, {}, [{ gate_id: 'gate-1', scope: 'critical_mutation', run_id: 'run-delivery', work_item_id: 'T1', action: 'generate_patch', requested_at: new Date().toISOString(), context: { description: 'Approve', evidence_refs: [], risks: [] }, status: 'pending' }]);
        strict_1.default.equal(promotion.status, 'blocked');
        const stored = (0, delivery_records_1.loadPromotionRecord)(root, 'run-delivery');
        strict_1.default.ok(stored);
        strict_1.default.equal(stored.status, 'blocked');
    });
});
