export type GateDecisionValue =
  | 'approved'
  | 'rejected'
  | 'approved_with_caveats'
  | 'needs_more_evidence';

export type GateScope =
  | 'plan_approval'
  | 'critical_mutation'
  | 'security'
  | 'pr_promotion'
  | 'merge';

export interface GateDecision {
  gate_id: string;
  scope: GateScope;
  decision: GateDecisionValue;
  actor: string;
  reason: string | null;
  timestamp: string;
}
