import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { runCheck } from '../src/verification/verification-compiler';
import type { AcceptanceCheck } from '../src/verification/verification-compiler';

// 1.21.2 - OXB-150: a gradle `--tests Class` verify prints no per-test names; JUnit writes them to
// build/test-results/**/*.xml. The verify reads the reports this command wrote, so `proves` sees each test.

const XML = `<?xml version="1.0"?>
<testsuite name="com.oxespace.mobile.ui.theme.AttnUsageTest" tests="3" failures="0" errors="0">
  <testcase name="theNoticeNeverUsesTheSun()" classname="AttnUsageTest" time="0.01"/>
  <testcase name="theScanFindsTheUiSources()" classname="AttnUsageTest" time="0.01"/>
  <testcase name="theSunIsNeverNextToAnErrorAWarningOrAFailure()" classname="AttnUsageTest" time="0.01"/>
</testsuite>`;

describe('OXB-150: JUnit XML files of a gradle verify', () => {
  test('per-test names and counts come from the XML the command wrote; an old report does not count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-junit-'));
    try {
      const reports = path.join(dir, 'app', 'build', 'test-results', 'testDebugUnitTest');
      fs.mkdirSync(reports, { recursive: true });
      // a stand-in for `./gradlew test --tests AttnUsageTest`: writes the report, prints nothing per test
      const script = path.join(dir, 'fake-gradle.js');
      fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(path.join(reports, 'TEST-AttnUsageTest.xml'))}, ${JSON.stringify(XML)}); console.log('BUILD SUCCESSFUL');`);
      const check = { id: 'check-accept-a70', type: 'unit', command: `node fake-gradle.js gradle`, proves: ['theNoticeNeverUsesTheSun', 'theScanFindsTheUiSources'], acceptance_ref: 'A70', evidence_type_expected: 'stdout' } as unknown as AcceptanceCheck;
      const ok = await runCheck(check, dir);
      assert.equal(ok.status, 'pass', `${ok.error}`);
      assert.equal((ok as any).tests_executed, 3);
      const missing = { ...check, proves: ['aTestThatDoesNotExist'] } as AcceptanceCheck;
      const res = await runCheck(missing, dir);
      assert.equal(res.status, 'fail');
      assert.match(String(res.error), /proof_not_executed: aTestThatDoesNotExist — testes que passaram: theNoticeNeverUsesTheSun\(\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
