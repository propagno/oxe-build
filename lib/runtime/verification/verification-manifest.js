"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyFailure = classifyFailure;
exports.buildManifest = buildManifest;
exports.buildRiskLedger = buildRiskLedger;
exports.summarizeEvidenceCoverage = summarizeEvidenceCoverage;
exports.saveManifest = saveManifest;
exports.loadManifest = loadManifest;
exports.saveRiskLedger = saveRiskLedger;
exports.loadRiskLedger = loadRiskLedger;
exports.saveEvidenceCoverage = saveEvidenceCoverage;
exports.loadEvidenceCoverage = loadEvidenceCoverage;
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function runDir(projectRoot, runId) {
    return path_1.default.join(projectRoot, '.oxe', 'runs', runId);
}
function manifestPath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'verification-manifest.json');
}
function riskLedgerPath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'residual-risk-ledger.json');
}
function legacyRiskLedgerPath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'residual-risks.json');
}
function evidenceCoveragePath(projectRoot, runId) {
    return path_1.default.join(runDir(projectRoot, runId), 'evidence-coverage.json');
}
const PROFILE_REQUIRED_CHECKS = {
    quick: ['deterministic'],
    standard: ['deterministic', 'policy_failure'],
    critical: ['deterministic', 'policy_failure', 'evidence_missing', 'flaky'],
};
function classifyFailure(result) {
    if (result.status === 'pass' || result.status === 'skip')
        return null;
    if (result.error && (result.error.toLowerCase().includes('timeout') || result.error.toLowerCase().includes('timed out')))
        return 'timeout';
    if (result.exit_code === null && result.error)
        return 'env_setup';
    if (result.stderr.toLowerCase().includes('policy') || result.stderr.toLowerCase().includes('denied')) {
        return 'policy_failure';
    }
    if (result.exit_code !== 0 && result.stderr === '' && result.stdout === '')
        return 'evidence_missing';
    // Default: non-deterministic signals (no reliable exit code pattern)
    return 'deterministic';
}
function buildManifest(runId, results, options = {}) {
    const profile = options.profile ?? 'standard';
    const granularity = options.granularity ?? 'run';
    const evidenceRefs = options.evidenceRefs ?? new Map();
    const checks = results.map((r) => ({
        check_id: r.check_id,
        acceptance_ref: r.acceptance_ref,
        status: r.status,
        failure_class: classifyFailure(r),
        evidence_refs: evidenceRefs.get(r.check_id) ?? [],
        duration_ms: r.duration_ms,
    }));
    const summary = {
        total: checks.length,
        pass: checks.filter((c) => c.status === 'pass').length,
        fail: checks.filter((c) => c.status === 'fail').length,
        skip: checks.filter((c) => c.status === 'skip').length,
        error: checks.filter((c) => c.status === 'error').length,
        all_passed: checks.every((c) => c.status === 'pass' || c.status === 'skip'),
    };
    return {
        manifest_id: `vm-${crypto_1.default.randomBytes(4).toString('hex')}`,
        run_id: runId,
        work_item_id: options.workItemId ?? null,
        wave: options.wave ?? null,
        granularity,
        profile,
        compiled_at: new Date().toISOString(),
        checks,
        summary,
    };
}
function buildRiskLedger(runId, manifest) {
    const risks = [];
    for (const check of manifest.checks) {
        if (check.status === 'pass' || check.status === 'skip')
            continue;
        if (!check.failure_class)
            continue;
        const required = PROFILE_REQUIRED_CHECKS[manifest.profile];
        if (!required.includes(check.failure_class))
            continue;
        risks.push({
            risk_id: `risk-${crypto_1.default.randomBytes(3).toString('hex')}`,
            work_item_id: manifest.work_item_id,
            check_id: check.check_id,
            failure_class: check.failure_class,
            description: `Check ${check.check_id} ${check.status}: ${check.failure_class}`,
            severity: check.failure_class === 'policy_failure' || check.failure_class === 'deterministic'
                ? 'high'
                : check.failure_class === 'evidence_missing'
                    ? 'medium'
                    : 'low',
            mitigation: null,
        });
    }
    return {
        run_id: runId,
        generated_at: new Date().toISOString(),
        risks,
    };
}
function summarizeEvidenceCoverage(manifest) {
    const totalChecks = manifest.checks.length;
    const checksWithEvidence = manifest.checks.filter((check) => check.evidence_refs.length > 0).length;
    const totalEvidenceRefs = manifest.checks.reduce((sum, check) => sum + check.evidence_refs.length, 0);
    const coveragePercent = totalChecks === 0 ? 100 : Math.round((checksWithEvidence / totalChecks) * 100);
    return {
        total_checks: totalChecks,
        checks_with_evidence: checksWithEvidence,
        total_evidence_refs: totalEvidenceRefs,
        coverage_percent: coveragePercent,
    };
}
function saveManifest(projectRoot, runId, manifest) {
    const p = manifestPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
}
function loadManifest(projectRoot, runId) {
    const p = manifestPath(projectRoot, runId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function saveRiskLedger(projectRoot, runId, ledger) {
    const canonical = riskLedgerPath(projectRoot, runId);
    const legacy = legacyRiskLedgerPath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(canonical), { recursive: true });
    fs_1.default.writeFileSync(canonical, JSON.stringify(ledger, null, 2), 'utf8');
    fs_1.default.writeFileSync(legacy, JSON.stringify(ledger, null, 2), 'utf8');
}
function loadRiskLedger(projectRoot, runId) {
    const canonical = riskLedgerPath(projectRoot, runId);
    const legacy = legacyRiskLedgerPath(projectRoot, runId);
    const p = fs_1.default.existsSync(canonical) ? canonical : legacy;
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function saveEvidenceCoverage(projectRoot, runId, coverage) {
    const p = evidenceCoveragePath(projectRoot, runId);
    fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
    fs_1.default.writeFileSync(p, JSON.stringify(coverage, null, 2), 'utf8');
}
function loadEvidenceCoverage(projectRoot, runId) {
    const p = evidenceCoveragePath(projectRoot, runId);
    if (!fs_1.default.existsSync(p))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
