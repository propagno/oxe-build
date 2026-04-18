import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { EvidenceType } from '../models/evidence';
import type { VerificationStatus } from '../models/verification-result';

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
    // Split command into program + args (simple split; no shell expansion)
    const parts = check.command.split(/\s+/);
    const prog = parts[0];
    const args = parts.slice(1);

    const result = spawnSync(prog, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
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

function hashObject(obj: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 12);
}
