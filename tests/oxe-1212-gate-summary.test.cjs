'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gates = require('../bin/lib/oxe-phase-gates.cjs');
const change = require('../bin/lib/oxe-change.cjs');

// 1.21.2 — OXB-070: CR-16 (gate lint) quoted the first of 217 warnings; the failure was 2 `error` lines at the end.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const warnings = Array.from({ length: 217 }, (_, i) => `  ${285 + i}:3  warning  Error: Cannot access refs during render  react-hooks/refs`);
const ESLINT = [
  '',
  'C:\\oxespace\\src\\renderer\\components\\ThreadGrid.tsx',
  ...warnings.slice(0, 200),
  'C:\\oxespace\\src\\main\\ipc\\workspaces.ts',
  ...warnings.slice(200),
  '  41:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
  '  88:9   error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
  '',
  '✖ 219 problems (2 errors, 217 warnings)',
].join('\n');

describe('OXB-070: a failed gate is summarized by the lines that make it fail', () => {
  it('eslint: the 2 error lines (with their file), never a warning; the problem count closes the excerpt', () => {
    const out = gates.firstErrorLines({ stdout: ESLINT, stderr: '' });
    const lines = out.split('\n');
    assert.match(lines[0], /workspaces\.ts:41:17\s+error\s+Unexpected any/);
    assert.match(lines[1], /workspaces\.ts:88:9\s+error\s+Unexpected any/);
    assert.ok(!/warning/.test(lines.slice(0, 2).join('\n')), out);
    assert.match(lines[lines.length - 1], /219 problems \(2 errors, 217 warnings\)/);
  });

  it('tsc, vitest and TAP markers; with no marker, the tail of the output', () => {
    assert.match(gates.firstErrorLines({ stdout: 'x\nsrc/a.ts(3,1): error TS2322: Type string is not assignable\nFound 1 error.' }), /^src\/a\.ts\(3,1\): error TS2322/);
    assert.match(gates.firstErrorLines({ stdout: ' ✓ ok one\n × store > adds a task\n AssertionError: expected 1 to be 2\n Tests  1 failed | 9 passed' }), /^× store > adds a task\nAssertionError/);
    assert.match(gates.firstErrorLines({ stdout: 'TAP version 13\nok 1 - a\nnot ok 2 - b\n' }), /^not ok 2 - b/);
    const tail = gates.firstErrorLines({ stdout: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') }, 3);
    assert.equal(tail, 'line 27\nline 28\nline 29');
  });

  it('the CR summary quotes the first failing line', () => {
    const programDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-gs-'));
    dirs.push(programDir);
    gates.recordGateFailures({ programDir, program: null, plan: { tasks: [] }, checkResults: [{ check_id: 'gate-lint', status: 'fail', stdout: ESLINT, stderr: '' }] });
    const cr = change.listChanges(programDir)[0];
    assert.match(cr.summary, /gate do projeto 'lint' reprovou no verify da fase: .*workspaces\.ts:41:17\s+error\s+Unexpected any/);
    assert.doesNotMatch(cr.summary, /warning/);
  });
});
