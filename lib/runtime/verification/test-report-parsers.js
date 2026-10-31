"use strict";
/**
 * Parsers that turn raw test-runner output into a structured summary.
 *
 * Exit code 0 is not proof that anything was verified: `node --test a.js missing.js`
 * exits 0 and only prints "Could not find 'missing.js'", and a command that executed
 * zero tests verified nothing. These helpers give the verification compiler the signal
 * it needs to refuse that kind of false green.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTestReport = parseTestReport;
exports.extractTestFileArgs = extractTestFileArgs;
function toInt(value) {
    if (value == null)
        return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function countLines(text, re) {
    return (text.match(re) ?? []).length;
}
function parseTestReport(output) {
    const text = output || '';
    const missing_files = [...text.matchAll(/Could not find '([^']+)'/g)].map((m) => m[1]);
    const empty = (format) => ({
        format,
        tests_executed: null,
        passed: null,
        failed: null,
        missing_files,
    });
    // node:test — TAP reporter (non-TTY default) or spec reporter (TTY default)
    const nodeTests = text.match(/^(?:# |ℹ )tests (\d+)/m);
    if (nodeTests) {
        return {
            format: 'tap',
            tests_executed: toInt(nodeTests[1]),
            passed: toInt(text.match(/^(?:# |ℹ )pass (\d+)/m)?.[1]),
            failed: toInt(text.match(/^(?:# |ℹ )fail (\d+)/m)?.[1]),
            missing_files,
        };
    }
    // jest — "Tests:       1 failed, 2 passed, 3 total"
    const jest = text.match(/^Tests:\s+.*?(\d+) total/m);
    if (jest) {
        const line = jest[0];
        return {
            format: 'jest',
            tests_executed: toInt(jest[1]),
            passed: toInt(line.match(/(\d+) passed/)?.[1]) ?? 0,
            failed: toInt(line.match(/(\d+) failed/)?.[1]) ?? 0,
            missing_files,
        };
    }
    // vitest — "Tests  1 failed | 2 passed (3)"
    const vitest = text.match(/^\s*Tests\s+(.+?)\((\d+)\)/m);
    if (vitest) {
        return {
            format: 'vitest',
            tests_executed: toInt(vitest[2]),
            passed: toInt(vitest[1].match(/(\d+) passed/)?.[1]) ?? 0,
            failed: toInt(vitest[1].match(/(\d+) failed/)?.[1]) ?? 0,
            missing_files,
        };
    }
    // mocha — "3 passing" / "1 failing" / "2 pending"
    const mocha = text.match(/^\s*(\d+) passing\b/m);
    if (mocha) {
        const passed = toInt(mocha[1]) ?? 0;
        const failed = toInt(text.match(/^\s*(\d+) failing\b/m)?.[1]) ?? 0;
        const pending = toInt(text.match(/^\s*(\d+) pending\b/m)?.[1]) ?? 0;
        return { format: 'mocha', tests_executed: passed + failed + pending, passed, failed, missing_files };
    }
    // pytest — "===== 2 passed, 1 failed in 0.12s ====="
    const pytest = text.match(/^=+ .*\b\d+ (?:passed|failed|error)\b.* in [\d.]+s/m);
    if (pytest) {
        const line = pytest[0];
        const passed = toInt(line.match(/(\d+) passed/)?.[1]) ?? 0;
        const failed = (toInt(line.match(/(\d+) failed/)?.[1]) ?? 0) + (toInt(line.match(/(\d+) error/)?.[1]) ?? 0);
        return { format: 'pytest', tests_executed: passed + failed, passed, failed, missing_files };
    }
    // JUnit XML — <testsuite tests="3" failures="1" errors="0">
    const junit = text.match(/<testsuites?\b[^>]*\btests="(\d+)"/);
    if (junit) {
        const tests = toInt(junit[1]) ?? 0;
        const failures = toInt(text.match(/\bfailures="(\d+)"/)?.[1]) ?? 0;
        const errors = toInt(text.match(/\berrors="(\d+)"/)?.[1]) ?? 0;
        return { format: 'junit', tests_executed: tests, passed: tests - failures - errors, failed: failures + errors, missing_files };
    }
    // Generic TAP plan — "1..N" with "ok"/"not ok" lines
    const tapPlan = text.match(/^1\.\.(\d+)/m);
    if (tapPlan) {
        return {
            format: 'tap',
            tests_executed: toInt(tapPlan[1]),
            passed: countLines(text, /^ok\b/gm),
            failed: countLines(text, /^not ok\b/gm),
            missing_files,
        };
    }
    return empty(null);
}
const TEST_RUNNER_SEGMENT_RE = /(^|\s)(--test|jest|vitest|mocha|pytest)(\s|$)/;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test|tests|__tests__|spec)\/.+\.(?:[cm]?[jt]sx?|py)$/;
/**
 * Explicit test-file arguments of a verify command (e.g. `node --test test/a.test.js`).
 * Globs are left to the runner; inline scripts (`-e`) are ignored entirely.
 */
function extractTestFileArgs(command) {
    const files = [];
    for (const segment of String(command || '').split(/&&|\|\||;|\|/)) {
        const trimmed = segment.trim();
        if (!trimmed || !TEST_RUNNER_SEGMENT_RE.test(trimmed) || /(^|\s)-e(\s|$)/.test(trimmed))
            continue;
        const tokens = trimmed.split(/\s+/).map((token) => token.replace(/^["']|["']$/g, ''));
        for (const token of tokens.slice(1)) {
            if (!token || token.startsWith('-'))
                continue;
            if (/[*?{[]/.test(token))
                continue;
            if (TEST_FILE_RE.test(token))
                files.push(token);
        }
    }
    return [...new Set(files)];
}
