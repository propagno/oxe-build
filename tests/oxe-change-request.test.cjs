'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const change = require('../bin/lib/oxe-change.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.20b — "não ficou certo/completo/do jeito que eu queria": toda pushback vira CR com rota; fecha só com evidência.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cr-')); dirs.push(d); return d; }

const closedProgram = () => ({
  schema_version: 1, roadmap_ref: null, active_phase: null, created_at: '', updated_at: '',
  phases: [
    { id: 'F1', title: 'A', status: 'closed', acceptance: ['A1', 'A2'], closed_at: '2026-11-01T00:00:00Z', closed_commit: 'abc', regression_ref: '.oxe/program/regression/F1.json' },
    { id: 'F2', title: 'B', status: 'pending', acceptance: ['A3'] },
  ],
});
const plan = { tasks: [{ id: 'T1', aceite: ['A1'] }, { id: 'T2', aceite: ['A2'] }, { id: 'T3', aceite: [] }], acceptanceTests: [] };

describe('change requests', () => {
  it('valida classe, resumo e critérios', () => {
    const dir = tmpDir();
    assert.throws(() => change.recordChange({ programDir: dir, program: null, plan, class: 'bug', summary: 'algo quebrou aqui' }), /classe inválida/);
    assert.throws(() => change.recordChange({ programDir: dir, program: null, plan, class: 'defect', summary: 'curto' }), /descreva/);
    assert.throws(() => change.recordChange({ programDir: dir, program: null, plan, class: 'defect', summary: 'o consentimento não é revogável' }), /--criteria/);
  });

  it('defect numa fase fechada: reabre preservando histórico e regressão, aponta só as tarefas impactadas', () => {
    const dir = tmpDir();
    const r = change.recordChange({ programDir: dir, program: closedProgram(), plan, class: 'defect', summary: 'consentimento sem lugar para revogar', criteria: 'A2', by: 'design', phase: 'F1' });
    assert.equal(r.cr.id, 'CR-01');
    assert.equal(r.reopened, true);
    const f1 = r.program.phases[0];
    assert.equal(f1.status, 'planning');
    assert.equal(r.program.active_phase, 'F1');
    assert.equal(f1.regression_ref, '.oxe/program/regression/F1.json', 'regressão congelada continua valendo');
    assert.deepEqual(f1.history.map((h) => [h.closed_commit, h.cr]), [['abc', 'CR-01']]);
    assert.deepEqual(r.impacted, ['T2']);
    assert.match(r.route[0], /REPRODUZA o defeito.*"resolves": \["CR-01"\]/);
    assert.equal(change.recordChange({ programDir: dir, program: r.program, plan, class: 'new_scope', summary: 'comandos por voz no terminal' }).cr.id, 'CR-02');
  });

  it('new_scope não reabre; uma fase em andamento impede reabrir outra', () => {
    const dir = tmpDir();
    const p = closedProgram();
    assert.equal(change.recordChange({ programDir: dir, program: p, plan, class: 'new_scope', summary: 'wake word', phase: 'F1' }).reopened, false);
    p.active_phase = 'F2';
    p.phases[1].status = 'executing';
    assert.equal(change.recordChange({ programDir: dir, program: p, plan, class: 'defect', summary: 'falha no consentimento', criteria: 'A2', phase: 'F1' }).reopened, false);
  });

  it('CR só fecha com evidência: teste congelado com resolves verde', () => {
    const dir = tmpDir();
    change.recordChange({ programDir: dir, program: null, plan, class: 'defect', summary: 'consentimento sem revogação', criteria: 'A2', phase: 'F1' });
    const withTest = { ...plan, acceptanceTests: [{ criterion: 'A2', resolves: ['CR-01'], files: [] }] };
    let r = change.reconcileChanges(dir, 'F1', withTest, [{ check_id: 'check-accept-a2', status: 'fail' }]);
    assert.deepEqual([r.resolved, r.open.map((c) => c.id)], [[], ['CR-01']]);
    r = change.reconcileChanges(dir, 'F1', withTest, [{ check_id: 'check-accept-a2', status: 'pass' }]);
    assert.deepEqual(r.resolved, ['CR-01']);
    const cr = change.listChanges(dir)[0];
    assert.equal(cr.status, 'resolved');
    assert.match(cr.resolution, /A2 verde/);
  });

  it('spec_gap: emenda torna stale o teste de versão anterior até ser reescrito', () => {
    const dir = tmpDir();
    change.recordChange({ programDir: dir, program: null, plan, class: 'spec_gap', summary: 'copy do consentimento revisada pelo DESIGN', criteria: 'A1', amendTo: 2 });
    const required = change.requiredVersions(dir);
    assert.deepEqual([...required], [['A1', 2]]);
    const doc = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, acceptance: ['A1'], verify: { commands: ['x'] } }], acceptance_tests: [{ criterion: 'A1', files: ['a.test.js'], command: 'node --test a.test.js' }] };
    let lint = planJson.lintPlan({ plan: planJson.planJsonToParsedPlan(doc), requiredVersions: required });
    assert.match(lint.errors.join('\n'), /A1: teste de aceite v1 está stale — a SPEC foi emendada para v2/);
    doc.acceptance_tests[0].version = 2;
    doc.acceptance_tests[0].resolves = ['CR-01'];
    lint = planJson.lintPlan({ plan: planJson.planJsonToParsedPlan(doc), requiredVersions: required });
    assert.doesNotMatch(lint.errors.join('\n'), /stale/);
  });

  it('constraint vira regra verificável (gatekeeper) com arquivo:linha', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'hook.ts'), 'const a = 1;\nref.current = t("x") // during render\n');
    fs.writeFileSync(path.join(dir, 'src', 'ok.ts'), 'export const b = 2;\n');
    const violations = change.checkPolicyRules(dir, [{ id: 'no-ref-in-render', forbid: '^\\s*\\w+\\.current\\s*=', paths: '^src/', message: 'não atualize ref durante o render' }], ['src/hook.ts', 'src/ok.ts', 'docs/x.md']);
    assert.deepEqual(violations, [{ rule: 'no-ref-in-render', file: 'src/hook.ts:2', message: 'não atualize ref durante o render' }]);
  });
});

describe('feedback pela CLI operacional', () => {
  it('registra CR, emite evento e lista', () => {
    const tmp = tmpDir();
    fs.mkdirSync(path.join(tmp, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n', 'utf8');
    fs.writeFileSync(path.join(tmp, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify(closedProgram()), 'utf8');
    const r = op.runtimeFeedback(tmp, null, { class: 'defect', summary: 'consentimento sem lugar para revogar', criteria: 'A2', by: 'design', phase: 'F1' });
    assert.equal(r.reopened, true);
    const stored = JSON.parse(fs.readFileSync(path.join(tmp, '.oxe', 'program', 'PROGRAM.json'), 'utf8'));
    assert.equal(stored.phases[0].status, 'planning');
    assert.deepEqual(op.runtimeChanges(tmp, null).map((c) => [c.id, c.status]), [['CR-01', 'open']]);
    assert.ok(op.readEvents(tmp, null).some((e) => e.type === 'ChangeRequested'));
  });
});

describe('prova transversal para CR sem critério (OXB-014)', () => {
  it('entrada de aceite com id + resolves, sem criterion: valida, gera check próprio e resolve o CR', () => {
    const dir = tmpDir();
    change.recordChange({ programDir: dir, program: null, plan, class: 'constraint', summary: 'eslint react-hooks/refs com zero warnings' });
    const doc = {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'x', wave: 1, acceptance: ['A1'], verify: { commands: ['x'] } }],
      acceptance_tests: [{ id: 'CR-01-lint', resolves: ['CR-01'], files: ['eslint.voice.json'], command: 'npx eslint src/features/voice --max-warnings 0' }],
    };
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    const bad = { ...doc, acceptance_tests: [{ files: ['x'], command: 'y' }] };
    assert.match(planJson.validatePlanJson(bad).join('\n'), /criterion: A<n> \(ou "id" \+ "resolves"/);
    const parsed = planJson.planJsonToParsedPlan(doc);
    assert.equal(parsed.acceptanceTests[0].id, 'CR-01-lint');
    assert.equal(parsed.acceptanceTests[0].criterion, null);
    const r = change.reconcileChanges(dir, null, parsed, [{ check_id: 'check-accept-cr-01-lint', status: 'pass' }]);
    assert.deepEqual(r.resolved, ['CR-01']);
  });
});

describe('verify fecha o CR de ponta a ponta (OXB-019)', () => {
  it('o resolves sobrevive ao lock do aceite e o CR fica resolvido após o verify', async () => {
    const tmp = tmpDir();
    fs.mkdirSync(path.join(tmp, '.oxe', 'program'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 't'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(tmp, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(tmp, 't', 'ok.js'), 'process.exit(0)\n');
    fs.writeFileSync(path.join(tmp, '.oxe', 'PLAN.json'), JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/x.js'], acceptance: ['A1'], verify: { commands: ['node t/ok.js'] } }],
      acceptance_tests: [{ id: 'CR-01-proof', resolves: ['CR-01'], files: ['t/ok.js'], command: 'node t/ok.js' }],
    }));
    op.runtimeFeedback(tmp, null, { class: 'constraint', summary: 'regra transversal comprovada por teste' });
    op.compileExecutionGraphFromArtifacts(tmp, null);
    await op.runRuntimeVerify(tmp, null);
    const cr = op.runtimeChanges(tmp, null).find((c) => c.id === 'CR-01');
    assert.equal(cr.status, 'resolved', JSON.stringify(cr));
  });
});
