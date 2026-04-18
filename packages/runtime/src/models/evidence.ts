export type EvidenceType =
  | 'diff'
  | 'stdout'
  | 'stderr'
  | 'junit_xml'
  | 'coverage'
  | 'screenshot'
  | 'trace'
  | 'log'
  | 'security_report'
  | 'api_output'
  | 'summary';

export interface Evidence {
  evidence_id: string;
  attempt_id: string;
  type: EvidenceType;
  path: string;
  checksum: string | null;
  created_at: string;
}
