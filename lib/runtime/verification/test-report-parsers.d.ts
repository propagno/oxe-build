/**
 * Parsers that turn raw test-runner output into a structured summary.
 *
 * Exit code 0 is not proof that anything was verified: `node --test a.js missing.js`
 * exits 0 and only prints "Could not find 'missing.js'", and a command that executed
 * zero tests verified nothing. These helpers give the verification compiler the signal
 * it needs to refuse that kind of false green.
 */
export type TestReportFormat = 'tap' | 'jest' | 'vitest' | 'mocha' | 'pytest' | 'junit';
export interface TestReportSummary {
    format: TestReportFormat | null;
    /** Number of test cases the runner reported, or null when no report was recognized. */
    tests_executed: number | null;
    passed: number | null;
    failed: number | null;
    /** Test files a runner reported as missing (node --test: "Could not find '<file>'"). */
    missing_files: string[];
}
export declare function parseTestReport(output: string): TestReportSummary;
/**
 * Explicit test-file arguments of a verify command (e.g. `node --test test/a.test.js`).
 * Globs are left to the runner; inline scripts (`-e`) are ignored entirely.
 */
export declare function extractTestFileArgs(command: string): string[];
export interface TestResultNames {
    passed: string[];
    failed: string[];
}
/**
 * Names of the tests a runner reported as passed / failed (1.20 "executed proof"). Supported outputs: TAP
 * (`node --test`, `ok 1 - name`), vitest `--reporter=verbose` (`✓ file > suite > name 5ms`), jest `--verbose`
 * and mocha (`✓ name`), pytest `-v` (`path::name PASSED`) and JUnit XML `<testcase name=…>`.
 * Default (non-verbose) vitest/jest output lists no passed names: the plan must use a verbose reporter.
 */
export declare function extractTestResults(output: string): TestResultNames;
/** Expected proofs (test names, or `file › name`) that do not appear among the passed tests. */
export declare function missingProofs(expected: string[], output: string): string[];
