'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { windowsCommand } = require('../bin/lib/oxe-verify-dryrun.cjs');
const { decodeConsoleOutput } = require('../bin/lib/oxe-console-decode.cjs');
const rt = require('../lib/runtime');

// 1.21.2 - OXB-152 (F10): `./mobile/android/gradlew …` was a broken_command in cmd.exe, and its message arrived as
// "'.' n\uFFFDo \uFFFD reconhecido" (cp850 read as UTF-8).

describe('OXB-152: POSIX launchers on Windows and readable cmd errors', () => {
  it('gradlew / mvnw map to their batch siblings in every segment; other commands are untouched', () => {
    assert.equal(windowsCommand('./mobile/android/gradlew -p mobile/android testDebugUnitTest --tests X && npx vitest run a'), 'mobile\\android\\gradlew.bat -p mobile/android testDebugUnitTest --tests X && npx vitest run a');
    assert.equal(windowsCommand('./mvnw -q test'), 'mvnw.cmd -q test');
    assert.equal(rt.windowsLaunchers('gradlew test'), 'gradlew.bat test');
    assert.equal(windowsCommand('npm run typecheck'), 'npm run typecheck');
  });
  it('cmd output in cp850 is decoded; valid UTF-8 stays UTF-8', () => {
    const cp850 = Buffer.from([0x27, 0x2e, 0x27, 0x20, 0x6e, 0xc6, 0x6f, 0x20, 0x82, 0x20, 0x72, 0x65]);
    assert.equal(decodeConsoleOutput(cp850), "'.' não é re");
    assert.equal(rt.decodeConsoleOutput(cp850), "'.' não é re");
    assert.equal(decodeConsoleOutput(Buffer.from('ação ✓', 'utf8')), 'ação ✓');
  });
});
