'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const rigor = require('../bin/lib/oxe-test-rigor.cjs');

// 1.21.2 — OXB-109: a frozen test must exercise real code, not assert on the source text; the exception is declared.
// `plan lint --mutation` samples mutants of what each done task's test imports.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project(plan, files, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rigor-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify(plan, null, 2));
  for (const [rel, c] of Object.entries(files)) write(dir, rel, c);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}

const TEXT_TEST = "const fs = require('fs');\nconst src = fs.readFileSync('src/menu.js', 'utf8');\nif (!src.includes('label')) process.exit(1);\n";
const REAL_TEST = "const { isOpen } = require('../../src/gate.js');\nif (isOpen(5) !== true || isOpen(1) !== false) process.exit(1);\n";

describe('OXB-109: source assertions', () => {
  it('a pending task\'s test that only reads source text is flagged; an import-based test is not; a declared exception passes', () => {
    const plan = { schema_version: 1, tasks: [
      { id: 'T1', title: 'menu', wave: 1, files: ['src/menu.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
      { id: 'T2', title: 'gate', wave: 1, files: ['src/gate.js'], acceptance: ['A2'], verify: { commands: ['node -e 0'] } },
    ], acceptance_tests: [
      { criterion: 'A1', task: 'T1', files: ['tests/acceptance/menu.test.js'], command: 'node tests/acceptance/menu.test.js' },
      { criterion: 'A2', task: 'T2', files: ['tests/acceptance/gate.test.js'], command: 'node tests/acceptance/gate.test.js' },
    ] };
    const files = { 'src/menu.js': "module.exports = 'label';\n", 'src/gate.js': 'exports.isOpen = (n) => n > 3;\n', 'tests/acceptance/menu.test.js': TEXT_TEST, 'tests/acceptance/gate.test.js': REAL_TEST };
    const dir = project(plan, files);
    const lint = op.runtimePlanLint(dir, null, {});
    const msgs = lint.warnings.filter((w) => /afirma sobre o TEXTO/.test(w));
    assert.equal(msgs.length, 1, msgs.join('\n'));
    assert.match(msgs[0], /^T1: tests\/acceptance\/menu\.test\.js afirma sobre o TEXTO do código \(lê src\/menu\.js\)/);
    // the declared exception
    plan.acceptance_tests[0].rigor = 'source-assertion';
    plan.acceptance_tests[0].rigor_reason = 'teste de governança: o rótulo é texto literal no menu';
    write(dir, '.oxe/PLAN.json', JSON.stringify(plan));
    assert.ok(!op.runtimePlanLint(dir, null, {}).warnings.some((w) => /afirma sobre o TEXTO/.test(w)));
    // lint.test_rigor: "error" and a reason-less exception
    plan.acceptance_tests[0].rigor_reason = '';
    write(dir, '.oxe/PLAN.json', JSON.stringify(plan));
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, lint: { test_rigor: 'error' } }));
    const strict = op.runtimePlanLint(dir, null, {});
    assert.ok(strict.errors.some((e) => /rigor_reason/.test(e)), strict.errors.join('\n'));
  });
});

describe('OXB-109: mutation sample', () => {
  it('mutants of the imported file: a strong test kills them, a weak one lets some survive; the real tree is untouched', () => {
    const WEAK = "const { isOpen } = require('../../src/gate.js');\nisOpen(5);\n"; // asserts nothing
    const plan = { schema_version: 1, tasks: [
      { id: 'T1', title: 'gate', wave: 1, files: ['src/gate.js'], acceptance: ['A1'], done: true },
      { id: 'T2', title: 'gate2', wave: 1, files: ['src/gate.js'], acceptance: ['A2'], done: true },
    ], acceptance_tests: [
      { criterion: 'A1', task: 'T1', files: ['tests/acceptance/strong.test.js'], command: 'node tests/acceptance/strong.test.js' },
      { criterion: 'A2', task: 'T2', files: ['tests/acceptance/weak.test.js'], command: 'node tests/acceptance/weak.test.js' },
    ] };
    const gate = 'exports.isOpen = (n) => {\n  if (n > 3) return true;\n  return false;\n};\n';
    const dir = project(plan, { 'src/gate.js': gate, 'tests/acceptance/strong.test.js': REAL_TEST, 'tests/acceptance/weak.test.js': WEAK });
    const lint = op.runtimePlanLint(dir, null, { mutation: true });
    const rep = lint.test_rigor.mutation;
    const strong = rep.find((r) => r.file.endsWith('strong.test.js'));
    const weak = rep.find((r) => r.file.endsWith('weak.test.js'));
    assert.ok(strong.mutants >= 2);
    assert.equal(strong.survived.length, 0, JSON.stringify(strong));
    assert.equal(weak.killed, 0);
    assert.ok(weak.survived.length >= 2);
    assert.ok(lint.warnings.some((w) => /weak\.test\.js: 0\/\d+ mutantes mortos/.test(w)));
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'gate.js'), 'utf8'), gate, 'the real tree is never mutated');
    assert.equal(git(dir, 'worktree', 'list').stdout.trim().split(/\r?\n/).length, 1, 'temporary worktree removed');
  });

  it('mutantsOf skips comments and imports', () => {
    const m = rigor.mutantsOf("// a === b\nimport x from 'y';\nconst ok = a === b;\nreturn true;\n", 5);
    assert.deepEqual(m.map((x) => x.line), [3, 4]);
  });
});
