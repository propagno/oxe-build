"use strict";
/**
 * A test runner's own per-test timeout ("Test timed out in 5000ms") with no failed assertion: machine load or a slow
 * start, not the code. F1 of oxespace-152-code: check-a1 failed on one such timeout as "deterministic" while the same
 * file passed in the governance gate of the same verify and, alone, 28/28 in 4.2 s.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRunnerTimeoutOnly = isRunnerTimeoutOnly;
/** vitest / jest / mocha / node:test, as they print it. */
const RUNNER_TIMEOUT_RE = /\bTest timed out in \d+\s*ms\b|\bTimeout of \d+\s*ms exceeded\b|\bExceeded timeout of \d+\s*ms\b|\bexceeded timeout\b|\btest timed out after \d+\s*ms\b/i;
/** An assertion that really failed — then the timeout, if any, is not the whole story. */
const ASSERTION_FAIL_RE = /\bAssertionError\b|\bAssertError\b|^\s*Expected[:\s]|\bexpected\b[^\n]{0,200}\bto (?:be|equal|deeply|have|contain|match|include|throw|strictly)\b|\bassert\.\w+\(|Error: expect\(/m;
/** True when the failing output shows a runner timeout and no failed assertion. */
function isRunnerTimeoutOnly(output) {
    const text = String(output || '');
    return RUNNER_TIMEOUT_RE.test(text) && !ASSERTION_FAIL_RE.test(text);
}
