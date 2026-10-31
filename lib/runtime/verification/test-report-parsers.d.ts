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
