import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export type ChangeStrategy =
  | 'minimal_patch'
  | 'isolated_refactor'
  | 'expand_contract'
  | 'feature_flag'
  | 'no_op';

export interface BlastRadiusEstimate {
  estimated_files: number;
  subsystems: string[];
  risk_score: number;
  reversible: boolean;
}

export interface RollbackPlan {
  strategy: 'revert_commit' | 'restore_workspace' | 'undo_patch' | 'no_rollback';
  steps: string[];
  estimated_cost: 'low' | 'medium' | 'high';
  preconditions: string[];
}

export interface DecisionMemo {
  memo_id: string;
  work_item_id: string;
  run_id: string;
  problem_summary: string;
  chosen_strategy: ChangeStrategy;
  alternatives_rejected: Array<{ strategy: ChangeStrategy; reason: string }>;
  blast_radius: BlastRadiusEstimate;
  rollback_plan: RollbackPlan;
  min_evidence_required: string[];
  confidence: number;
  created_at: string;
}

// ─── BlastRadius estimation ───────────────────────────────────────────────────

function deriveSubsystems(mutationScope: string[]): string[] {
  const seen = new Set<string>();
  for (const p of mutationScope) {
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length >= 2) seen.add(parts[0]);
    else seen.add(p);
  }
  return [...seen];
}

function estimateRiskScore(mutationScope: string[], retryCount: number, riskLevel: string): number {
  let score = 0;
  score += Math.min(0.4, mutationScope.length * 0.05);
  score += retryCount > 0 ? Math.min(0.2, retryCount * 0.05) : 0;
  switch (riskLevel) {
    case 'critical': score += 0.4; break;
    case 'high': score += 0.3; break;
    case 'medium': score += 0.15; break;
    case 'low': score += 0.05; break;
    default: break;
  }
  return Math.min(1, score);
}

export function buildBlastRadius(
  mutationScope: string[],
  retryCount: number,
  riskLevel: string
): BlastRadiusEstimate {
  const risk_score = estimateRiskScore(mutationScope, retryCount, riskLevel);
  return {
    estimated_files: mutationScope.length,
    subsystems: deriveSubsystems(mutationScope),
    risk_score: Math.round(risk_score * 100) / 100,
    reversible: riskLevel !== 'critical' && mutationScope.length <= 10,
  };
}

// ─── RollbackPlan ─────────────────────────────────────────────────────────────

export function buildRollbackPlan(
  blastRadius: BlastRadiusEstimate,
  retryCount: number
): RollbackPlan {
  if (blastRadius.risk_score >= 0.7 || !blastRadius.reversible) {
    return {
      strategy: 'restore_workspace',
      steps: ['snapshot workspace before mutation', 'restore snapshot on failure', 'verify clean state'],
      estimated_cost: 'high',
      preconditions: ['workspace snapshot available', 'no shared-state mutations'],
    };
  }
  if (retryCount > 1 || blastRadius.estimated_files > 5) {
    return {
      strategy: 'revert_commit',
      steps: ['record commit SHA before change', 'git revert on failure'],
      estimated_cost: 'medium',
      preconditions: ['git repo initialized', 'changes committed atomically'],
    };
  }
  return {
    strategy: 'undo_patch',
    steps: ['apply inverse patch'],
    estimated_cost: 'low',
    preconditions: ['original file state recorded'],
  };
}

// ─── StrategySelector ────────────────────────────────────────────────────────

export class StrategySelector {
  select(mutationScope: string[], retryCount: number, riskLevel: string): ChangeStrategy {
    if (riskLevel === 'critical') return 'feature_flag';
    if (retryCount > 1) return 'minimal_patch';
    if (mutationScope.length > 8) return 'isolated_refactor';
    if (riskLevel === 'high') return 'feature_flag';
    if (mutationScope.length > 3) return 'expand_contract';
    if (mutationScope.length === 0) return 'no_op';
    return 'minimal_patch';
  }

  alternatives(chosen: ChangeStrategy, mutationScope: string[], riskLevel: string): Array<{ strategy: ChangeStrategy; reason: string }> {
    const all: ChangeStrategy[] = ['minimal_patch', 'isolated_refactor', 'expand_contract', 'feature_flag', 'no_op'];
    return all
      .filter((s) => s !== chosen)
      .map((s) => ({ strategy: s, reason: this.rejectionReason(s, chosen, mutationScope, riskLevel) }));
  }

  private rejectionReason(s: ChangeStrategy, chosen: ChangeStrategy, mutationScope: string[], riskLevel: string): string {
    switch (s) {
      case 'no_op': return 'mutation scope is non-empty; no-op would not satisfy requirements';
      case 'feature_flag': return riskLevel !== 'critical' && riskLevel !== 'high' ? 'risk level does not warrant feature flag overhead' : `${chosen} preferred for scope size`;
      case 'isolated_refactor': return mutationScope.length <= 8 ? 'scope is small enough for simpler strategy' : `${chosen} preferred`;
      case 'expand_contract': return 'expand-contract requires coordinated deployment; overhead not justified here';
      case 'minimal_patch': return `${chosen} preferred due to scope or risk level`;
      default: return 'not applicable';
    }
  }
}

// ─── Memo builder & persistence ──────────────────────────────────────────────

export interface BuildMemoInput {
  work_item_id: string;
  run_id: string;
  problem_summary: string;
  mutation_scope: string[];
  retry_count: number;
  risk_level: string;
  min_evidence_required?: string[];
  confidence?: number;
}

export function buildMemo(input: BuildMemoInput): DecisionMemo {
  const selector = new StrategySelector();
  const chosen = selector.select(input.mutation_scope, input.retry_count, input.risk_level);
  const blast_radius = buildBlastRadius(input.mutation_scope, input.retry_count, input.risk_level);
  const rollback_plan = buildRollbackPlan(blast_radius, input.retry_count);
  const alternatives_rejected = selector.alternatives(chosen, input.mutation_scope, input.risk_level);

  return {
    memo_id: `memo-${crypto.randomBytes(4).toString('hex')}`,
    work_item_id: input.work_item_id,
    run_id: input.run_id,
    problem_summary: input.problem_summary,
    chosen_strategy: chosen,
    alternatives_rejected,
    blast_radius,
    rollback_plan,
    min_evidence_required: input.min_evidence_required ?? [],
    confidence: input.confidence ?? (1 - blast_radius.risk_score),
    created_at: new Date().toISOString(),
  };
}

function memoDir(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.oxe', 'runs', runId, 'memos');
}

export function saveMemo(projectRoot: string, memo: DecisionMemo): void {
  const dir = memoDir(projectRoot, memo.run_id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${memo.memo_id}.json`), JSON.stringify(memo, null, 2), 'utf8');
}

export function loadMemo(projectRoot: string, runId: string, memoId: string): DecisionMemo | null {
  const p = path.join(memoDir(projectRoot, runId), `${memoId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as DecisionMemo;
  } catch {
    return null;
  }
}

export function listMemos(projectRoot: string, runId: string): DecisionMemo[] {
  const dir = memoDir(projectRoot, runId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as DecisionMemo;
      } catch {
        return null;
      }
    })
    .filter((m): m is DecisionMemo => m !== null);
}
