import crypto from 'crypto';
import { spawnSync } from 'child_process';
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
  | 'custom';

export interface AcceptanceCheck {
  id: string;
  type: CheckType;
  command: string | null;
  evidence_type_expected: EvidenceType;
  acceptance_ref: string | null;
  description: string;
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
}

interface ParsedPlanLike {
  tasks: ParsedTaskLike[];
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
    if (!task.verifyCommand) continue;
    const uncovered = task.aceite.filter((ref) => !seenRefs.has(ref));
    if (uncovered.length === 0 && checks.some((c) => c.command === task.verifyCommand)) continue;

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

export async function runCheck(
  check: AcceptanceCheck,
  cwd: string,
  timeoutMs = 60_000
): Promise<CheckResult> {
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

    const result = spawnSync(shell, shellArgs, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      // On Windows, prevent Node from re-quoting the args (preserves double-quotes inside node -e "...")
      windowsVerbatimArguments: isWin,
    });

    const duration_ms = Date.now() - start;
    const status: VerificationStatus = result.status === 0 ? 'pass' : 'fail';

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
      const collectedEvidence = options.evidenceStore
        ? await collectCheckEvidence(options.evidenceStore, check, result, {
            run_id: options.runId,
            work_item_id: options.workItemId,
            attempt_number: attemptNumber,
          })
        : [];
      result.evidence_refs = collectedEvidence;
      verificationResult = {
        verification_id: `vr-${crypto.randomBytes(4).toString('hex')}`,
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
  allPassed: boolean;
} {
  const counts = { total: results.length, pass: 0, fail: 0, skip: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  return { ...counts, allPassed: counts.fail === 0 && counts.error === 0 };
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
): Promise<string[]> {
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
  refs.push(summaryEvidence.evidence_id);
  return refs;
}
