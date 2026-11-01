"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFICATION_COMPILER_VERSION = exports.SHELL_COMMAND_RE = void 0;
exports.sha256File = sha256File;
exports.stripQuotedArgs = stripQuotedArgs;
exports.looksLikeShellCommand = looksLikeShellCommand;
exports.extractCommandFromHowToVerify = extractCommandFromHowToVerify;
exports.compile = compile;
exports.runCheck = runCheck;
exports.runSuite = runSuite;
exports.executeSuite = executeSuite;
exports.summarizeSuite = summarizeSuite;
exports.verifyRun = verifyRun;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const test_report_parsers_1 = require("./test-report-parsers");
const shell_argv_1 = require("../executor/shell-argv");
const contract_exports_1 = require("./contract-exports");
const verification_manifest_1 = require("./verification-manifest");
function sha256File(absPath) {
    try {
        return crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(absPath)).digest('hex');
    }
    catch {
        return null;
    }
}
/**
 * Drop quoted arguments so only invoked programs are classified: `node -e "…'node --test'…"`
 * checks package.json, it does not run a test runner.
 */
function stripQuotedArgs(command) {
    return command.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
}
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
exports.SHELL_COMMAND_RE = /^(npm|npx|pnpm|yarn|node|deno|bun|python3?|pytest|go|cargo|make|dotnet|mvn|gradle|bash|sh|curl|git|eslint|tsc|jest|vitest|mocha|oxe-cc|oxe|docker)(\s|$)/i;
function looksLikeShellCommand(text) {
    return exports.SHELL_COMMAND_RE.test(String(text || '').trim());
}
/**
 * Turn a SPEC "Como verificar" cell into an executable command, or null when it is prose.
 * Only backtick spans that look like commands count; path-like spans (`test/api.test.js`)
 * and free text are never executed.
 */
function extractCommandFromHowToVerify(howToVerify) {
    const text = String(howToVerify || '').trim();
    if (!text || text.startsWith('#'))
        return null;
    const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (spans.length > 0) {
        const commands = [...new Set(spans.filter(looksLikeShellCommand))];
        return commands.length ? commands.join(' && ') : null;
    }
    return looksLikeShellCommand(text) ? text : null;
}
/** Bump when the rules that turn SPEC/PLAN into checks change (invalidates persisted suites). */
exports.VERIFICATION_COMPILER_VERSION = '1.20.0';
function compile(spec, plan) {
    const checks = [];
    const seenRefs = new Set();
    // Generate checks from spec criteria
    for (const criterion of spec.criteria) {
        // Find the verify command from the task that references this criterion
        const task = plan.tasks.find((t) => t.aceite.includes(criterion.id));
        // A criterion the SPEC declares manual (UAT, manual check) is never "proven" by some task's verify command:
        // OxeVoice F1's A8 (real dictation, UAT) passed on a doc-exists check of the task that wrote the UAT script.
        const declaredManual = MANUAL_CRITERION_RE.test(String(criterion.howToVerify || ''))
            && !extractCommandFromHowToVerify(criterion.howToVerify);
        const command = declaredManual ? null : (task?.verifyCommand ?? extractCommandFromHowToVerify(criterion.howToVerify));
        // Prose that cannot be executed is a manual criterion, not a shell command. The type comes from
        // the command that actually runs: prose saying "npm test" must not demand a test report from a
        // task command that never runs tests (false red seen in the 1.17 linkly benchmark).
        const type = command ? inferCheckType(stripQuotedArgs(command)) : 'manual';
        checks.push({
            id: `check-${criterion.id.toLowerCase()}`,
            type,
            command,
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
            type: inferCheckType(stripQuotedArgs(task.verifyCommand)),
            command: task.verifyCommand,
            evidence_type_expected: 'stdout',
            acceptance_ref: uncovered[0] ?? null,
            description: `Verify command for task ${task.id}`,
        });
    }
    // The IMPLEMENTATION-PACK contract is checked, not just recorded: a task that skipped a contracted
    // file must not pass because its own verify command happened to exit 0 (T3 in the 1.17 benchmark).
    for (const task of plan.tasks) {
        const files = [...new Set(task.filesExist ?? [])];
        const exportsExpected = dedupeExports(task.exportsExpected ?? []);
        if (files.length === 0 && exportsExpected.length === 0)
            continue;
        checks.push({
            id: `check-pack-${task.id.toLowerCase()}`,
            type: 'contract',
            command: null,
            evidence_type_expected: 'stdout',
            acceptance_ref: null,
            description: `Implementation pack contract for task ${task.id}`,
            files_exist: files,
            ...(exportsExpected.length ? { exports_expected: exportsExpected } : {}),
        });
    }
    // Plan-owned acceptance tests: the proof of A* is written before execution and frozen.
    for (const entry of plan.acceptanceTests ?? []) {
        if (!entry || !entry.command || !Array.isArray(entry.files) || entry.files.length === 0)
            continue;
        const type = inferCheckType(stripQuotedArgs(entry.command));
        checks.push({
            id: `check-accept-${String(entry.criterion).toLowerCase()}`,
            type,
            command: entry.command,
            evidence_type_expected: inferEvidenceType(type),
            acceptance_ref: entry.criterion,
            description: `Teste de aceite congelado de ${entry.criterion}`,
            frozen_files: entry.files.map((f) => ({ path: f.path, sha256: f.sha256 ?? null })),
            ...(Array.isArray(entry.proves) && entry.proves.length ? { proves: [...entry.proves] } : {}),
        });
    }
    return {
        checks,
        compiled_at: new Date().toISOString(),
        spec_hash: hashObject(spec),
        // OXB-011: the compiler's own version is part of the cache key — a suite compiled by older rules is stale.
        plan_hash: hashObject({ plan, compiler: exports.VERIFICATION_COMPILER_VERSION }),
    };
}
async function runCheck(check, cwd, timeoutMs = 60000) {
    const frozen = check.frozen_files ?? [];
    if (frozen.length > 0) {
        const missing = frozen.filter((f) => !fs_1.default.existsSync(path_1.default.resolve(cwd, f.path)));
        const tampered = missing.length > 0
            ? []
            : frozen.filter((f) => f.sha256 !== null && sha256File(path_1.default.resolve(cwd, f.path)) !== f.sha256);
        const unlocked = frozen.filter((f) => f.sha256 === null);
        if (missing.length > 0 || tampered.length > 0 || unlocked.length > 0) {
            return {
                check_id: check.id,
                acceptance_ref: check.acceptance_ref,
                status: 'fail',
                stdout: '',
                stderr: '',
                exit_code: null,
                duration_ms: 0,
                error: missing.length > 0
                    ? `acceptance_missing: ${missing.map((f) => f.path).join(', ')}`
                    : tampered.length > 0
                        ? `acceptance_tampered: ${tampered.map((f) => f.path).join(', ')}`
                        : `acceptance_not_frozen: ${unlocked.map((f) => f.path).join(', ')} (não existia no compile)`,
                tests_executed: null,
            };
        }
    }
    const contracted = check.files_exist ?? [];
    const exportsExpected = check.exports_expected ?? [];
    if (contracted.length > 0 || exportsExpected.length > 0) {
        const absent = contracted.filter((file) => !fs_1.default.existsSync(path_1.default.resolve(cwd, file)));
        const leaks = absent.length > 0 ? [] : contracted.filter((file) => referencesOxeInternals(path_1.default.resolve(cwd, file)));
        const exportOutcome = absent.length > 0 || leaks.length > 0
            ? { missing: [], unsupported: [] }
            : (0, contract_exports_1.checkExpectedExports)(cwd, exportsExpected);
        const failed = absent.length > 0 || leaks.length > 0 || exportOutcome.missing.length > 0;
        if (failed || !check.command) {
            const okLines = [];
            if (contracted.length)
                okLines.push(`files_exist ok: ${contracted.join(', ')}`);
            const checkedExports = exportsExpected.filter((e) => !exportOutcome.unsupported.includes(e.file));
            if (checkedExports.length)
                okLines.push(`exports ok: ${checkedExports.map((e) => `${e.file}#${e.name}`).join(', ')}`);
            if (exportOutcome.unsupported.length)
                okLines.push(`exports_unchecked (linguagem não suportada): ${exportOutcome.unsupported.join(', ')}`);
            return {
                check_id: check.id,
                acceptance_ref: check.acceptance_ref,
                status: failed ? 'fail' : 'pass',
                stdout: failed ? '' : `${okLines.join('\n')}\n`,
                stderr: '',
                exit_code: null,
                duration_ms: 0,
                error: absent.length > 0
                    ? `files_missing: ${absent.join(', ')}`
                    : leaks.length > 0
                        ? `oxe_internal_reference: ${leaks.join(', ')}`
                        : exportOutcome.missing.length > 0
                            ? `exports_missing: ${exportOutcome.missing.map((e) => `${e.file}#${e.name}`).join(', ')}`
                            : null,
                tests_executed: null,
            };
        }
    }
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
            skip_reason: check.type === 'manual' ? 'needs_structured_check' : 'no_command',
            tests_executed: null,
        };
    }
    // A verify command that names a test file which does not exist cannot have verified it,
    // whatever the runner's exit code says.
    const missingFiles = (0, test_report_parsers_1.extractTestFileArgs)(check.command).filter((file) => !fs_1.default.existsSync(path_1.default.resolve(cwd, file)));
    if (missingFiles.length > 0) {
        return {
            check_id: check.id,
            acceptance_ref: check.acceptance_ref,
            status: 'fail',
            stdout: '',
            stderr: '',
            exit_code: null,
            duration_ms: 0,
            error: `test_file_missing: ${missingFiles.join(', ')}`,
            tests_executed: 0,
        };
    }
    const start = Date.now();
    try {
        // Use a shell so the full command string is interpreted (handles quotes, &&, node -e "...").
        // The child never inherits node:test context: it would emit a serialized protocol, not TAP.
        const shell = (0, shell_argv_1.shellInvocation)(check.command);
        const result = (0, child_process_1.spawnSync)(shell.file, shell.args, {
            cwd,
            env: (0, shell_argv_1.childProcessEnv)(),
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            windowsVerbatimArguments: shell.windowsVerbatimArguments,
        });
        const duration_ms = Date.now() - start;
        const stdout = result.stdout ?? '';
        const stderr = result.stderr ?? '';
        const report = (0, test_report_parsers_1.parseTestReport)(`${stdout}\n${stderr}`);
        let status = result.status === 0 ? 'pass' : 'fail';
        let error = result.error ? String(result.error) : null;
        // Exit code 0 is not proof: `node --test` exits 0 when a listed file is missing, and a
        // unit check that executed zero tests verified nothing.
        if (status === 'pass' && report.missing_files.length > 0) {
            status = 'fail';
            error = `test_file_missing: ${report.missing_files.join(', ')}`;
        }
        else if (status === 'pass' && check.type === 'unit' && report.tests_executed === 0) {
            status = 'fail';
            error = 'no_tests_executed';
        }
        else if (status === 'pass' && check.type === 'unit' && report.tests_executed === null && !stdout.trim() && !stderr.trim()) {
            // A unit check that printed nothing cannot have run a test runner.
            status = 'fail';
            error = 'no_test_report';
        }
        if (status === 'pass' && check.proves && check.proves.length > 0) {
            const missing = (0, test_report_parsers_1.missingProofs)(check.proves, `${stdout}
${stderr}`);
            if (missing.length > 0) {
                status = 'fail';
                error = `proof_not_executed: ${missing.join(' | ')}`;
            }
        }
        return {
            check_id: check.id,
            acceptance_ref: check.acceptance_ref,
            status,
            stdout,
            stderr,
            exit_code: result.status ?? null,
            duration_ms,
            error,
            tests_executed: report.tests_executed,
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
            const collected = options.evidenceStore
                ? await collectCheckEvidence(options.evidenceStore, check, result, {
                    run_id: options.runId,
                    work_item_id: options.workItemId,
                    attempt_number: attemptNumber,
                })
                : { refs: [], summaryRef: null };
            result.evidence_refs = collected.refs;
            result.summary_evidence_ref = collected.summaryRef;
            verificationResult = {
                verification_id: `vr-${crypto_1.default.randomBytes(4).toString('hex')}`,
                work_item_id: options.workItemId,
                check_id: check.id,
                status: result.status,
                evidence_refs: collected.refs,
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
    let manual = 0;
    for (const r of results) {
        counts[r.status]++;
        if (r.status === 'skip' && r.skip_reason === 'needs_structured_check')
            manual++;
    }
    return { ...counts, manual, allPassed: counts.fail === 0 && counts.error === 0 };
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
    for (const r of executed.results) {
        if (r.status === 'skip' && r.skip_reason === 'needs_structured_check') {
            gaps.push(`Critério ${r.acceptance_ref ?? r.check_id}: "Como verificar" não é executável — informe um comando ou vincule a uma tarefa com verificação.`);
        }
    }
    // Manual criteria leave the run `partial`: nothing failed, but nothing proved them either.
    const status = summary.total === 0
        ? 'partial'
        : !summary.allPassed
            ? 'failed'
            : summary.manual > 0
                ? 'partial'
                : 'passed';
    return {
        status,
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
const MANUAL_CRITERION_RE = /\b(manual|uat|homologa\w*|inspe[cç][aã]o visual|visual inspection)\b/i;
const CODE_FILE_RE = /\.(c|m)?[jt]sx?$|\.(py|go|rs|java|kt|rb|php|cs|json|ya?ml|sh)$/i;
const OXE_INTERNAL_REF_RE = /(^|[^\w.-])\.oxe[\\/]/;
/**
 * Product code or tests that read `.oxe/` depend on OXE's local state, which is usually
 * gitignored: they pass in the workspace and break on a clean clone or in CI. Seen in the 1.18
 * benchmark (test/api.test.js loading `.oxe/investigations/fixtures/…`). Docs may mention `.oxe/`.
 */
function referencesOxeInternals(absPath) {
    if (!CODE_FILE_RE.test(absPath))
        return false;
    try {
        const stat = fs_1.default.statSync(absPath);
        if (!stat.isFile() || stat.size > 1024 * 1024)
            return false;
        const current = fs_1.default.readFileSync(absPath, 'utf8');
        const added = countOxeRefs(current);
        if (added === 0)
            return false;
        // Only references the run introduced count: a product that legitimately talks about `.oxe/` (OXESpace hosts OXE)
        // already had them at HEAD (false red seen in OxeVoice F1 on shared/mcp-coverage.ts).
        const baseline = readCommittedVersion(absPath);
        return baseline === null ? true : added > countOxeRefs(baseline);
    }
    catch {
        return false;
    }
}
function countOxeRefs(text) {
    return (text.match(new RegExp(OXE_INTERNAL_REF_RE.source, 'g')) || []).length;
}
/** The file as committed at HEAD, or null when it is untracked / there is no git. */
function readCommittedVersion(absPath) {
    try {
        const dir = path_1.default.dirname(absPath);
        const top = (0, child_process_1.spawnSync)('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', windowsHide: true });
        if (top.status !== 0)
            return null;
        const rel = path_1.default.relative(top.stdout.trim(), absPath).split(path_1.default.sep).join('/');
        const shown = (0, child_process_1.spawnSync)('git', ['show', `HEAD:${rel}`], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return shown.status === 0 ? shown.stdout : null;
    }
    catch {
        return null;
    }
}
function dedupeExports(list) {
    const seen = new Set();
    const out = [];
    for (const entry of list) {
        if (!entry || typeof entry.file !== 'string' || typeof entry.name !== 'string')
            continue;
        const key = `${entry.file}#${entry.name}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ file: entry.file, name: entry.name });
    }
    return out;
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
    // The summary record is bookkeeping, not proof: it is stored but excluded from `evidence_refs`,
    // otherwise every check (even a silent exit 0) counts as "covered".
    return { refs, summaryRef: summaryEvidence.evidence_id };
}
