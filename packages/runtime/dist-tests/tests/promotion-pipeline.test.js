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
const promotion_pipeline_1 = require("../src/delivery/promotion-pipeline");
function okRun(runId = 'run-1') {
    return { run_id: runId, status: 'completed', completed: ['T1', 'T2'], failed: [], blocked: [] };
}
function failedRun() {
    return { run_id: 'run-fail', status: 'failed', completed: ['T1'], failed: ['T2'], blocked: [] };
}
function okManifest() {
    return {
        manifest_id: 'vm-abc',
        run_id: 'run-1',
        work_item_id: null,
        wave: null,
        granularity: 'run',
        profile: 'standard',
        compiled_at: new Date().toISOString(),
        checks: [],
        summary: { total: 2, pass: 2, fail: 0, skip: 0, error: 0, all_passed: true },
    };
}
function failManifest() {
    return { ...okManifest(), summary: { total: 2, pass: 1, fail: 1, skip: 0, error: 0, all_passed: false } };
}
function emptyLedger() {
    return { run_id: 'run-1', generated_at: new Date().toISOString(), risks: [] };
}
function criticalLedger() {
    return {
        run_id: 'run-1',
        generated_at: new Date().toISOString(),
        risks: [{
                risk_id: 'risk-1',
                work_item_id: null,
                check_id: 'c1',
                failure_class: 'deterministic',
                description: 'Critical test failure',
                severity: 'critical',
                mitigation: null,
            }],
    };
}
// Minimal mocks
function makeBranchManager(branch = 'oxe/test-branch') {
    return {
        currentBranch: () => branch,
    };
}
function makePRManager(success, url = 'https://github.com/owner/repo/pull/42') {
    return {
        createDraft: () => ({ success, url: success ? url : undefined, error: success ? undefined : 'gh error' }),
        isAvailable: () => true,
    };
}
(0, node_test_1.describe)('MergeGateEvaluator', () => {
    const evaluator = new promotion_pipeline_1.MergeGateEvaluator();
    (0, node_test_1.test)('approves clean run with passing manifest', () => {
        const report = evaluator.evaluate(okRun(), okManifest(), emptyLedger());
        strict_1.default.equal(report.verdict, 'approved');
        strict_1.default.equal(report.reasons.length, 0);
        strict_1.default.equal(report.blocking_risks.length, 0);
    });
    (0, node_test_1.test)('blocks run with failed tasks', () => {
        const report = evaluator.evaluate(failedRun(), okManifest(), emptyLedger());
        strict_1.default.equal(report.verdict, 'blocked');
        strict_1.default.ok(report.reasons.some((r) => r.includes('failed')));
    });
    (0, node_test_1.test)('blocks run with failed verification', () => {
        const report = evaluator.evaluate(okRun(), failManifest(), emptyLedger());
        strict_1.default.equal(report.verdict, 'blocked');
        strict_1.default.ok(report.reasons.some((r) => r.includes('Verification')));
    });
    (0, node_test_1.test)('blocks run with critical risks', () => {
        const report = evaluator.evaluate(okRun(), okManifest(), criticalLedger());
        strict_1.default.equal(report.verdict, 'blocked');
        strict_1.default.ok(report.blocking_risks.length > 0);
        strict_1.default.ok(report.blocking_risks[0].includes('CRITICAL'));
    });
    (0, node_test_1.test)('approves with null manifest and empty ledger', () => {
        const report = evaluator.evaluate(okRun(), null, null);
        strict_1.default.equal(report.verdict, 'approved');
    });
    (0, node_test_1.test)('blocks when run has blocked tasks', () => {
        const run = { run_id: 'r', status: 'failed', completed: [], failed: [], blocked: ['T3'] };
        const report = evaluator.evaluate(run, okManifest(), emptyLedger());
        strict_1.default.equal(report.verdict, 'blocked');
        strict_1.default.ok(report.reasons.some((r) => r.includes('blocked')));
    });
});
(0, node_test_1.describe)('PromotionPipeline', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-promo-test-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('buildPRBody includes run summary', () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        const body = pipeline.buildPRBody(okRun(), okManifest(), emptyLedger());
        strict_1.default.ok(body.includes('run-1'));
        strict_1.default.ok(body.includes('completed'));
        strict_1.default.ok(body.includes('Verification'));
    });
    (0, node_test_1.test)('buildPRBody includes residual risks when present', () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        const body = pipeline.buildPRBody(okRun(), okManifest(), criticalLedger());
        strict_1.default.ok(body.includes('Residual Risks'));
        strict_1.default.ok(body.includes('Critical test failure'));
    });
    (0, node_test_1.test)('promote returns blocked when gate verdict is blocked', async () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        const link = await pipeline.promote(failedRun(), okManifest(), emptyLedger());
        strict_1.default.equal(link.status, 'blocked');
        strict_1.default.equal(link.pr_url, null);
    });
    (0, node_test_1.test)('promote creates PR for approved run', async () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        const link = await pipeline.promote(okRun('run-approved'), okManifest(), emptyLedger());
        strict_1.default.equal(link.status, 'open');
        strict_1.default.ok(link.pr_url !== null);
        strict_1.default.ok(link.pr_url.includes('github.com'));
    });
    (0, node_test_1.test)('promote returns blocked when gh fails', async () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(false));
        const link = await pipeline.promote(okRun('run-gh-fail'), okManifest(), emptyLedger());
        strict_1.default.equal(link.status, 'blocked');
    });
    (0, node_test_1.test)('savePRLink and loadPRLink round-trip', () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        const link = {
            run_id: 'run-persist',
            branch: 'oxe/test',
            pr_url: 'https://github.com/owner/repo/pull/10',
            pr_number: 10,
            status: 'open',
            created_at: new Date().toISOString(),
            merged_at: null,
        };
        pipeline.savePRLink('run-persist', link);
        const loaded = pipeline.loadPRLink('run-persist');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.run_id, 'run-persist');
        strict_1.default.equal(loaded.pr_url, link.pr_url);
    });
    (0, node_test_1.test)('loadPRLink returns null for unknown run', () => {
        const pipeline = new promotion_pipeline_1.PromotionPipeline(tmpDir, makeBranchManager(), makePRManager(true));
        strict_1.default.equal(pipeline.loadPRLink('no-such-run'), null);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
