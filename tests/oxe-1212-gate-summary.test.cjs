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

describe('OXB-045: the checkpoint commit never carries an unfilled template placeholder', () => {
  const conv = require('../bin/lib/oxe-commit-convention.cjs');
  const config = { commit_convention: { template: '{type}({scope}): {message}', type: 'feat', pattern: '^(feat|fix|test|docs|chore|refactor)(\([^)]+\))?: .+', require_task_message: false } };

  it('{message} is the task title (F1: three checkpoints were "feat: {message}")', () => {
    assert.equal(conv.checkpointSubject({ id: 'T4', title: 'add workspace color column' }, config), 'feat: add workspace color column');
    const msg = conv.checkpointMessage({ id: 'T4', title: 'add workspace color column' }, config);
    assert.doesNotMatch(msg, /\{\w+\}/);
    assert.match(msg, /OXE-Task: T4/);
  });

  it('lint reports an unknown placeholder and simulates every task message against the pattern', () => {
    const errors = conv.lintCommitConvention({ tasks: [{ id: 'T4', title: 'x' }] }, { commit_convention: { template: '{type}: {msg}', pattern: '^feat: .{3,}' } });
    assert.ok(errors.some((e) => /placeholder desconhecido: \{msg\}/.test(e)), errors.join('\n'));
    assert.ok(errors.some((e) => /T4: mensagem do checkpoint "feat: x" não segue/.test(e)), errors.join('\n'));
    assert.doesNotMatch(conv.checkpointSubject({ id: 'T4', title: 'x' }, { commit_convention: { template: '{type}: {msg}' } }), /\{/);
  });
});
