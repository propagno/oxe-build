'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-091: A70 ("visual totalmente polido, erros na interface não serão admitidos") must hold at EVERY phase
// close (F3–F11), but a criterion belonged to one phase only ("A70 já pertence a F3").

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project(config = { external_dependency_check: false, program: { standing_acceptance: ['A70'] } }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-st-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a base | manual |\n| A10 | f4 | manual |\n| A70 | visual polido | sign-off DESIGN + HML |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.tsx'], acceptance: ['A10', 'A70'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
  const ph = (id, acceptance, status) => ({ id, title: id, requirements: [], acceptance, scope: null, status, plan_ref: '.oxe/PLAN.md', run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F4', created_at: 'x', updated_at: 'x', phases: [ph('F3', ['A1', 'A70'], 'closed'), ph('F4', ['A10'], 'executing'), { ...ph('F5', [], 'pending'), plan_ref: null, started_at: null }] }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), '# R\n\n## Fase 3 — a\n\n**Critérios de aceite:** A1, A70\n\n## Fase 4 — b\n\n**Critérios de aceite:** A10\n\n## Fase 5 — c\n\n**Critérios de aceite:** —\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-091: standing criteria', () => {
  it('lint: a standing criterion in F4 is not "of another phase" and needs no frozen test', () => {
    const lint = op.runtimePlanLint(project(), null, { preflight: false });
    assert.ok(!lint.errors.some((e) => /outras fases: .*A70/.test(e)), lint.errors.join('\n'));
    assert.ok(!lint.warnings.concat(lint.errors).some((m) => /sem teste de aceite congelado: .*A70/.test(m)));
    const plain = op.runtimePlanLint(project({ external_dependency_check: false }), null, { preflight: false });
    assert.ok(plain.errors.some((e) => /o plano usa A\* de outras fases: A70/.test(e)), 'without standing_acceptance nothing changes');
  });

  it('close needs this phase\'s sign-off of A70 WITH evidence; a sign-off of another phase or without evidence does not count', () => {
    const dir = project();
    const signoffs = path.join(dir, '.oxe', 'program', 'signoffs.ndjson');
    fs.writeFileSync(signoffs, `${JSON.stringify({ phase: 'F3', criteria: ['A70'], by: 'design', at: 'x', evidence: 'docs/f3-ui.md' })}\n${JSON.stringify({ phase: 'F4', criteria: ['A70'], by: 'design', at: 'x', evidence: null })}\n`);
    let closed = op.runtimeProgramClose(dir, null, { dossier: false, gates: false, runState: { status: 'completed', verification_check_results: [{ check_id: 'c1', status: 'pass' }] } });
    assert.ok((closed.gate.reasons || []).some((r) => /critério permanente A70: falta o sign-off da fase F4 com evidência/.test(r)), JSON.stringify(closed.gate));
    op.runtimeSignoff ? op.runtimeSignoff(dir, null, { phase: 'F4', criteria: 'A70', by: 'design', evidence: 'docs/f4-ui.md' })
      : fs.appendFileSync(signoffs, `${JSON.stringify({ phase: 'F4', criteria: ['A70'], by: 'design', at: 'x', evidence: 'docs/f4-ui.md' })}\n`);
    closed = op.runtimeProgramClose(dir, null, { dossier: false, gates: false, commit: false, runState: { status: 'completed', verification_check_results: [{ check_id: 'c1', status: 'pass' }] } });
    assert.ok(!(closed.gate.reasons || []).some((r) => /A70/.test(r)), JSON.stringify(closed.gate));
  });

  it('phase edit refuses adding a standing criterion; spec add --standing registers it in config', () => {
    const dir = project();
    assert.throws(() => op.runtimeProgramPhaseEdit(dir, null, { phase: 'F5', addAcceptance: 'A70', by: 'tl', reason: 'gate de UI da fase' }), /A70 é permanente/);
    op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A71', text: 'acessibilidade AA', verify: 'axe limpo', standing: true, by: 'tl', reason: 'gate permanente de a11y' });
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'config.json'), 'utf8'));
    assert.deepEqual(cfg.program.standing_acceptance, ['A70', 'A71']);
  });
});
