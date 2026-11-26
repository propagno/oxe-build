'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyFailure, compileMissingSymbols, dryRunVerifyCommands, junitFailures, STUB_RE } = require('../bin/lib/oxe-verify-dryrun.cjs');
const sk = require('../bin/lib/oxe-plan-skeleton.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

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
  it('TS/JS skeleton stubs match both runtime output (`Error: TODO T<n>`) and generated body (`throw new Error(\'TODO T<n>: …\')`), while plain `Error: TODO` without T<n> stays broken_command', () => {
    const tsBody = sk.stub('ts', 'export function save(item: Item): Item', { id: 'T3', title: 'fila' });
    assert.equal(STUB_RE.test(tsBody), true, 'generated TS stub body matches STUB_RE');
    assert.equal(junitFailures(JUNIT('Error', tsBody))[0].stub, true, 'junitFailures marks stub: true on skeleton body');

    // Real `node script.mjs` execution over a skeleton-generated .mjs module → verdict is `missing_target` (not `broken_command`)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dryrun-tsstub-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'queue.mjs'), `${sk.stub('js', 'export function drain(n)', { id: 'T3', title: 'fila' })}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'scripts', 'verify-queue.mjs'), "import { drain } from '../src/queue.mjs';\ndrain(1);\n", 'utf8');

    const dry = dryRunVerifyCommands(dir, {
      tasks: [{ id: 'T3', files: ['src/queue.mjs'], verifyCommand: 'node scripts/verify-queue.mjs', done: false }],
    }, { batch: false });
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.equal(dry.results[0].verdict, 'missing_target');

    // Plain `Error: TODO` or `throw new Error('TODO')` WITHOUT `T<n>` must NOT match as a skeleton stub
    assert.equal(STUB_RE.test('Error: TODO'), false);
    assert.equal(STUB_RE.test('Error: TODO fix later'), false);
    assert.equal(STUB_RE.test("throw new Error('TODO');"), false);
    assert.equal(classifyFailure('Error: TODO something unrelated', ['src/queue.mjs'], { targetsExist: true, someTargetsExist: true, missingTargets: [] }), 'broken_command');
  });
});
