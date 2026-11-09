'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const changeLib = require('../bin/lib/oxe-change.cjs');

// 1.21.2 — OXB-110: open defects carried between phases (.oxe/OPEN-DEFECTS.json); they block the close unless waived.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-od-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Mais\n\n**Critérios de aceite:** A2\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [
    { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], done: true, verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'sem verify', wave: 1, files: ['src/b.js'], acceptance: ['A1'], done: true },
  ] }, null, 2));
  write(dir, 'src/a.js', 'exports.a = 1;\n');
  write(dir, 'tests/a.test.js', "it('a', () => {});\n");
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  // the phase adds: a TODO, a focused test, a stub — and an old TODO stays out
  write(dir, 'src/a.js', 'exports.a = 1;\n// TODO: handle the empty list\nexports.b = () => { throw new Error(\'not implemented\'); };\n');
  write(dir, 'tests/a.test.js', "it('a', () => {});\nit.only('focus', () => {});\n");
  return dir;
}

describe('OXB-110: OPEN-DEFECTS register', () => {
  it('collects TODO/FIXME added, .only/.skip, stubs, done tasks without verify and open signal CRs', () => {
    const dir = project();
    const programDir = path.join(dir, '.oxe', 'program');
    changeLib.appendNdjson(changeLib.changesFile(programDir), { kind: 'cr', id: 'CR-07', class: 'defect', summary: 'HML-F1-3: botão sem foco', criteria: ['A1'], phase: 'F1', by: 'signal:hml', at: new Date().toISOString(), status: 'open' });
    const out = op.runtimeDefects(dir, null, {});
    const kinds = out.open.map((it) => it.kind).sort();
    assert.deepEqual(kinds, ['signal_cr', 'stub', 'test_skip', 'todo', 'verify_missing']);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'OPEN-DEFECTS.json')));
    const todo = out.open.find((it) => it.kind === 'todo');
    assert.equal(todo.file, 'src/a.js');
    assert.equal(todo.line, 2);
  });

  it('blocks program close until fixed or waived; a waiver survives regeneration', () => {
    const dir = project();
    const close = () => op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false });
    const reasonsOf = (fn) => { try { const r = fn(); return (r.gate && r.gate.reasons) || r.reasons || []; } catch (e) { return [String(e.message)]; } };
    const r1 = reasonsOf(close).join('\n');
    assert.match(r1, /defeito aberto OD-todo-\w+ \[todo\] src\/a\.js:2/);
    assert.match(r1, /defeito aberto OD-test_skip-/);
    const reg = op.runtimeDefects(dir, null, {});
    for (const it of reg.open) {
      const r = spawnSync(process.execPath, [CLI, 'runtime', 'defects', '--waive', it.id, '--by', 'tl', '--reason', 'fica para a fase 2, registrado', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
      assert.equal(r.status, 0, r.stderr + r.stdout);
    }
    const again = op.runtimeDefects(dir, null, {});
    assert.equal(again.open.length, 0, 'waivers kept across regeneration');
    assert.doesNotMatch(reasonsOf(close).join('\n'), /defeito aberto/);
  });

  it('a waiver needs --by and a reason', () => {
    const dir = project();
    const reg = op.runtimeDefects(dir, null, {});
    assert.throws(() => op.runtimeDefects(dir, null, { waive: reg.open[0].id, by: 'tl', reason: 'x' }), /--reason/);
  });
});
