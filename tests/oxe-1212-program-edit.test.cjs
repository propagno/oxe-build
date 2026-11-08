'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const specEdit = require('../bin/lib/oxe-spec-edit.cjs');
const change = require('../bin/lib/oxe-change.cjs');

// 1.21.2 — OXB-058: what the oxespace TECH LEAD had to do by hand on 07/11 (A40 clauses; phone phase F8 with R14 and
// A42–A47 inserted before the old F8, which became F9).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
const ndjson = (dir) => read(dir, '.oxe/program/changes.ndjson').trim().split('\n').map((l) => JSON.parse(l));

const SPEC = `# SPEC

## Objetivo

x

## Requisitos

| R-ID | Requisito | Versão | Critério de aceite |
|------|-----------|--------|--------------------|
| R1 | base | v1 | A1 |
| R2 | instalador | v1 | A40 |

## Critérios de aceite

| ID | Critério | Como verificar |
|----|----------|----------------|
| A1 | a base funciona | npm test |
| A40 | o instalador sobe (fase F8) | manual |
| A41 | o update funciona | manual |

### Fora do escopo

- nada
`;

const ROADMAP = `# Roteiro

## Fase 7 — Base

**Requisitos:** R1
**Critérios de aceite:** A1
**Escopo:** base

## Fase 8 — Instalador

**Requisitos:** R2
**Critérios de aceite:** A40, A41
**Escopo:** instalador

---

## Fora do escopo (v2+)
`;

function phase(id, extra = {}) {
  return { id, title: id, requirements: [], acceptance: [], scope: null, status: 'pending', plan_ref: null, run_id: null, started_at: null, closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null, ...extra };
}

function project({ spec = SPEC, roadmap = ROADMAP, phases, config = {}, gitignoreOxe = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pe-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), spec);
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), roadmap);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  const state = {
    schema_version: 1, roadmap_ref: '.oxe/ROADMAP.md', active_phase: 'F7', created_at: 'x', updated_at: 'x',
    phases: phases || [
      phase('F7', { title: 'Base', acceptance: ['A1'], status: 'executing', plan_ref: '.oxe/PLAN.md', started_at: 'x' }),
      phase('F8', { title: 'Instalador', acceptance: ['A40', 'A41'] }),
    ],
  };
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify(state, null, 2));
  if (gitignoreOxe) fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-058: spec amend / spec add', () => {
  it('amend appends a clause to A40 of a phase not planned yet, bumps the version and records before/after', () => {
    const dir = project();
    const out = op.runtimeSpecAmend(dir, null, { id: 'A40', append: 'install-over sobre os bytes publicados', by: 'tech-lead', reason: 'cláusulas do review de 07/11', additive: true });
    assert.equal(out.version, 2);
    assert.equal(out.phase, 'F8');
    assert.match(read(dir, '.oxe/SPEC.md'), /\| A40 \| o instalador sobe \(fase F8\); install-over sobre os bytes publicados \| manual \|/);
    const cr = ndjson(dir).find((r) => r.kind === 'cr');
    assert.equal(cr.class, 'spec_gap');
    assert.equal(cr.amendment, 'additive');
    assert.equal(cr.amend_to, 2);
    assert.equal(cr.phase, 'F8');
    assert.match(cr.spec_edit.before, /o instalador sobe \(fase F8\) \|/);
    assert.match(cr.spec_edit.after, /install-over/);
    const again = op.runtimeSpecAmend(dir, null, { id: 'A40', append: 'HML-R-1', by: 'tech-lead', reason: 'segunda cláusula do review' });
    assert.equal(again.version, 3);
  });

  it('amend refuses an unknown criterion and a missing reason, without touching the SPEC', () => {
    const dir = project();
    assert.throws(() => op.runtimeSpecAmend(dir, null, { id: 'A99', text: 'x', by: 'tl', reason: 'motivo suficiente' }), /A99 não está/);
    assert.throws(() => op.runtimeSpecAmend(dir, null, { id: 'A40', text: 'x', by: 'tl' }), /motivo/);
    assert.equal(read(dir, '.oxe/SPEC.md'), SPEC);
  });

  it('add criterion / requirement: unique, no gaps, recorded in changes.ndjson', () => {
    const dir = project();
    assert.throws(() => op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A41', text: 'x', verify: 'y', by: 'tl', reason: 'fase do celular' }), /A41 já existe/);
    assert.throws(() => op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A43', text: 'x', verify: 'y', by: 'tl', reason: 'fase do celular' }), /buraco.*A42/);
    assert.throws(() => op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A42', text: 'x', by: 'tl', reason: 'fase do celular' }), /--verify/);
    op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A42', text: 'o celular pareia', verify: 'vitest pair', by: 'tl', reason: 'fase do celular' });
    op.runtimeSpecAdd(dir, null, { kind: 'requirement', id: 'R3', text: 'app do celular', criteria: 'A42', by: 'tl', reason: 'fase do celular' });
    const spec = read(dir, '.oxe/SPEC.md');
    assert.match(spec, /\| A41 \| o update funciona \| manual \|\n\| A42 \| o celular pareia \| vitest pair \|/);
    assert.match(spec, /\| R2 \| instalador \| v1 \| A40 \|\n\| R3 \| app do celular \| v1 \| A42 \|/);
    const recs = ndjson(dir).filter((r) => r.kind === 'spec_edit');
    assert.deepEqual(recs.map((r) => [r.action, r.id, r.by]), [['add_criterion', 'A42', 'tl'], ['add_requirement', 'R3', 'tl']]);
    assert.ok(recs.every((r) => r.at && r.reason && r.after && r.before === null));
    assert.deepEqual(change.listChanges(path.join(dir, '.oxe', 'program')), [], 'spec_edit records are not CRs');
  });

  it('add requirement with no requirements table creates one before the given heading', () => {
    const noReq = SPEC.replace(/## Requisitos[\s\S]*?(?=## Critérios)/, '');
    const out = specEdit.addRequirement(noReq, 'R1', { text: 'celular', criteria: 'A42', before: '### Fora do escopo' });
    assert.match(out.text.replace(/\r\n/g, '\n'), /\| R-ID \| Requisito \| Versão \| Critério de aceite \|\n\|[-|]+\|\n\| R1 \| celular \| v1 \| A42 \|\n\n### Fora do escopo/);
  });
});

describe('OXB-058: program phase add --after', () => {
  it('inserts F8 after F7, renumbers the pending F8 to F9 (ROADMAP and PROGRAM), moves change records and warns about leftovers', () => {
    const dir = project();
    op.runtimeSpecAmend(dir, null, { id: 'A40', append: 'HML-R-1', by: 'tl', reason: 'cláusula de homologação' });
    fs.writeFileSync(path.join(dir, '.oxe', 'LESSONS.md'), '- na F8 o instalador precisa de assinatura\n');
    const out = op.runtimeProgramPhaseAdd(dir, null, { after: 'F7', title: 'Celular', requirements: 'R3', acceptance: 'A42,A43', scope: 'app de pareamento', by: 'tl' });
    assert.equal(out.phase, 'F8');
    assert.deepEqual(out.renumbered, [{ from: 'F8', to: 'F9' }]);
    assert.equal(out.moved_change_records, 1);
    const program = JSON.parse(read(dir, '.oxe/program/PROGRAM.json'));
    assert.deepEqual(program.phases.map((p) => [p.id, p.title]), [['F7', 'Base'], ['F8', 'Celular'], ['F9', 'Instalador']]);
    assert.deepEqual(program.phases[1].acceptance, ['A42', 'A43']);
    const roadmap = read(dir, '.oxe/ROADMAP.md');
    assert.match(roadmap, /## Fase 7 — Base[\s\S]*## Fase 8 — Celular\n\n\*\*Requisitos:\*\* R3\n\*\*Critérios de aceite:\*\* A42, A43\n\*\*Escopo:\*\* app de pareamento\n\n## Fase 9 — Instalador/);
    const recs = ndjson(dir);
    assert.equal(recs.find((r) => r.kind === 'cr').phase, 'F9', 'the A40 CR follows its phase');
    assert.equal(recs.at(-1).action, 'phase_add');
    assert.ok(out.leftovers.some((l) => /^SPEC\.md:\d+: menciona F8/.test(l)), out.leftovers.join('\n'));
    assert.ok(out.leftovers.some((l) => /^LESSONS\.md:1: menciona F8/.test(l)));
    assert.ok(out.warnings.some((w) => /A42 não está/.test(w)));
    // The program parser reads the new ROADMAP the same way.
    const runtime = require('../lib/runtime/index.js');
    assert.deepEqual(runtime.parseRoadmapPhases(roadmap).map((p) => p.id), ['F7', 'F8', 'F9']);
  });

  it('refuses when a phase it would renumber has started', () => {
    const dir = project({
      phases: [
        phase('F7', { status: 'closed' }),
        phase('F8', { status: 'pending', plan_ref: '.oxe/PLAN.md' }),
      ],
    });
    assert.throws(() => op.runtimeProgramPhaseAdd(dir, null, { after: 'F7', title: 'Celular', by: 'tl' }), /F8 \(pending, com plano\) já começou/);
    assert.equal(read(dir, '.oxe/ROADMAP.md'), ROADMAP);
  });

  it('inserting after the last phase renumbers nothing', () => {
    const dir = project();
    const out = op.runtimeProgramPhaseAdd(dir, null, { after: 'F8', title: 'Celular', by: 'tl' });
    assert.equal(out.phase, 'F9');
    assert.deepEqual(out.renumbered, []);
    assert.match(read(dir, '.oxe/ROADMAP.md'), /## Fase 8 — Instalador[\s\S]*## Fase 9 — Celular[\s\S]*---\n\n## Fora do escopo/);
  });
});

describe('OXB-058: program export and the doctor warning', () => {
  it('export writes SPEC, ROADMAP, PROGRAM.json and changes.ndjson with the same names; edits refresh it when configured', () => {
    const dir = project({ config: { program: { export_dir: 'docs/roadmap-1.5/oxe' } } });
    op.runtimeSpecAdd(dir, null, { kind: 'criterion', id: 'A42', text: 'o celular pareia', verify: 'vitest', by: 'tl', reason: 'fase do celular' });
    const target = path.join(dir, 'docs', 'roadmap-1.5', 'oxe');
    assert.deepEqual(fs.readdirSync(target).sort(), ['PROGRAM.json', 'ROADMAP.md', 'SPEC.md', 'changes.ndjson']);
    assert.match(fs.readFileSync(path.join(target, 'SPEC.md'), 'utf8'), /A42/);
    const out = op.runtimeProgramExport(dir, null, { dir: 'mirror' });
    assert.equal(out.dir, 'mirror');
    assert.equal(out.written.length, 4);
    assert.throws(() => op.runtimeProgramExport(dir, null, { dir: '.oxe/x' }), /dentro de \.oxe/);
    assert.throws(() => op.runtimeProgramExport(dir, null, { dir: '.' }), /raiz do projeto/, 'OXB-083: never into the project root');
  });

  it('warns when .oxe/ is gitignored and no export_dir is set, with the exact command', () => {
    assert.match(op.oxeHistoryWarning(project()), /oxe-cc program export --out docs\/oxe/);
    assert.equal(op.oxeHistoryWarning(project({ config: { program: { export_dir: 'docs/oxe' } } })), null);
    assert.equal(op.oxeHistoryWarning(project({ gitignoreOxe: false })), null);
  });
});

describe('OXB-058: the CLI', () => {
  const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

  it('spec add, spec amend --additive, program phase add and program export end to end', () => {
    const dir = project();
    let r = run(dir, 'spec', 'add', 'criterion', 'A42', '--text', 'o celular pareia', '--verify', 'vitest pair', '--by', 'tl', '--reason', 'fase do celular');
    assert.equal(r.status, 0, r.stderr);
    r = run(dir, 'spec', 'amend', 'A40', '--append', 'HML-R-1', '--by', 'tl', '--reason', 'cláusula de homologação', '--additive', '--json');
    assert.equal(r.status, 0, r.stderr);
    const amend = JSON.parse(r.stdout);
    assert.equal(amend.cr.amendment, 'additive');
    r = run(dir, 'program', 'phase', 'add', '--after', 'F7', '--title', 'Celular', '--acceptance', 'A42', '--by', 'tl');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fase F8 inserida depois de F7 · renumeradas: F8->F9|fase F8 inserida depois de F7 · renumeradas: F8→F9/);
    r = run(dir, 'program', 'export', '--out', 'docs/oxe');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'oxe', 'changes.ndjson')));
    // OXB-083: the positional is the project dir; the output defaults to program.export_dir, never the repo root.
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ program: { export_dir: 'docs/roadmap/oxe' } }));
    r = spawnSync(process.execPath, [CLI, 'program', 'export', '.'], { cwd: dir, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'roadmap', 'oxe', 'PROGRAM.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'PROGRAM.json')) && !fs.existsSync(path.join(dir, 'SPEC.md')), 'nothing in the project root');
    r = spawnSync(process.execPath, [CLI, 'program', 'export', 'docs/oxe'], { cwd: dir, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /use --out docs\/oxe/);
    r = run(dir, 'program', 'status', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).state.phases.map((p) => p.id), ['F7', 'F8', 'F9']);
  });

  it('errors exit 1 with the reason', () => {
    const dir = project();
    const r = run(dir, 'spec', 'add', 'criterion', 'A50', '--text', 'x', '--verify', 'y', '--by', 'tl', '--reason', 'fase do celular');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /buraco/);
  });

  it('plan reopen T<n> parses the task id (regression: the pattern was /^Td+$/)', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T3', title: 'x', wave: 1, files: ['a.js'], done: true }] }));
    const r = spawnSync(process.execPath, [CLI, 'plan', 'reopen', 'T3', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /T3 reaberta/);
  });
});

describe('OXB-075: spec add requirement with bullet-style requirements', () => {
  const BULLETS = SPEC.replace(/## Requisitos[\s\S]*?(?=## Critérios)/, '## Requisitos\n\n- **R1** — Base:\n  - detalhe da base\n- **R2** — Instalador (A40)\n\n');
  it('appends a bullet in the same style after the last one; the gap check sees the bullets', () => {
    const dir = project({ spec: BULLETS });
    assert.throws(() => op.runtimeSpecAdd(dir, null, { kind: 'requirement', id: 'R5', text: 'x', by: 'tl', reason: 'fase do celular' }), /R5 deixa um buraco na numeração \(o próximo é R3\)/);
    assert.throws(() => op.runtimeSpecAdd(dir, null, { kind: 'requirement', id: 'R2', text: 'x', by: 'tl', reason: 'fase do celular' }), /R2 já existe/);
    op.runtimeSpecAdd(dir, null, { kind: 'requirement', id: 'R3', text: 'Remoções do cockpit.', criteria: 'A42', by: 'tl', reason: 'fase do celular' });
    const spec = read(dir, '.oxe/SPEC.md');
    assert.match(spec, /- \*\*R2\*\* — Instalador \(A40\)\n- \*\*R3\*\* — Remoções do cockpit \(A42\)\n/);
    assert.doesNotMatch(spec, /\| R-ID \|/, 'no second, table-format list');
    assert.deepEqual(specEdit.requirementIds(spec), ['R1', 'R2', 'R3']);
  });
});

describe('OXB-076: program phase edit and program criterion move', () => {
  const planWith = (tasks, tests) => ({ schema_version: 1, tasks, acceptance_tests: tests });

  it('phase edit on a phase not started: title, requirements and acceptance in PROGRAM.json and ROADMAP together, logged', () => {
    const dir = project();
    const out = op.runtimeProgramPhaseEdit(dir, null, { phase: 'F8', title: 'Instalador e celular', addRequirements: 'R2', addAcceptance: 'A42', by: 'tl' });
    assert.deepEqual(out.after.acceptance, ['A40', 'A41', 'A42']);
    const program = JSON.parse(read(dir, '.oxe/program/PROGRAM.json'));
    assert.equal(program.phases[1].title, 'Instalador e celular');
    assert.deepEqual(program.phases[1].requirements, ['R2']);
    const roadmap = read(dir, '.oxe/ROADMAP.md');
    assert.match(roadmap, /## Fase 8 — Instalador e celular\n\n\*\*Requisitos:\*\* R2\n\*\*Critérios de aceite:\*\* A40, A41, A42/);
    assert.ok(out.warnings.some((w) => /A42 não está/.test(w)));
    assert.equal(ndjson(dir).at(-1).action, 'phase_edit');
  });

  it('refuses adding to a started phase, editing a closed one, and adding a criterion another phase owns', () => {
    const dir = project({ phases: [phase('F7', { acceptance: ['A1'], status: 'closed' }), phase('F8', { acceptance: ['A40', 'A41'], status: 'executing', plan_ref: '.oxe/PLAN.md' })] });
    assert.throws(() => op.runtimeProgramPhaseEdit(dir, null, { phase: 'F8', addAcceptance: 'A42', by: 'tl' }), /F8 já começou/);
    assert.throws(() => op.runtimeProgramPhaseEdit(dir, null, { phase: 'F7', title: 'x', by: 'tl' }), /F7 está fechada/);
    const free = project();
    assert.throws(() => op.runtimeProgramPhaseEdit(free, null, { phase: 'F8', addAcceptance: 'A1', by: 'tl' }), /A1 já pertence a F7 — use oxe-cc program criterion move A1 --from F7 --to F8/);
  });

  it('criterion move A1 F7 (active, planned) → F8: leaves the plan (its test and its only task), both ROADMAP sections, its CR follows', () => {
    const dir = project({ phases: [phase('F7', { title: 'Base', acceptance: ['A1', 'A40'], status: 'executing', plan_ref: '.oxe/PLAN.md', started_at: 'x' }), phase('F8', { title: 'Instalador', acceptance: ['A41'] })] });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(planWith(
      [{ id: 'T1', title: 'base', wave: 1, files: ['a.js'], acceptance: ['A1'] }, { id: 'T2', title: 'inst', wave: 1, files: ['b.js'], acceptance: ['A40'] }],
      [{ criterion: 'A1', files: ['t/a1.test.js'], command: 'x' }, { criterion: 'A40', files: ['t/a40.test.js'], command: 'y' }],
    )));
    change.recordChange({ programDir: path.join(dir, '.oxe', 'program'), program: null, plan: { tasks: [] }, class: 'spec_gap', summary: 'A1 muda de fase depois', criteria: 'A1', phase: 'F7', amendTo: 2 });
    const out = op.runtimeProgramCriterionMove(dir, null, { id: 'A1', from: 'F7', to: 'F8', by: 'tl' });
    assert.deepEqual([out.from, out.to, out.plan_removed_tasks, out.moved_change_records], ['F7', 'F8', ['T1'], 1]);
    const plan = JSON.parse(read(dir, '.oxe/PLAN.json'));
    assert.deepEqual(plan.tasks.map((t) => t.id), ['T2']);
    assert.deepEqual(plan.acceptance_tests.map((t) => t.criterion), ['A40']);
    const program = JSON.parse(read(dir, '.oxe/program/PROGRAM.json'));
    assert.deepEqual([program.phases[0].acceptance, program.phases[1].acceptance], [['A40'], ['A41', 'A1']]);
    const roadmap = read(dir, '.oxe/ROADMAP.md');
    assert.match(roadmap, /## Fase 7 — Base[\s\S]*\*\*Critérios de aceite:\*\* A40\n[\s\S]*## Fase 8 — Instalador[\s\S]*\*\*Critérios de aceite:\*\* A41, A1/);
    assert.equal(ndjson(dir).find((r) => r.kind === 'cr').phase, 'F8');
    assert.equal(ndjson(dir).at(-1).action, 'criterion_move');
  });

  it('criterion move refuses (and writes nothing) when a pending task depends on the task that would leave', () => {
    const dir = project({ phases: [phase('F7', { acceptance: ['A1', 'A40'], status: 'executing', plan_ref: '.oxe/PLAN.md' }), phase('F8', { acceptance: ['A41'] })] });
    const planText = JSON.stringify(planWith([{ id: 'T1', title: 'base', wave: 1, files: ['a.js'], acceptance: ['A1'] }, { id: 'T2', title: 'x', wave: 2, files: ['b.js'], acceptance: ['A40'], depends_on: ['T1'] }], []));
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), planText);
    assert.throws(() => op.runtimeProgramCriterionMove(dir, null, { id: 'A1', from: 'F7', to: 'F8', by: 'tl' }), /T2 depende\(m\) de T1/);
    assert.equal(read(dir, '.oxe/PLAN.json'), planText);
    assert.equal(read(dir, '.oxe/ROADMAP.md'), ROADMAP);
  });
});

describe('OXB-082: phase edit --scope replaces the scope bullets', () => {
  const WITH_BULLETS = ROADMAP.replace('**Escopo:** instalador\n', '**Escopo:** instalador\n\n- O OxePost para agentes, T64.\n- A loja de\n  plugins (continuação).\n\n- O selo R18.\n\n### Notas\n\nfica\n');
  it('--scope drops the old bullets (logged and warned); --keep-bullets keeps them; the next section is untouched', () => {
    const dir = project({ roadmap: WITH_BULLETS });
    const out = op.runtimeProgramPhaseEdit(dir, null, { phase: 'F8', scope: 'H1 e H2', by: 'tl', reason: 'escopo novo da F8' });
    const roadmap = read(dir, '.oxe/ROADMAP.md');
    assert.match(roadmap, /\*\*Escopo:\*\* H1 e H2\n\n### Notas\n\nfica\n/);
    assert.doesNotMatch(roadmap, /OxePost|loja de|plugins|selo R18/);
    assert.match(roadmap, /## Fase 7 — Base\n\n\*\*Requisitos:\*\* R1\n\*\*Critérios de aceite:\*\* A1\n\*\*Escopo:\*\* base\n/);
    assert.ok(out.warnings.some((w) => /3 bullet\(s\) removido\(s\)/.test(w)), out.warnings.join('\n'));
    const rec = ndjson(dir).find((r) => r.kind === 'program_edit');
    assert.equal(rec.scope_bullets_removed.length, 3);
    const keep = project({ roadmap: WITH_BULLETS });
    op.runtimeProgramPhaseEdit(keep, null, { phase: 'F8', scope: 'H1 e H2', keepBullets: true, by: 'tl', reason: 'escopo novo da F8' });
    assert.match(read(keep, '.oxe/ROADMAP.md'), /\*\*Escopo:\*\* H1 e H2\n\n- O OxePost/);
  });

  it('--scope-file sets the line and the new bullets in one go (also via the CLI)', () => {
    const dir = project({ roadmap: WITH_BULLETS });
    fs.writeFileSync(path.join(dir, 'scope.md'), '# Escopo da F8\n\nCaptura H1 e H2.\n\n- H1, captura HTTP.\n- H2, painel\n  e aba Rede.\n');
    const r = spawnSync(process.execPath, [CLI, 'program', 'phase', 'edit', 'F8', '--scope-file', path.join(dir, 'scope.md'), '--by', 'tl', '--reason', 'escopo novo da F8', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const roadmap = read(dir, '.oxe/ROADMAP.md');
    assert.match(roadmap, /\*\*Escopo:\*\* Captura H1 e H2\.\n\n- H1, captura HTTP\.\n- H2, painel e aba Rede\.\n\n### Notas/);
    assert.doesNotMatch(roadmap, /OxePost/);
    assert.equal(JSON.parse(read(dir, '.oxe/program/PROGRAM.json')).phases.find((p) => p.id === 'F8').scope, 'Captura H1 e H2.');
  });
});
