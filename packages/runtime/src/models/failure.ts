/**
 * Canonical failure classification used by TaskResult and VerificationManifest.
 * Both must import from this file — never redefine inline.
 */
export type FailureClass =
  | 'env'              // infrastructure / environment problem (network, disk, permissions)
  | 'policy'           // blocked by policy engine before execution
  | 'test'             // verification / acceptance test failed
  | 'timeout'          // task or run exceeded time budget
  | 'evidence_missing' // required evidence was not collected
  | null;              // success — no failure
