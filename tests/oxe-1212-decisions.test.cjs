'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const dec = require('../bin/lib/oxe-decisions.cjs');

// 1.21.2 — OXB-112: decisions as first-class ids D-<fase>-<n>; tasks cite them; the verify checks the evidence; the
// lint points at decisions no task cites.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

function project(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dec-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Mais\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks }, null, 2));
  write(dir, 'src/a.js', 'exports.a = 1;\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-112: decision ids', () => {
  it('decision add gives D-<fase>-<n>, numbered per phase; list shows them', () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }]);
    const a = cli(dir, 'decision', 'add', '--title', 'SQLite local, sem servidor', '--by', 'tl');
    assert.equal(a.status, 0, a.stderr + a.stdout);
    assert.match(a.stdout, /D-F1-1 . SQLite local/);
    assert.match(cli(dir, 'decision', 'add', '--title', 'IPC tipado por canal', '--check', 'node -e 0').stdout, /D-F1-2/);
    assert.match(cli(dir, 'decision', 'add', '--title', 'outra fase', '--phase', 'F2').stdout, /D-F2-1/);
    const list = JSON.parse(cli(dir, 'decision', 'list', '--json').stdout).decisions.map((d) => d.id);
    assert.deepEqual(list, ['D-F1-1', 'D-F1-2', 'D-F2-1']);
    assert.ok(dec.DECISION_ID_RE.test('D-SPIKE-T4') && dec.DECISION_ID_RE.test('D-7') && !dec.DECISION_ID_RE.test('D-'));
  });

  it('lint: a task citing an unknown decision is an error; a phase decision no task cites is a warning', () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], decisions: ['D-F1-1', 'D-F1-9'], verify: { commands: ['node -e 0'] } }]);
    cli(dir, 'decision', 'add', '--title', 'SQLite local, sem servidor');
    cli(dir, 'decision', 'add', '--title', 'ninguém implementa esta');
    cli(dir, 'decision', 'add', '--title', 'da outra fase', '--phase', 'F2');
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.errors.some((e) => /T1: cita a decisão D-F1-9, que não existe/.test(e)), lint.errors.join('\n'));
    assert.ok(lint.warnings.some((w) => /decisão D-F1-2 .* não é citada/.test(w)));
    assert.ok(!lint.warnings.some((w) => /D-F1-1|D-F2-1/.test(w)), 'cited / other phase: no warning');
  });

  it('a decision\'s check becomes an implicit phase-verify gate (decision-<id>; red → defect CR like any gate)', () => {
    const dir = project([{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], decisions: ['D-F1-1'], verify: { commands: ['node -e 0'] } }]);
    cli(dir, 'decision', 'add', '--title', 'sem dependência de rede', '--check', 'node -e "process.exit(1)"');
    const gates = dec.decisionGates(dec.list(path.join(dir, '.oxe', 'program')), JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')), 'F1');
    assert.deepEqual(gates.map((g) => g.id), ['decision-D-F1-1']);
    assert.equal(gates[0].command, 'node -e "process.exit(1)"');
  });
});
