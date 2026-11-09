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
  | 'verify'           // inline verification command failed after execution
  | 'llm'              // LLM exhausted turn budget without calling finish_task
  | 'context'          // OXB-148: the prompt does not fit the model window — retrying the same prompt cannot help
  | 'quota'            // OXB-148: provider usage limit / rate limit — retrying now only burns attempts
  | 'scope_insufficient' // OXB-171: the task cannot pass inside its files (the frozen test needs a file outside them)
  | 'environment'      // OXB-120: the machine, not the code (exit 126/127, missing tool, network) — pauses the run
  | 'waiting_answer'   // OXB-125: the executor asked a blocking question the artifacts could not answer
  | null;              // success — no failure
