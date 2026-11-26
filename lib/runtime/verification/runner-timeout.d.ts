/**
 * A test runner's own per-test timeout ("Test timed out in 5000ms") with no failed assertion: machine load or a slow
 * start, not the code. F1 of oxespace-152-code: check-a1 failed on one such timeout as "deterministic" while the same
 * file passed in the governance gate of the same verify and, alone, 28/28 in 4.2 s.
 */
/** True when the failing output shows a runner timeout and no failed assertion. */
export declare function isRunnerTimeoutOnly(output: string): boolean;
