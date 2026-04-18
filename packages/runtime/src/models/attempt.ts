export type AttemptOutcome =
  | 'success'
  | 'failure_env'
  | 'failure_policy'
  | 'failure_test'
  | 'failure_timeout'
  | 'cancelled';

export interface Attempt {
  attempt_id: string;
  work_item_id: string;
  attempt_number: number;
  workspace_id: string | null;
  agent_profile: string | null;
  model: string | null;
  started_at: string;
  ended_at: string | null;
  outcome: AttemptOutcome | null;
}
