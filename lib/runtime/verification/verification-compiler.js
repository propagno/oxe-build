"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compile = compile;
exports.runCheck = runCheck;
exports.runSuite = runSuite;
exports.executeSuite = executeSuite;
exports.summarizeSuite = summarizeSuite;
exports.verifyRun = verifyRun;
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const verification_manifest_1 = require("./verification-manifest");
function inferCheckType(howToVerify) {
    const v = howToVerify.toLowerCase();
    if (v.includes('npm test') || v.includes('jest') || v.includes('vitest') || v.includes('node --test'))
        return 'unit';
    if (v.includes('postman') || v.includes('newman') || v.includes('integration'))
        return 'integration';
    if (v.includes('smoke') || v.includes('curl'))
        return 'smoke';
    if (v.includes('eslint') || v.includes('lint') || v.includes('oxe-policy'))
        return 'policy';
    if (v.includes('security') || v.includes('audit') || v.includes('trivy'))
        return 'security';
    return 'custom';
}
function inferEvidenceType(checkType) {
    switch (checkType) {
        case 'unit': return 'junit_xml';
        case 'integration': return 'api_output';
        case 'security': return 'security_report';
        case 'policy': return 'log';
        default: return 'stdout';
    }
}
function compile(spec, plan) {
    const checks = [];
    const seenRefs = new Set();
    // Generate checks from spec criteria
    for (const criterion of spec.criteria) {
        // Find the verify command from the task that references this criterion
        const task = plan.tasks.find((t) => t.aceite.includes(criterion.id));
        const command = task?.verifyCommand ?? null;
        const type = inferCheckType(criterion.howToVerify);
        checks.push({
            id: `check-${criterion.id.toLowerCase()}`,
            type,
            command: command ?? (criterion.howToVerify.startsWith('#') ? null : criterion.howToVerify),
            evidence_type_expected: inferEvidenceType(type),
            acceptance_ref: criterion.id,
            description: criterion.criterion,
        });
        seenRefs.add(criterion.id);
    }
    // Add checks for task verify commands not already covered
    for (const task of plan.tasks) {
        if (!task.verifyCommand)
            continue;
        const uncovered = task.aceite.filter((ref) => !seenRefs.has(ref));
        if (uncovered.length === 0 && checks.some((c) => c.command === task.verifyCommand))
            continue;
        checks.push({
            id: `check-task-${task.id.toLowerCase()}`,
            type: inferCheckType(task.verifyCommand),
            command: task.verifyCommand,
            evidence_type_expected: 'stdout',
            acceptance_ref: uncovered[0] ?? null,
            description: `Verify command for task ${task.id}`,
        });
    }
    return {
        checks,
        compiled_at: new Date().toISOString(),
        spec_hash: hashObject(spec),
        plan_hash: hashObject(plan),
    };
}
async function runCheck(check, cwd, timeoutMs = 60000) {
    if (!check.command) {
        return {
            check_id: check.id,
            acceptance_ref: check.acceptance_ref,
            status: 'skip',
            stdout: '',
            stderr: '',
            exit_code: null,
            duration_ms: 0,
            error: null,
        };
    }
    const start = Date.now();
    try {
        // Use shell so the full command string is interpreted (handles quotes, &&, node -e "...")
        const isWin = process.platform === 'win32';
        const shell = isWin ? 'cmd' : 'sh';
        const shellArgs = isWin ? ['/c', check.command] : ['-c', check.command];
        const result = (0, child_process_1.spawnSync)(shell, shellArgs, {
            cwd,
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            // On Windows, prevent Node from re-quoting the args (preserves double-quotes inside node -e "...")
            windowsVerbatimArguments: isWin,
        });
        const duration_ms = Date.now() - start;
        const status = result.status === 0 ? 'pass' : 'fail';
        return {
            check_id: check.id,
            acceptance_ref: check.acceptance_ref,
            status,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exit_code: result.status ?? null,
            duration_ms,
            error: result.error ? String(result.error) : null,
        };
    }
    catch (err) {
        return {
            check_id: check.id,
            acceptance_ref: check.acceptance_ref,
            status: 'error',
            stdout: '',
            stderr: '',
            exit_code: null,
            duration_ms: Date.now() - start,
            error: String(err),
        };
    }
}
async function runSuite(suite, cwd, timeoutMs = 60000) {
    const results = [];
    for (const check of suite.checks) {
        results.push(await runCheck(check, cwd, timeoutMs));
    }
    return results;
}
async function executeSuite(suite, cwd, options) {
    const results = [];
    const verificationResults = [];
    const evidenceRefs = new Map();
    const timeoutMs = options.timeoutMs ?? 60000;
    const attemptNumber = options.attemptNumber ?? 1;
    for (const check of suite.checks) {
        const provider = options.pluginRegistry?.verifierProviderFor(check.type);
        let result;
        let verificationResult;
        if (provider) {
            const providerResult = await provider.execute({
                check_id: check.id,
                check_type: check.type,
                command: check.command,
                work_item_id: options.workItemId,
                workspace_root: cwd,
                evidence_dir: '',
            });
            result = {
                check_id: check.id,
                acceptance_ref: check.acceptance_ref,
                status: providerResult.status,
                stdout: providerResult.summary ?? '',
                stderr: '',
                exit_code: providerResult.status === 'pass' ? 0 : 1,
                duration_ms: 0,
                error: providerResult.status === 'error' ? providerResult.summary ?? 'provider error' : null,
                evidence_refs: providerResult.evidence_refs,
            };
            verificationResult = providerResult;
        }
        else {
            result = await runCheck(check, cwd, timeoutMs);
            const collectedEvidence = options.evidenceStore
                ? await collectCheckEvidence(options.evidenceStore, check, result, {
                    run_id: options.runId,
                    work_item_id: options.workItemId,
                    attempt_number: attemptNumber,
                })
                : [];
            result.evidence_refs = collectedEvidence;
            verificationResult = {
                verification_id: `vr-${crypto_1.default.randomBytes(4).toString('hex')}`,
                work_item_id: options.workItemId,
                check_id: check.id,
                status: result.status,
                evidence_refs: collectedEvidence,
                summary: result.error || result.stderr || result.stdout || null,
            };
        }
        if (result.evidence_refs && result.evidence_refs.length > 0) {
            evidenceRefs.set(check.id, result.evidence_refs);
        }
        results.push(result);
        verificationResults.push(verificationResult);
    }
    const manifest = (0, verification_manifest_1.buildManifest)(options.runId, results, {
        workItemId: options.workItemId,
        granularity: 'work_item',
        evidenceRefs,
    });
    const riskLedger = (0, verification_manifest_1.buildRiskLedger)(options.runId, manifest);
    const evidenceCoverage = (0, verification_manifest_1.summarizeEvidenceCoverage)(manifest);
    return {
        results,
        verification_results: verificationResults,
        evidence_refs: evidenceRefs,
        manifest,
        risk_ledger: riskLedger,
        evidence_coverage: evidenceCoverage,
    };
}
function summarizeSuite(results) {
    const counts = { total: results.length, pass: 0, fail: 0, skip: 0, error: 0 };
    for (const r of results)
        counts[r.status]++;
    return { ...counts, allPassed: counts.fail === 0 && counts.error === 0 };
}
async function verifyRun(input) {
    const gaps = [];
    if (!input.suite || !Array.isArray(input.suite.checks) || input.suite.checks.length === 0) {
        gaps.push('Nenhum check executável foi compilado a partir de SPEC/PLAN.');
        return {
            status: 'partial',
            suite: input.suite,
            executed: null,
            gaps,
            verification_results: [],
            check_results: [],
            manifest: null,
            risk_ledger: null,
            evidence_coverage: null,
        };
    }
    const executed = await executeSuite(input.suite, input.cwd, {
        timeoutMs: input.timeoutMs,
        runId: input.runId,
        workItemId: input.workItemId,
        attemptNumber: input.attemptNumber,
        evidenceStore: input.evidenceStore,
        pluginRegistry: input.pluginRegistry,
    });
    (0, verification_manifest_1.saveManifest)(input.projectRoot, input.runId, executed.manifest);
    (0, verification_manifest_1.saveRiskLedger)(input.projectRoot, input.runId, executed.risk_ledger);
    (0, verification_manifest_1.saveEvidenceCoverage)(input.projectRoot, input.runId, executed.evidence_coverage);
    const summary = summarizeSuite(executed.results);
    return {
        status: summary.total === 0 ? 'partial' : summary.allPassed ? 'passed' : 'failed',
        suite: input.suite,
        executed,
        gaps,
        verification_results: executed.verification_results,
        check_results: executed.results,
        manifest: executed.manifest,
        risk_ledger: executed.risk_ledger,
        evidence_coverage: executed.evidence_coverage,
    };
}
function hashObject(obj) {
    return crypto_1.default
        .createHash('sha256')
        .update(JSON.stringify(obj))
        .digest('hex')
        .slice(0, 12);
}
async function collectCheckEvidence(store, check, result, options) {
    const refs = [];
    if (result.stdout) {
        const evidence = await store.collect('stdout', result.stdout, options);
        refs.push(evidence.evidence_id);
    }
    if (result.stderr) {
        const evidence = await store.collect('stderr', result.stderr, options);
        refs.push(evidence.evidence_id);
    }
    const summaryEvidence = await store.collect(check.evidence_type_expected, JSON.stringify({
        check_id: check.id,
        type: check.type,
        command: check.command,
        status: result.status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
    }, null, 2), options);
    refs.push(summaryEvidence.evidence_id);
    return refs;
}
