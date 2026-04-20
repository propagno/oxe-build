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
const verification_manifest_1 = require("../src/verification/verification-manifest");
function makeCheck(overrides) {
    return {
        acceptance_ref: null,
        status: 'pass',
        stdout: '',
        stderr: '',
        exit_code: 0,
        duration_ms: 10,
        error: null,
        ...overrides,
    };
}
(0, node_test_1.describe)('VerificationManifest', () => {
    let tmpDir;
    (0, node_test_1.test)('setup', () => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-vm-test-'));
        fs_1.default.mkdirSync(path_1.default.join(tmpDir, '.oxe'), { recursive: true });
    });
    (0, node_test_1.test)('buildManifest computes correct summary', () => {
        const results = [
            makeCheck({ check_id: 'c1', status: 'pass' }),
            makeCheck({ check_id: 'c2', status: 'fail', exit_code: 1, stderr: 'assertion failed' }),
            makeCheck({ check_id: 'c3', status: 'skip' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-1', results);
        strict_1.default.equal(manifest.summary.total, 3);
        strict_1.default.equal(manifest.summary.pass, 1);
        strict_1.default.equal(manifest.summary.fail, 1);
        strict_1.default.equal(manifest.summary.skip, 1);
        strict_1.default.equal(manifest.summary.all_passed, false);
    });
    (0, node_test_1.test)('buildManifest all_passed when only pass and skip', () => {
        const results = [
            makeCheck({ check_id: 'c1', status: 'pass' }),
            makeCheck({ check_id: 'c2', status: 'skip' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-2', results);
        strict_1.default.equal(manifest.summary.all_passed, true);
    });
    (0, node_test_1.test)('buildManifest uses correct profile and granularity', () => {
        const manifest = (0, verification_manifest_1.buildManifest)('run-3', [], {
            workItemId: 'T1',
            wave: 2,
            profile: 'critical',
            granularity: 'work_item',
        });
        strict_1.default.equal(manifest.profile, 'critical');
        strict_1.default.equal(manifest.granularity, 'work_item');
        strict_1.default.equal(manifest.work_item_id, 'T1');
        strict_1.default.equal(manifest.wave, 2);
    });
    (0, node_test_1.test)('classifyFailure returns null for pass', () => {
        const r = makeCheck({ check_id: 'c1', status: 'pass' });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), null);
    });
    (0, node_test_1.test)('classifyFailure returns timeout for timeout error', () => {
        const r = makeCheck({ check_id: 'c1', status: 'error', error: 'command timed out', exit_code: null });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), 'timeout');
    });
    (0, node_test_1.test)('classifyFailure returns env_setup for null exit code with error', () => {
        const r = makeCheck({ check_id: 'c1', status: 'error', error: 'ENOENT', exit_code: null });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), 'env_setup');
    });
    (0, node_test_1.test)('classifyFailure returns policy_failure for policy in stderr', () => {
        const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'policy denied' });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), 'policy_failure');
    });
    (0, node_test_1.test)('classifyFailure returns evidence_missing when no output', () => {
        const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stdout: '', stderr: '' });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), 'evidence_missing');
    });
    (0, node_test_1.test)('classifyFailure defaults to deterministic for generic failure', () => {
        const r = makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'assertion error at line 5' });
        strict_1.default.equal((0, verification_manifest_1.classifyFailure)(r), 'deterministic');
    });
    (0, node_test_1.test)('buildRiskLedger creates risks for failing checks under profile', () => {
        const results = [
            makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'assertion error' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-4', results, { profile: 'standard' });
        const ledger = (0, verification_manifest_1.buildRiskLedger)('run-4', manifest);
        strict_1.default.equal(ledger.risks.length, 1);
        strict_1.default.equal(ledger.risks[0].check_id, 'c1');
        strict_1.default.equal(ledger.risks[0].failure_class, 'deterministic');
        strict_1.default.equal(ledger.risks[0].severity, 'high');
    });
    (0, node_test_1.test)('buildRiskLedger does not add risk for passing checks', () => {
        const results = [
            makeCheck({ check_id: 'c1', status: 'pass' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-5', results, { profile: 'standard' });
        const ledger = (0, verification_manifest_1.buildRiskLedger)('run-5', manifest);
        strict_1.default.equal(ledger.risks.length, 0);
    });
    (0, node_test_1.test)('buildRiskLedger only includes failure classes in profile scope', () => {
        const results = [
            // flaky not in 'standard' profile required checks
            makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stdout: 'sporadic', stderr: 'sporadic' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-6', results, { profile: 'quick' });
        // 'quick' only includes deterministic
        const ledger = (0, verification_manifest_1.buildRiskLedger)('run-6', manifest);
        // deterministic should appear (fallback for generic failures)
        strict_1.default.equal(ledger.risks.length, 1);
    });
    (0, node_test_1.test)('summarizeEvidenceCoverage computes percentage from manifest refs', () => {
        const manifest = (0, verification_manifest_1.buildManifest)('run-coverage', [
            makeCheck({ check_id: 'c1', status: 'pass', evidence_refs: ['ev-1'] }),
            makeCheck({ check_id: 'c2', status: 'fail' }),
        ], {
            evidenceRefs: new Map([
                ['c1', ['ev-1']],
            ]),
        });
        const coverage = (0, verification_manifest_1.summarizeEvidenceCoverage)(manifest);
        strict_1.default.equal(coverage.total_checks, 2);
        strict_1.default.equal(coverage.checks_with_evidence, 1);
        strict_1.default.equal(coverage.coverage_percent, 50);
    });
    (0, node_test_1.test)('saveManifest and loadManifest round-trip', () => {
        const results = [makeCheck({ check_id: 'c1', status: 'pass' })];
        const manifest = (0, verification_manifest_1.buildManifest)('run-persist', results);
        (0, verification_manifest_1.saveManifest)(tmpDir, 'run-persist', manifest);
        const loaded = (0, verification_manifest_1.loadManifest)(tmpDir, 'run-persist');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.manifest_id, manifest.manifest_id);
        strict_1.default.equal(loaded.summary.pass, 1);
    });
    (0, node_test_1.test)('loadManifest returns null when file not found', () => {
        const result = (0, verification_manifest_1.loadManifest)(tmpDir, 'no-such-run');
        strict_1.default.equal(result, null);
    });
    (0, node_test_1.test)('saveRiskLedger and loadRiskLedger round-trip', () => {
        const results = [
            makeCheck({ check_id: 'c1', status: 'fail', exit_code: 1, stderr: 'error' }),
        ];
        const manifest = (0, verification_manifest_1.buildManifest)('run-risks', results);
        const ledger = (0, verification_manifest_1.buildRiskLedger)('run-risks', manifest);
        (0, verification_manifest_1.saveRiskLedger)(tmpDir, 'run-risks', ledger);
        const loaded = (0, verification_manifest_1.loadRiskLedger)(tmpDir, 'run-risks');
        strict_1.default.ok(loaded !== null);
        strict_1.default.equal(loaded.run_id, 'run-risks');
    });
    (0, node_test_1.test)('loadRiskLedger returns null when file not found', () => {
        strict_1.default.equal((0, verification_manifest_1.loadRiskLedger)(tmpDir, 'no-such-run'), null);
    });
    (0, node_test_1.test)('cleanup', () => {
        fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
    });
});
