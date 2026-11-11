'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// 1.21.2 — OXB-033 (F4 in parallel with F2): the second worktree's .oxe/ needs the program without an active phase,
// and the dependency's delivery checked the promote way (cherry-pick -x into PRs), not by close-commit ancestry.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const ROADMAP = '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Remoções\n\n**Depende de:** F1\n**Critérios de aceite:** A2\n\n## Fase 3 — Outra\n\n**Depende de:** F1\n**Critérios de aceite:** A3\n';

function setup() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-fork-'));
  dirs.push(repo);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); return r.stdout.trim(); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.oxe/\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  // program branch: F1's work (one product commit + one frozen-test import), then F2 work
  g('checkout', '-qb', 'program');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'f1.js'), 'module.exports = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'feat: f1 work');
  const f1work = g('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(repo, 'tests', 'acceptance'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'acceptance', 'f1.test.js'), 'x\n');
  g('add', '-A'); g('commit', '-qm', 'test(acceptance): frozen F1');
  const closed = g('rev-parse', 'HEAD');
  // main gets F1 through promote: cherry-pick -x of the product commit only
  g('checkout', '-q', 'main');
  g('cherry-pick', '-x', f1work);
  g('checkout', '-q', 'program');
  // program .oxe/: F1 closed, F2 active
  const oxe = path.join(repo, '.oxe');
  fs.mkdirSync(path.join(oxe, 'program', 'regression'), { recursive: true });
  fs.mkdirSync(path.join(oxe, 'dossier', 'F1'), { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n| A3 | c | m |\n');
  fs.writeFileSync(path.join(oxe, 'ROADMAP.md'), ROADMAP);
  fs.writeFileSync(path.join(oxe, 'config.json'), '{}');
  fs.writeFileSync(path.join(oxe, 'PLAN.json'), '{"schema_version":1,"tasks":[]}');
  fs.writeFileSync(path.join(oxe, 'dossier', 'F1', 'plan.md'), '# F1\n');
  fs.writeFileSync(path.join(oxe, 'program', 'regression', 'F1.json'), '{"checks":[]}');
  op.runtimeProgramInit(repo, null, {});
  const st = programLib.readProgram(path.join(oxe, 'program'));
  Object.assign(st.phases[0], { status: 'closed', base_commit: base, closed_commit: closed, closed_at: 'x' });
  Object.assign(st.phases[1], { status: 'planning', started_at: 'x' });
  st.active_phase = 'F2';
  programLib.writeProgram(path.join(oxe, 'program'), st);
  // the parallel worktree, off main
  const wt = `${repo}-f3`;
  dirs.push(wt);
  g('worktree', 'add', '-q', wt, '-b', 'f3', 'main');
  return { repo, wt, f1work };
}

describe('OXB-033: program init --from for a parallel phase', () => {
  it('copies the program without an active phase (+ closed phases\' regression and dossier), checks F1 delivery the promote way, starts F3', () => {
    const { repo, wt } = setup();
    const out = op.runtimeProgramInitFrom(wt, null, { from: repo, phase: 'F3' });
    assert.equal(out.started, 'F3');
    const st = programLib.readProgram(path.join(wt, '.oxe', 'program'));
    assert.equal(st.active_phase, 'F3');
    assert.equal(st.phases.find((p) => p.id === 'F2').status, 'planning', 'F2 stays as it was; it is not active here');
    assert.ok(fs.existsSync(path.join(wt, '.oxe', 'program', 'regression', 'F1.json')));
    assert.ok(fs.existsSync(path.join(wt, '.oxe', 'dossier', 'F1', 'plan.md')));
    assert.ok(!fs.existsSync(path.join(wt, '.oxe', 'PLAN.json')), 'no plan of another phase');
    const d = out.delivery.find((x) => x.phase === 'F1');
    assert.deepEqual([d.checked, d.delivered.length, d.missing.length, d.skipped_frozen], [1, 1, 0, 1], JSON.stringify(d));
    // the source is untouched
    assert.equal(programLib.readProgram(path.join(repo, '.oxe', 'program')).active_phase, 'F2');
  });

  it('a dependency commit with no equivalent on the base is reported; --strict-delivery blocks; F2 (active there) is refused', () => {
    const { repo, wt } = setup();
    const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    // a second F1 product commit that never reached main
    g('checkout', '-q', 'program');
    fs.writeFileSync(path.join(repo, 'src', 'f1b.js'), 'module.exports = 2;\n');
    g('add', '-A'); g('commit', '-qm', 'feat: f1 extra never promoted');
    const st = programLib.readProgram(path.join(repo, '.oxe', 'program'));
    st.phases[0].closed_commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
    programLib.writeProgram(path.join(repo, '.oxe', 'program'), st);
    assert.throws(() => op.runtimeProgramInitFrom(wt, null, { from: repo, phase: 'F2' }), /F2 está ativa em/);
    assert.throws(() => op.runtimeProgramInitFrom(wt, null, { from: repo, phase: 'F3', strictDelivery: true }), /F1 não está toda em HEAD: 1 de 2 commit\(s\)/);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'init', '--from', repo, '--phase', 'F3', '--dir', wt], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /F1 entregue na base: 1\/2 commit\(s\) . sem equivalente na base: [0-9a-f]{8} feat: f1 extra never promoted/);
    assert.match(r.stdout, /fase F3 iniciada nesta worktree/);
  });
});
