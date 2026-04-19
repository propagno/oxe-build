import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { VerificationStatus } from '../models/verification-result';
import type { CheckResult } from './verification-compiler';

export type VerificationProfile = 'quick' | 'standard' | 'critical';

export type FailureClass =
  | 'deterministic'
  | 'flaky'
  | 'timeout'
  | 'env_setup'
  | 'policy_failure'
  | 'evidence_missing';

export type VerificationGranularity = 'work_item' | 'wave' | 'run';

export interface ManifestCheck {
  check_id: string;
  acceptance_ref: string | null;
  status: VerificationStatus;
  failure_class: FailureClass | null;
  evidence_refs: string[];
  duration_ms: number;
}

export interface VerificationManifest {
  manifest_id: string;
  run_id: string;
  work_item_id: string | null;
  wave: number | null;
  granularity: VerificationGranularity;
  profile: VerificationProfile;
  compiled_at: string;
  checks: ManifestCheck[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    error: number;
    all_passed: boolean;
  };
}

export interface ResidualRisk {
  risk_id: string;
  work_item_id: string | null;
  check_id: string | null;
  failure_class: FailureClass;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string | null;
}

export interface ResidualRiskLedger {
  run_id: string;
  generated_at: string;
  risks: ResidualRisk[];
}

const PROFILE_REQUIRED_CHECKS: Record<VerificationProfile, FailureClass[]> = {
  quick: ['deterministic'],
  standard: ['deterministic', 'policy_failure'],
  critical: ['deterministic', 'policy_failure', 'evidence_missing', 'flaky'],
};

export function classifyFailure(result: CheckResult): FailureClass | null {
  if (result.status === 'pass' || result.status === 'skip') return null;
  if (result.error && (result.error.toLowerCase().includes('timeout') || result.error.toLowerCase().includes('timed out'))) return 'timeout';
  if (result.exit_code === null && result.error) return 'env_setup';
  if (result.stderr.toLowerCase().includes('policy') || result.stderr.toLowerCase().includes('denied')) {
    return 'policy_failure';
  }
  if (result.exit_code !== 0 && result.stderr === '' && result.stdout === '') return 'evidence_missing';
  // Default: non-deterministic signals (no reliable exit code pattern)
  return 'deterministic';
}

export function buildManifest(
  runId: string,
  results: CheckResult[],
  options: {
    workItemId?: string;
    wave?: number;
    granularity?: VerificationGranularity;
    profile?: VerificationProfile;
    evidenceRefs?: Map<string, string[]>;
  } = {}
): VerificationManifest {
  const profile = options.profile ?? 'standard';
  const granularity = options.granularity ?? 'run';
  const evidenceRefs = options.evidenceRefs ?? new Map();

  const checks: ManifestCheck[] = results.map((r) => ({
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
    manifest_id: `vm-${crypto.randomBytes(4).toString('hex')}`,
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

export function buildRiskLedger(
  runId: string,
  manifest: VerificationManifest
): ResidualRiskLedger {
  const risks: ResidualRisk[] = [];

  for (const check of manifest.checks) {
    if (check.status === 'pass' || check.status === 'skip') continue;
    if (!check.failure_class) continue;

    const required = PROFILE_REQUIRED_CHECKS[manifest.profile];
    if (!required.includes(check.failure_class)) continue;

    risks.push({
      risk_id: `risk-${crypto.randomBytes(3).toString('hex')}`,
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

export function saveManifest(projectRoot: string, runId: string, manifest: VerificationManifest): void {
  const p = path.join(projectRoot, '.oxe', 'runs', runId, 'verification-manifest.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
}

export function loadManifest(projectRoot: string, runId: string): VerificationManifest | null {
  const p = path.join(projectRoot, '.oxe', 'runs', runId, 'verification-manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as VerificationManifest;
  } catch {
    return null;
  }
}

export function saveRiskLedger(projectRoot: string, runId: string, ledger: ResidualRiskLedger): void {
  const p = path.join(projectRoot, '.oxe', 'runs', runId, 'residual-risks.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2), 'utf8');
}

export function loadRiskLedger(projectRoot: string, runId: string): ResidualRiskLedger | null {
  const p = path.join(projectRoot, '.oxe', 'runs', runId, 'residual-risks.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ResidualRiskLedger;
  } catch {
    return null;
  }
}
