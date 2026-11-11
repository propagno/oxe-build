'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const runtime = require('../lib/runtime');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const specEdit = require('../bin/lib/oxe-spec-edit.cjs');
const ids = require('../bin/lib/oxe-criteria-ids.cjs');

// 1.21.2 — OXB-037: the SPEC's A* were too coarse for the UI (DESIGN wrote per-screen ACs) and there were no
// subcriteria. OXB-038: any A<n> in ROADMAP text became a SPEC criterion (the DESIGN's A1–A12 had to become UA1…).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = `---
oxe_doc: spec
inputs: [docs/ui-acceptance.md]
---

# SPEC

## Objetivo

x

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | a base funciona | manual |
| A19 | a tela de Settings | manual |
| A19.1 | Settings: estado vazio | manual |
| A19.2 | Settings: erro de rede | manual |
| A20 | outra fase | manual |
| G1 | contraste AA em toda tela | manual |
`;

function project({ tasks, phaseAcceptance = ['A1', 'A19'], roadmap }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ids-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'ui-acceptance.md'), '# UI\n\n- A1 a lista carrega\n- A3 o botão some\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  if (roadmap) fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), roadmap);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks }, null, 2));
  const phase = (id, acceptance, status) => ({ id, title: id, requirements: [], acceptance, scope: null, status, plan_ref: null, run_id: null, started_at: null, closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F1', created_at: 'x', updated_at: 'x', phases: [phase('F1', phaseAcceptance, 'executing'), phase('F2', ['A20'], 'pending')] }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const ok = { commands: ['node -e "process.exit(0)"'] };

describe('OXB-038: criterion ids only from structured fields', () => {
  it('the ROADMAP acceptance line ignores ids in parentheses and code spans, and keeps subcriteria and globals', () => {
    const [phase] = runtime.parseRoadmapPhases('## Fase 1 — UI\n\n**Critérios de aceite:** A1, A19 (telas do DESIGN: A3, A7) `A9`, G1\n');
    assert.deepEqual(phase.acceptance, ['A1', 'A19', 'G1']);
    assert.deepEqual(ids.idsInField('A1 (ver A2 (e A3)) A4'), ['A1', 'A4']);
  });

  it('program init warns on a phase criterion the SPEC does not declare; plan lint warns on input docs reusing SPEC ids', () => {
    const dir = project({ tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A1', 'A19'], verify: ok }], roadmap: '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A19, A33\n' });
    fs.rmSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'));
    const init = op.runtimeProgramInit(dir, null, {});
    assert.ok(init.warnings.some((w) => /F1: A33 não é critério da SPEC — id de outro documento\?/.test(w)), init.warnings.join('\n'));
    const lint = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(lint.warnings.some((w) => /docs\/ui-acceptance\.md usa A1, os mesmos ids de critérios da SPEC — renomeie lá \(ex\.: UA1\)/.test(w)), lint.warnings.join('\n'));
  });
});

describe('OXB-037: subcriteria A<n>.<m> and global criteria G<n>', () => {
  it('SPEC rows, PLAN.json acceptance and spec add accept them; a sub needs its parent and is not a numbering gap', () => {
    assert.deepEqual(specEdit.criteriaIds(SPEC), ['A1', 'A19', 'A19.1', 'A19.2', 'A20', 'G1']);
    assert.deepEqual(planJson.validatePlanJson({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['a.tsx'], acceptance: ['A19.1', 'G1'] }] }), []);
    const added = specEdit.addCriterion(SPEC, 'A19.3', { text: 'Settings: carregando', verify: 'manual' });
    assert.match(added.text || added, /\| A19\.3 \| Settings: carregando \| manual \|/);
    assert.throws(() => specEdit.addCriterion(SPEC, 'A7.1', { text: 'x', verify: 'y' }), /o critério pai A7 não existe/);
    assert.throws(() => specEdit.addCriterion(SPEC, 'G1', { text: 'x', verify: 'y' }), /G1 já existe/);
  });

  it('lint: a parent with subcriteria is covered only by all of them; a sub is of its parent\'s phase; G* is global', () => {
    const partial = project({ tasks: [
      { id: 'T1', title: 'base', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: ok },
      { id: 'T2', title: 'settings vazio', wave: 1, files: ['src/Settings.tsx'], acceptance: ['A19.1', 'G1'], verify: ok },
    ] });
    let lint = op.runtimePlanLint(partial, null, { preflight: false });
    assert.ok(lint.errors.some((e) => /fase F1: A\* da fase sem tarefa: A19\.2$/.test(e)), lint.errors.join('\n'));
    assert.ok(!lint.errors.some((e) => /de outras fases/.test(e)), 'A19.1 and G1 are not of other phases');
    const full = project({ tasks: [
      { id: 'T1', title: 'base', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: ok },
      { id: 'T2', title: 'settings', wave: 1, files: ['src/Settings.tsx'], acceptance: ['A19.1', 'A19.2'], verify: ok },
    ] });
    lint = op.runtimePlanLint(full, null, { preflight: false });
    assert.ok(!lint.errors.some((e) => /sem tarefa/.test(e)), lint.errors.join('\n'));
    assert.ok(lint.warnings.some((w) => /critérios globais sem tarefa de UI que os cubra: G1 \(o plano tem 1 tarefa\(s\) de UI: T2\)/.test(w)), lint.warnings.join('\n'));
    const other = project({ tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A1', 'A19', 'A20'], verify: ok }] });
    lint = op.runtimePlanLint(other, null, { preflight: false });
    assert.ok(lint.errors.some((e) => /o plano usa A\* de outras fases: A20/.test(e)));
    assert.deepEqual(runtime.acceptanceOutsidePhase({ acceptance: ['A19'] }, ['A19.2', 'G3', 'A20']), ['A20']);
  });
});
