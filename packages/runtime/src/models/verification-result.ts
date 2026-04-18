export type VerificationStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface VerificationResult {
  verification_id: string;
  work_item_id: string;
  check_id: string;
  status: VerificationStatus;
  evidence_refs: string[];
  summary: string | null;
}
