import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { parseTestReport, extractTestFileArgs, missingProofs } from './test-report-parsers';
import { shellInvocation, childProcessEnv } from '../executor/shell-argv';
import { checkExpectedExports } from './contract-exports';
import type { ExpectedExport } from './contract-exports';
import type { EvidenceType } from '../models/evidence';
import type { VerificationStatus } from '../models/verification-result';
import type { VerificationResult } from '../models/verification-result';
import type { EvidenceStore } from '../evidence/evidence-store';
import type { PluginRegistry } from '../plugins/plugin-registry';
import {
  buildManifest,
  buildRiskLedger,
  summarizeEvidenceCoverage,
  saveManifest,
  saveRiskLedger,
  saveEvidenceCoverage,
  type EvidenceCoverageSummary,
  type ResidualRiskLedger,
  type VerificationManifest,
} from './verification-manifest';

export type CheckType =
  | 'unit'
  | 'integration'
  | 'contract'
  | 'smoke'
  | 'policy'
  | 'security'
  | 'ux_snapshot'
  | 'performance_baseline'
  | 'custom'
  /** Criterion without an executable verification — never counts as proof. */
  | 'manual';

export interface AcceptanceCheck {
  id: string;
  type: CheckType;
  command: string | null;
  evidence_type_expected: EvidenceType;
  acceptance_ref: string | null;
  description: string;
  /** Paths that must exist in the workspace (IMPLEMENTATION-PACK `exact_paths`); checked before any command. */
  files_exist?: string[];
  /** Symbols the pack contracts per file (`symbols`); JS/TS files are scanned statically. */
  exports_expected?: ExpectedExport[];
  /** Set on checks carried over from a closed program phase (regression). */
  regression_phase?: string | null;
  /**
   * Plan-owned acceptance test files frozen by hash at compile time (1.19). Checked before the
   * command: a missing or modified file fails the check — the executor cannot rewrite its proof.
   */
  frozen_files?: FrozenFile[];
  /**
   * Executed proof (1.20): names of tests (or `file › name`) that must appear as PASSED in the runner output.
   * A green exit code without these named tests is `proof_not_executed`.
   */
  proves?: string[];
}

export interface FrozenFile {
  path: string;
  /** sha256 hex at freeze time; null when the file did not exist when the run was compiled. */
  sha256: string | null;
}

export interface AcceptanceTestLike {
  criterion: string;
  command: string;
  files: FrozenFile[];
  proves?: string[];
}

export interface AcceptanceCheckSuite {
  checks: AcceptanceCheck[];
  compiled_at: string;
  spec_hash: string;
  plan_hash: string;
}

export interface CheckResult {
  check_id: string;
  acceptance_ref: string | null;
  status: VerificationStatus;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  error: string | null;
  evidence_refs?: string[];
  /** Why a check was skipped (`needs_structured_check` = criterion has no executable verification). */
  skip_reason?: string | null;
  /** Test cases the runner reported; null when the output has no recognizable test report. */
  tests_executed?: number | null;
  /** Evidence id of the structured summary record (kept out of `evidence_refs` so coverage counts real output only). */
  summary_evidence_ref?: string | null;
}

export interface ExecutedVerificationSuite {
  results: CheckResult[];
  verification_results: VerificationResult[];
  evidence_refs: Map<string, string[]>;
  manifest: VerificationManifest;
  risk_ledger: ResidualRiskLedger;
  evidence_coverage: EvidenceCoverageSummary;
}

export interface VerifyRunResult {
  status: 'passed' | 'failed' | 'partial';
  suite: AcceptanceCheckSuite;
  executed: ExecutedVerificationSuite | null;
  gaps: string[];
  verification_results: VerificationResult[];
  check_results: CheckResult[];
  manifest: VerificationManifest | null;
  risk_ledger: ResidualRiskLedger | null;
  evidence_coverage: EvidenceCoverageSummary | null;
}

// Mirror of ParsedSpec/ParsedPlan (same as in graph-compiler to avoid circular deps)
interface Criterion {
  id: string;
  criterion: string;
  howToVerify: string;
}

interface ParsedSpecLike {
  objective: string | null;
  criteria: Criterion[];
}

interface ParsedTaskLike {
  id: string;
  verifyCommand: string | null;
  aceite: string[];
  /** Contracted paths from the IMPLEMENTATION-PACK, attached by the caller. */
  filesExist?: string[];
  /** Contracted exports from the IMPLEMENTATION-PACK `symbols`. */
  exportsExpected?: ExpectedExport[];
}

interface ParsedPlanLike {
  tasks: ParsedTaskLike[];
  /** PLAN.json `acceptance_tests` with the hashes frozen when the run was compiled. */
  acceptanceTests?: AcceptanceTestLike[];
}

export function sha256File(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Drop quoted arguments so only invoked programs are classified: `node -e "…'node --test'…"`
 * checks package.json, it does not run a test runner.
 */
export function stripQuotedArgs(command: string): string {
  return command.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
}

function inferCheckType(howToVerify: string): CheckType {
  const v = howToVerify.toLowerCase();
  if (v.includes('npm test') || v.includes('jest') || v.includes('vitest') || v.includes('node --test')) return 'unit';
  if (v.includes('postman') || v.includes('newman') || v.includes('integration')) return 'integration';
  if (v.includes('smoke') || v.includes('curl')) return 'smoke';
  if (v.includes('eslint') || v.includes('lint') || v.includes('oxe-policy')) return 'policy';
  if (v.includes('security') || v.includes('audit') || v.includes('trivy')) return 'security';
  return 'custom';
}

function inferEvidenceType(checkType: CheckType): EvidenceType {
  switch (checkType) {
    case 'unit': return 'junit_xml';
    case 'integration': return 'api_output';
    case 'security': return 'security_report';
    case 'policy': return 'log';
    default: return 'stdout';
  }
}

export const SHELL_COMMAND_RE =
  /^(npm|npx|pnpm|yarn|node|deno|bun|python3?|pytest|go|cargo|make|dotnet|mvn|gradle|bash|sh|curl|git|eslint|tsc|jest|vitest|mocha|oxe-cc|oxe|docker)(\s|$)/i;

export function looksLikeShellCommand(text: string): boolean {
  return SHELL_COMMAND_RE.test(String(text || '').trim());
}

/**
 * Turn a SPEC "Como verificar" cell into an executable command, or null when it is prose.
 * Only backtick spans that look like commands count; path-like spans (`test/api.test.js`)
 * and free text are never executed.
 */
export function extractCommandFromHowToVerify(howToVerify: string): string | null {
  const text = String(howToVerify || '').trim();
  if (!text || text.startsWith('#')) return null;
  const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (spans.length > 0) {
    const commands = [...new Set(spans.filter(looksLikeShellCommand))];
    return commands.length ? commands.join(' && ') : null;
  }
  return looksLikeShellCommand(text) ? text : null;
}

/** Bump when the rules that turn SPEC/PLAN into checks change (invalidates persisted suites). */
export const VERIFICATION_COMPILER_VERSION = '1.20.0';

export function compile(
  spec: ParsedSpecLike,
  plan: ParsedPlanLike
): AcceptanceCheckSuite {
  const checks: AcceptanceCheck[] = [];
  const seenRefs = new Set<string>();

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
    const type: CheckType = command ? inferCheckType(stripQuotedArgs(command)) : 'manual';

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
    if (!task.verifyCommand) continue;
    const uncovered = task.aceite.filter((ref) => !seenRefs.has(ref));
    if (uncovered.length === 0 && checks.some((c) => c.command === task.verifyCommand)) continue;

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
    if (files.length === 0 && exportsExpected.length === 0) continue;
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
    if (!entry || !entry.command || !Array.isArray(entry.files) || entry.files.length === 0) continue;
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
    plan_hash: hashObject({ plan, compiler: VERIFICATION_COMPILER_VERSION }),
  };
}

export async function runCheck(
  check: AcceptanceCheck,
  cwd: string,
  timeoutMs = 60_000
): Promise<CheckResult> {
  const frozen = check.frozen_files ?? [];
  if (frozen.length > 0) {
    const missing = frozen.filter((f) => !fs.existsSync(path.resolve(cwd, f.path)));
    const tampered = missing.length > 0
      ? []
      : frozen.filter((f) => f.sha256 !== null && sha256File(path.resolve(cwd, f.path)) !== f.sha256);
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
    const absent = contracted.filter((file) => !fs.existsSync(path.resolve(cwd, file)));
    const leaks = absent.length > 0 ? [] : contracted.filter((file) => referencesOxeInternals(path.resolve(cwd, file)));
    const exportOutcome = absent.length > 0 || leaks.length > 0
      ? { missing: [] as ExpectedExport[], unsupported: [] as string[] }
      : checkExpectedExports(cwd, exportsExpected);
    const failed = absent.length > 0 || leaks.length > 0 || exportOutcome.missing.length > 0;
    if (failed || !check.command) {
      const okLines: string[] = [];
      if (contracted.length) okLines.push(`files_exist ok: ${contracted.join(', ')}`);
      const checkedExports = exportsExpected.filter((e) => !exportOutcome.unsupported.includes(e.file));
      if (checkedExports.length) okLines.push(`exports ok: ${checkedExports.map((e) => `${e.file}#${e.name}`).join(', ')}`);
      if (exportOutcome.unsupported.length) okLines.push(`exports_unchecked (linguagem não suportada): ${exportOutcome.unsupported.join(', ')}`);
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
  const missingFiles = extractTestFileArgs(check.command).filter(
    (file) => !fs.existsSync(path.resolve(cwd, file))
  );
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
    const shell = shellInvocation(check.command);
    const result = spawnSync(shell.file, shell.args, {
      cwd,
      env: childProcessEnv(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    });

    const duration_ms = Date.now() - start;
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const report = parseTestReport(`${stdout}\n${stderr}`);
    let status: VerificationStatus = result.status === 0 ? 'pass' : 'fail';
    let error: string | null = result.error ? String(result.error) : null;

    // Exit code 0 is not proof: `node --test` exits 0 when a listed file is missing, and a
    // unit check that executed zero tests verified nothing.
    if (status === 'pass' && report.missing_files.length > 0) {
      status = 'fail';
      error = `test_file_missing: ${report.missing_files.join(', ')}`;
    } else if (status === 'pass' && check.type === 'unit' && report.tests_executed === 0) {
      status = 'fail';
      error = 'no_tests_executed';
    } else if (status === 'pass' && check.type === 'unit' && report.tests_executed === null && !stdout.trim() && !stderr.trim()) {
      // A unit check that printed nothing cannot have run a test runner.
      status = 'fail';
      error = 'no_test_report';
    }
    if (status === 'pass' && check.proves && check.proves.length > 0) {
      const missing = missingProofs(check.proves, `${stdout}
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
  } catch (err) {
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

export async function runSuite(
  suite: AcceptanceCheckSuite,
  cwd: string,
  timeoutMs = 60_000
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of suite.checks) {
    results.push(await runCheck(check, cwd, timeoutMs));
  }
  return results;
}

export async function executeSuite(
  suite: AcceptanceCheckSuite,
  cwd: string,
  options: {
    timeoutMs?: number;
    runId: string;
    workItemId: string;
    attemptNumber?: number;
    evidenceStore?: EvidenceStore;
    pluginRegistry?: PluginRegistry;
  }
): Promise<ExecutedVerificationSuite> {
  const results: CheckResult[] = [];
  const verificationResults: VerificationResult[] = [];
  const evidenceRefs = new Map<string, string[]>();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const attemptNumber = options.attemptNumber ?? 1;

  for (const check of suite.checks) {
    const provider = options.pluginRegistry?.verifierProviderFor(check.type);
    let result: CheckResult;
    let verificationResult: VerificationResult;

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
    } else {
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
        verification_id: `vr-${crypto.randomBytes(4).toString('hex')}`,
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

  const manifest = buildManifest(options.runId, results, {
    workItemId: options.workItemId,
    granularity: 'work_item',
    evidenceRefs,
  });
  const riskLedger = buildRiskLedger(options.runId, manifest);
  const evidenceCoverage = summarizeEvidenceCoverage(manifest);
  return {
    results,
    verification_results: verificationResults,
    evidence_refs: evidenceRefs,
    manifest,
    risk_ledger: riskLedger,
    evidence_coverage: evidenceCoverage,
  };
}

export function summarizeSuite(results: CheckResult[]): {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  error: number;
  /** Skipped checks whose criterion has no executable verification. */
  manual: number;
  allPassed: boolean;
} {
  const counts = { total: results.length, pass: 0, fail: 0, skip: 0, error: 0 };
  let manual = 0;
  for (const r of results) {
    counts[r.status]++;
    if (r.status === 'skip' && r.skip_reason === 'needs_structured_check') manual++;
  }
  return { ...counts, manual, allPassed: counts.fail === 0 && counts.error === 0 };
}

export async function verifyRun(input: {
  projectRoot: string;
  runId: string;
  workItemId: string;
  cwd: string;
  suite: AcceptanceCheckSuite;
  pluginRegistry?: PluginRegistry;
  evidenceStore?: EvidenceStore;
  attemptNumber?: number;
  timeoutMs?: number;
}): Promise<VerifyRunResult> {
  const gaps: string[] = [];
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
  saveManifest(input.projectRoot, input.runId, executed.manifest);
  saveRiskLedger(input.projectRoot, input.runId, executed.risk_ledger);
  saveEvidenceCoverage(input.projectRoot, input.runId, executed.evidence_coverage);
  const summary = summarizeSuite(executed.results);
  for (const r of executed.results) {
    if (r.status === 'skip' && r.skip_reason === 'needs_structured_check') {
      gaps.push(
        `Critério ${r.acceptance_ref ?? r.check_id}: "Como verificar" não é executável — informe um comando ou vincule a uma tarefa com verificação.`
      );
    }
  }
  // Manual criteria leave the run `partial`: nothing failed, but nothing proved them either.
  const status: VerifyRunResult['status'] = summary.total === 0
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
function referencesOxeInternals(absPath: string): boolean {
  if (!CODE_FILE_RE.test(absPath)) return false;
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return false;
    const current = fs.readFileSync(absPath, 'utf8');
    const added = countOxeRefs(current);
    if (added === 0) return false;
    // Only references the run introduced count: a product that legitimately talks about `.oxe/` (OXESpace hosts OXE)
    // already had them at HEAD (false red seen in OxeVoice F1 on shared/mcp-coverage.ts).
    const baseline = readCommittedVersion(absPath);
    return baseline === null ? true : added > countOxeRefs(baseline);
  } catch {
    return false;
  }
}

function countOxeRefs(text: string): number {
  return (text.match(new RegExp(OXE_INTERNAL_REF_RE.source, 'g')) || []).length;
}

/** The file as committed at HEAD, or null when it is untracked / there is no git. */
function readCommittedVersion(absPath: string): string | null {
  try {
    const dir = path.dirname(absPath);
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    if (top.status !== 0) return null;
    const rel = path.relative(top.stdout.trim(), absPath).split(path.sep).join('/');
    const shown = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return shown.status === 0 ? shown.stdout : null;
  } catch {
    return null;
  }
}

function dedupeExports(list: ExpectedExport[]): ExpectedExport[] {
  const seen = new Set<string>();
  const out: ExpectedExport[] = [];
  for (const entry of list) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.name !== 'string') continue;
    const key = `${entry.file}#${entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: entry.file, name: entry.name });
  }
  return out;
}

function hashObject(obj: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 12);
}

async function collectCheckEvidence(
  store: EvidenceStore,
  check: AcceptanceCheck,
  result: CheckResult,
  options: { run_id: string; work_item_id: string; attempt_number: number }
): Promise<{ refs: string[]; summaryRef: string }> {
  const refs: string[] = [];
  if (result.stdout) {
    const evidence = await store.collect('stdout', result.stdout, options);
    refs.push(evidence.evidence_id);
  }
  if (result.stderr) {
    const evidence = await store.collect('stderr', result.stderr, options);
    refs.push(evidence.evidence_id);
  }
  const summaryEvidence = await store.collect(
    check.evidence_type_expected,
    JSON.stringify(
      {
        check_id: check.id,
        type: check.type,
        command: check.command,
        status: result.status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
      },
      null,
      2
    ),
    options
  );
  // The summary record is bookkeeping, not proof: it is stored but excluded from `evidence_refs`,
  // otherwise every check (even a silent exit 0) counts as "covered".
  return { refs, summaryRef: summaryEvidence.evidence_id };
}
