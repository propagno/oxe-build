'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dryRunVerifyCommands, classifyFailure, hasSingleQuotedArgument } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21.2 — OXB-040: in the F1 dry-verify, 6 of 7 errors were legitimate reds classified as broken_command.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dc-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  // `node say.js <text>` prints the text and exits 1: a stand-in for a test runner's output.
  fs.writeFileSync(path.join(dir, 'say.js'), "process.stdout.write(require('fs').readFileSync(process.argv[2], 'utf8')); process.exit(1);\n");
  return dir;
}
const out = (dir, name, text) => { fs.writeFileSync(path.join(dir, name), text); return `node say.js ${name}`; };

describe('OXB-040: dry-verify classification per file', () => {
  it('a task that changes an existing file and adds a new one: a failing assertion is assertion_red', () => {
    const dir = project({ 'src/prefs.js': 'module.exports = {};\n' });
    const cmd = out(dir, 'o1.txt', 'AssertionError: expected undefined to equal "dark"\n  at test/prefs.test.js:4\n');
    const r = dryRunVerifyCommands(dir, { tasks: [{ id: 'T6', files: ['src/prefs.js', 'src/theme.js'], verifyCommand: cmd }] });
    assert.equal(r.results[0].verdict, 'assertion_red', JSON.stringify(r));
    assert.equal(r.errors.length, 0);
  });

  it('the dependents of that task are not dragged into broken_command', () => {
    const dir = project({ 'src/prefs.js': 'module.exports = {};\n' });
    const cmd = out(dir, 'o2.txt', "Error: Cannot find module './theme.js'\nRequire stack:\n- src/use-theme.js\n");
    const r = dryRunVerifyCommands(dir, {
      tasks: [
        { id: 'T6', files: ['src/prefs.js', 'src/theme.js'], verifyCommand: null },
        { id: 'T8', files: ['src/use-theme.js'], dependsOn: ['T6'], verifyCommand: cmd },
      ],
    });
    assert.equal(r.results.find((x) => x.task === 'T8').verdict, 'missing_target');
  });

  it('a missing target directory (Windows separators) is missing_target; an existing directory proves nothing', () => {
    const dir = project({ 'src/design/README.md': 'x\n' });
    const scandir = out(dir, 'o3.txt', "Error: ENOENT: no such file or directory, scandir 'C:\\\\proj\\\\src\\\\design\\\\icons'\n");
    const r = dryRunVerifyCommands(dir, { tasks: [{ id: 'T3', files: ['src/design/icons/close.svg'], verifyCommand: scandir }] });
    assert.equal(r.results[0].verdict, 'missing_target', JSON.stringify(r.results[0]));
    // "src/design" exists: a not-found that only names it is not the task's missing target.
    assert.equal(classifyFailure('not found: src/design', ['src/design/icons/close.svg'], { projectRoot: dir, missingTargets: ['src/design/icons/close.svg'] }), 'broken_command');
  });

  it('single quotes on win32: a warning, and the broken_command error says the likely cause', () => {
    const dir = project({});
    const cmd = `${out(dir, 'o4.txt', 'unknown flag: .[0].conclusion\n')} --jq '.[0].conclusion'`;
    const r = dryRunVerifyCommands(dir, { tasks: [{ id: 'T12', files: [], verifyCommand: cmd }] }, { platform: 'win32' });
    assert.ok(r.warnings.some((w) => /T12: o verify usa aspas simples/.test(w)), r.warnings.join('\n'));
    assert.match(r.errors.join('\n'), /provável causa: aspas simples no Windows/);
    const linux = dryRunVerifyCommands(dir, { tasks: [{ id: 'T12', files: [], verifyCommand: cmd }] }, { platform: 'linux' });
    assert.ok(!linux.warnings.some((w) => /aspas simples/.test(w)));
    assert.equal(hasSingleQuotedArgument(`node -e "it's fine"`), false);
  });

  it('a tool error is still broken_command even with existing files', () => {
    assert.equal(classifyFailure("Unknown option '--foo'\nAssertionError: x", ['src/a.js'], { someTargetsExist: true, missingTargets: [] }), 'broken_command');
  });
});
