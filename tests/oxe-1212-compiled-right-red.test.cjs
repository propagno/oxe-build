'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, compileMissingSymbols } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21.2 - OXB-154 (F10, Kotlin/gradle): frozen tests that fail because the task's code is not there yet were all
// "broken_command" - at compile time (missing symbols) and, with a skeleton in, at run time (TODO stubs, assertions).

const JUNIT = (type, msg) => `<testsuite tests="1" failures="1"><testcase name="theNoticeNeverUsesTheSun()" classname="com.oxespace.mobile.ui.theme.AttnUsageTest"><failure message="${msg}" type="${type}">${type}: ${msg}</failure></testcase></testsuite>`;
const PROVED = { provedFiles: ['mobile/android/app/src/test/java/com/oxespace/mobile/ui/theme/AttnUsageTest.kt'] };

describe('OXB-154: right-red in compiled languages', () => {
  it('compile errors name the missing symbols (Kotlin, Java, tsc)', () => {
    assert.deepEqual(compileMissingSymbols("e: file:///a/AttnUsageTest.kt:(12, 5): Unresolved reference 'attnColor'.\nB.java:3: error: cannot find symbol\n  symbol:   method sumTwo(int)\nx.test.ts(1,10): error TS2305: Module './a' has no exported member 'makeThing'."), ['attnColor', 'sumTwo', 'makeThing']);
  });
  it('a compile error on the task pack symbols is missing_target; on any other symbol it stays broken', () => {
    assert.equal(classifyFailure("e: Unresolved reference 'attnColor'", ['ui/Attn.kt'], { symbols: ['attnColor'] }), 'missing_target');
    assert.equal(classifyFailure("e: Unresolved reference 'attnColor'\ne: Unresolved reference 'somethingElse'", ['ui/Attn.kt'], { symbols: ['attnColor'] }), 'broken_command');
  });
  it('a stub that runs (Kotlin TODO / NotImplementedError / UnsupportedOperationException TODO) is missing_target', () => {
    assert.equal(classifyFailure('kotlin.NotImplementedError: An operation is not implemented: F10 R7', ['a.kt'], {}), 'missing_target');
    assert.equal(classifyFailure('java.lang.UnsupportedOperationException: TODO F10 R7', ['A.java'], {}), 'missing_target');
    assert.equal(classifyFailure(JUNIT('kotlin.NotImplementedError', 'An operation is not implemented: F10 R7'), ['a.kt'], PROVED), 'missing_target');
  });
  it('a JUnit assertion failure in a test file the task proves is assertion_red; gradle configuration errors stay broken', () => {
    assert.equal(classifyFailure(`BUILD FAILED\n${JUNIT('org.opentest4j.AssertionFailedError', 'expected: &lt;1&gt; but was: &lt;2&gt;')}`, ['a.kt'], PROVED), 'assertion_red');
    assert.equal(classifyFailure(`BUILD FAILED\n${JUNIT('org.opentest4j.AssertionFailedError', 'x')}`, ['a.kt'], { provedFiles: ['OtherTest.kt'] }), 'broken_command');
    assert.equal(classifyFailure("Task 'testDebugUnitTestX' not found in project ':app'.", ['a.kt'], { symbols: ['x'] }), 'broken_command');
  });
});
