'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// 1.21.2 — OXB-033: in 1.5.0, F3 (worktrees, backend) does not depend on F2 (Settings, frontend), but the program
// only let a phase start after every earlier phase closed — five roles held to the slowest phase.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const ROADMAP = `# Roteiro

## Fase 1 — Base

**Critérios de aceite:** A1

## Fase 2 — Settings (frontend)

**Depende de:** F1
**Critérios de aceite:** A2

## Fase 3 — Worktrees (backend)

**Depende de:** F1 (não depende da F2)
**Critérios de aceite:** A3

## Fase 4 — Modos

**Critérios de aceite:** A4
`;

function project(dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dag-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n| A3 | c | m |\n| A4 | d | m |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), ROADMAP);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  op.runtimeProgramInit(dir, null, {});
  return dir;
}
const read = (dir) => programLib.readProgram(path.join(dir, '.oxe', 'program'));
const closeHere = (dir, id) => {
  const s = read(dir);
  const p = s.phases.find((x) => x.id === id);
  Object.assign(p, { status: 'closed', closed_at: new Date().toISOString(), closed_commit: 'abc' });
  if (s.active_phase === id) s.active_phase = null;
  programLib.writeProgram(path.join(dir, '.oxe', 'program'), s);
  fs.mkdirSync(path.join(dir, '.oxe', 'program', 'regression'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'regression', `${id}.json`), JSON.stringify({ schema_version: 1, phase: id, checks: [{ id: `chk-${id}`, command: 'node -e 0' }] }));
};

describe('OXB-033: phases as a DAG', () => {
  it('**Depende de:** is parsed; F4 without the line keeps the serial default (all earlier phases)', () => {
    const dir = project();
    const s = read(dir);
    assert.deepEqual(s.phases.map((p) => [p.id, p.depends_on || null]), [['F1', null], ['F2', ['F1']], ['F3', ['F1']], ['F4', null]]);
  });

  it('with F1 closed, F3 starts while F2 is open; F4 still needs F1–F3', () => {
    const dir = project();
    closeHere(dir, 'F1');
    const st = op.runtimeProgramStart(dir, null, 'F3');
    assert.equal(st.state.active_phase, 'F3');
    closeHere(dir, 'F3');
    assert.throws(() => op.runtimeProgramStart(dir, null, 'F4'), /feche antes: F2/);
    // regression: every closed phase other than the target (F3 closed before F2)
    const reg = programLib.loadRegressionChecks(path.join(dir, '.oxe', 'program'), read(dir), 'F2').map((c) => c.id);
    assert.deepEqual(reg, ['reg-f1-chk-F1', 'reg-f3-chk-F3']);
  });

  it('a cycle or an unknown dependency is refused at init; phase edit --depends-on updates PROGRAM.json and ROADMAP', () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dag-'));
    dirs.push(bad);
    fs.mkdirSync(path.join(bad, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(bad, '.oxe', 'ROADMAP.md'), '## Fase 1 — a\n\n**Depende de:** F2\n\n## Fase 2 — b\n\n**Depende de:** F1\n');
    assert.throws(() => op.runtimeProgramInit(bad, null, {}), /ciclo de dependência entre fases: F1 → F2 → F1/);
    const dir = project();
    op.runtimeProgramPhaseEdit(dir, null, { phase: 'F4', dependsOn: 'F1,F3', by: 'tl', reason: 'modos não dependem de settings' });
    assert.deepEqual(read(dir).phases.find((p) => p.id === 'F4').depends_on, ['F1', 'F3']);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), 'utf8'), /## Fase 4 — Modos\n\n\*\*Critérios de aceite:\*\* A4\n\*\*Depende de:\*\* F1, F3\n/);
    assert.throws(() => op.runtimeProgramPhaseEdit(dir, null, { phase: 'F3', dependsOn: 'F4', by: 'tl', reason: 'teste de ciclo' }), /ciclo de dependência entre fases/);
    assert.equal(read(dir).phases.find((p) => p.id === 'F3').depends_on[0], 'F1', 'nothing written on a refused edit');
  });

  it('program adopt brings a phase closed in another worktree (status, close, regression); the dependents can start', () => {
    const main = project();
    const other = project();
    closeHere(main, 'F1');
    closeHere(other, 'F1');
    // F3 ran and closed in the other worktree while F2 runs here.
    op.runtimeProgramStart(main, null, 'F2');
    closeHere(other, 'F3');
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'adopt', '--from', other, '--by', 'tl', '--reason', 'F3 fechada na worktree do backend', '--dir', main], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /adotadas: F3/);
    const s = read(main);
    const f3 = s.phases.find((p) => p.id === 'F3');
    assert.equal(f3.status, 'closed');
    assert.equal(f3.closed_commit, 'abc');
    assert.equal(s.active_phase, 'F2', 'the active phase here is untouched');
    assert.ok(fs.existsSync(path.join(main, '.oxe', 'program', 'regression', 'F3.json')));
    assert.match(fs.readFileSync(path.join(main, '.oxe', 'program', 'changes.ndjson'), 'utf8'), /"action":"phase_adopt","phases":\["F3"\]/);
    // Adopting again changes nothing; F2 (active here) is never overwritten.
    closeHere(other, 'F2');
    const again = op.runtimeProgramAdopt(main, null, { from: other });
    assert.deepEqual(again.adopted, []);
    assert.match(again.skipped.join('\n'), /F2: está ativa aqui/);
  });
});
