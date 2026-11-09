'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const reviewLib = require('../bin/lib/oxe-plan-review.cjs');

// 1.21.2 — OXB-111: adversarial plan review (plan lint --review) with PLAN-REVIEW.md; a FAIL blocks execute.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

const BAD = { schema_version: 1, tasks: [
  { id: 'T1', title: 'store', wave: 1, files: ['src/store.js'], acceptance: ['A1'], decisions: ['D-9'], verify: { commands: ['node -e 0'] } },
  { id: 'T2', title: 'menu', wave: 1, files: ['src/store.js', 'src/orphan-widget.js'], acceptance: ['A2'], verify: { commands: ['node -e 0'] } },
  { id: 'T3', title: 'no verify', wave: 2, depends_on: ['T1'], files: ['src/x.js'], acceptance: ['A1'] },
  { id: 'T4', title: 'everything', wave: 2, files: ['**'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
], acceptance_tests: [{ criterion: 'A1', task: 'T1', files: ['tests/acceptance/a1.test.js'], command: 'node tests/acceptance/a1.test.js' }] };

function project(plan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rev-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n| A3 | c | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2, A3\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify(plan, null, 2));
  write(dir, 'src/store.js', 'exports.s = 1;\n');
  write(dir, 'src/x.js', 'exports.x = 1;\n');
  write(dir, 'tests/acceptance/a1.test.js', "require('../../src/store.js');\n");
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-111: plan lint --review', () => {
  it('a verdict per dimension, PLAN-REVIEW.md written, FAILs are lint errors', () => {
    const dir = project(BAD);
    const lint = op.runtimePlanLint(dir, null, { review: true });
    assert.ok(lint.review, JSON.stringify(lint.errors));
    const v = lint.review.verdicts;
    assert.equal(v.coverage, 'FAIL', 'A3 has no task');
    assert.equal(v.completeness, 'FAIL', 'T3 has no verify');
    assert.equal(v.coupling, 'FAIL', 'T1 and T2 both edit src/store.js with no order');
    assert.equal(v.links, 'WARN', 'src/orphan-widget.js: nothing wires it');
    assert.equal(v.scope, 'FAIL', 'T4: **');
    assert.equal(v.verification, 'FAIL', 'T1 verify runs none of its frozen tests');
    assert.equal(v.decisions, 'PASS', 'no decisions.ndjson yet → unknown ids not judged');
    const md = fs.readFileSync(path.join(dir, '.oxe', 'PLAN-REVIEW.md'), 'utf8');
    assert.match(md, /\| Acoplamento temporal não declarado \| FAIL \| 1 \|/);
    assert.match(md, /T1 e T2 mexem em src\/store\.js sem dependência/);
    assert.ok(lint.errors.some((e) => /revisão do plano · Cobertura: A3: nenhuma tarefa cobre/.test(e)));
    assert.equal(lint.ok, false);
  });

  it('a FAIL of the current plan blocks execute; a waiver unblocks; a changed plan makes the review stale', async () => {
    const plan = JSON.parse(JSON.stringify(BAD));
    const dir = project(plan);
    op.runtimePlanLint(dir, null, { review: true });
    const pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.blockers.some((b) => /^plan_review:coupling/.test(b)), pre.blockers.join('\n'));
    for (const d of ['coverage', 'completeness', 'coupling', 'scope', 'verification']) {
      const r = spawnSync(process.execPath, [CLI, 'plan', 'lint', '--review', '--waive', d, '--by', 'tl', '--reason', 'aceito nesta fase, registrado', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
      assert.ok(r.status === 0 || r.status === 1, r.stderr);
    }
    const pre2 = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(!pre2.blockers.some((b) => /^plan_review:/.test(b)), pre2.blockers.join('\n'));
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'PLAN-REVIEW.md'), 'utf8'), /## Dispensas/);
    plan.tasks[0].title = 'store v2';
    write(dir, '.oxe/PLAN.json', JSON.stringify(plan, null, 2));
    const pre3 = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre3.warnings.some((w) => /plan_review: .*outra versão do plano/.test(w)));
  });

  it('a clean plan passes every dimension', () => {
    const good = { schema_version: 1, tasks: [
      { id: 'T1', title: 'store', wave: 1, files: ['src/store.js'], acceptance: ['A1', 'A2', 'A3'], verify: { commands: ['node tests/acceptance/a1.test.js'] } },
    ], acceptance_tests: [
      { criterion: 'A1', task: 'T1', files: ['tests/acceptance/a1.test.js'], command: 'node tests/acceptance/a1.test.js' },
      { criterion: 'A2', task: 'T1', files: ['tests/acceptance/a1.test.js'], command: 'node tests/acceptance/a1.test.js' },
      { criterion: 'A3', task: 'T1', files: ['tests/acceptance/a1.test.js'], command: 'node tests/acceptance/a1.test.js' },
    ] };
    const dir = project(good);
    const rev = reviewLib.review(dir, good, { phaseCriteria: ['A1', 'A2', 'A3'] });
    assert.deepEqual(Object.values(rev.dimensions).map((d) => d.verdict), reviewLib.DIMENSIONS.map(() => 'PASS'));
  });
});
