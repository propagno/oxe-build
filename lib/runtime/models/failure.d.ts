/**
 * Canonical failure classification used by TaskResult and VerificationManifest.
 * Both must import from this file — never redefine inline.
 */
export type FailureClass = 'env' | 'policy' | 'test' | 'timeout' | 'evidence_missing' | 'verify' | 'llm' | null;
