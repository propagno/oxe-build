"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const verification_compiler_1 = require("../src/verification/verification-compiler");
// 1.21.2 - OXB-150: a gradle `--tests Class` verify prints no per-test names; JUnit writes them to
// build/test-results/**/*.xml. The verify reads the reports this command wrote, so `proves` sees each test.
const XML = `<?xml version="1.0"?>
<testsuite name="com.oxespace.mobile.ui.theme.AttnUsageTest" tests="3" failures="0" errors="0">
  <testcase name="theNoticeNeverUsesTheSun()" classname="AttnUsageTest" time="0.01"/>
  <testcase name="theScanFindsTheUiSources()" classname="AttnUsageTest" time="0.01"/>
  <testcase name="theSunIsNeverNextToAnErrorAWarningOrAFailure()" classname="AttnUsageTest" time="0.01"/>
</testsuite>`;
(0, node_test_1.describe)('OXB-150: JUnit XML files of a gradle verify', () => {
    (0, node_test_1.test)('per-test names and counts come from the XML the command wrote; an old report does not count', async () => {
        const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-junit-'));
        try {
            const reports = path_1.default.join(dir, 'app', 'build', 'test-results', 'testDebugUnitTest');
            fs_1.default.mkdirSync(reports, { recursive: true });
            // a stand-in for `./gradlew test --tests AttnUsageTest`: writes the report, prints nothing per test
            const script = path_1.default.join(dir, 'fake-gradle.js');
            fs_1.default.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(path_1.default.join(reports, 'TEST-AttnUsageTest.xml'))}, ${JSON.stringify(XML)}); console.log('BUILD SUCCESSFUL');`);
            const check = { id: 'check-accept-a70', type: 'unit', command: `node fake-gradle.js gradle`, proves: ['theNoticeNeverUsesTheSun', 'theScanFindsTheUiSources'], acceptance_ref: 'A70', evidence_type_expected: 'stdout' };
            const ok = await (0, verification_compiler_1.runCheck)(check, dir);
            strict_1.default.equal(ok.status, 'pass', `${ok.error}`);
            strict_1.default.equal(ok.tests_executed, 3);
            const missing = { ...check, proves: ['aTestThatDoesNotExist'] };
            const res = await (0, verification_compiler_1.runCheck)(missing, dir);
            strict_1.default.equal(res.status, 'fail');
            strict_1.default.match(String(res.error), /proof_not_executed: aTestThatDoesNotExist — testes que passaram: theNoticeNeverUsesTheSun\(\)/);
        }
        finally {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
});
