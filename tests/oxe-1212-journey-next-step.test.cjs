'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');
const journey = require('../bin/lib/oxe-journey.cjs');
const grillLib = require('../bin/lib/oxe-grill.cjs');
const quickLib = require('../bin/lib/oxe-quick.cjs');

// 1.21.2 — the next-step engine guides end to end (items 4, 8, 9, 10, 14, 17, 18 and the no-program delivery of 2):
// each case builds the state with fakes (no network, no gh, no claude -p) and reads suggestNextStep / the journey map.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const MAPS = ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONVENTIONS.md', 'CONCERNS.md'];
const SPEC = (risk = 'P2') => `# SPEC\n\n## Requisitos\n\n| R-ID | Requisito | Versão | Critério de aceite |\n|---|---|---|---|\n| R1 | x | v1 | A1 |\n\n## Critérios de aceite\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | salva | ${risk} | node -e 1 |\n`;

function project(config = {}, { maps = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-next-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/config.json', JSON.stringify({ adr: false, ...config }));
  if (maps) for (const m of MAPS) write(dir, `.oxe/codebase/${m}`, `# ${m}\n`);
  return dir;
}
const next = (dir, cfg = {}) => health.suggestNextStep(dir, cfg);
const closeGrill = (dir, extra = []) => {
  const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, ...o });
  g('start', { type: 'investigação', title: 'Envio ao celular' });
  for (const b of ['problem', 'scope', 'risks']) {
    const q = g('ask', { branch: b, question: `pergunta ${b}?`, recommended: 'sim', decision: true });
    g('answer', { id: q.id, choice: (extra.find((e) => e.branch === b) || {}).answer || 'ok' });
    g('confirm', { branch: b });
  }
  g('close', { by: 'po' });
};

describe('next step — program init, greenfield and the RFC of the grill', () => {
  it('item 4: SPEC aprovada + ROADMAP de 2 fases + sem programa → program init; 1 fase → plan', () => {
    const dir = project();
    closeGrill(dir);
    write(dir, '.oxe/SPEC.md', SPEC());
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — A\n\n**Critérios de aceite:** A1\n\n## Fase 2 — B\n\n**Critérios de aceite:** A1\n');
    op.runtimeSpecApprove(dir, null, { by: 'po' });
    const n = next(dir);
    assert.equal(n.step, 'program-init');
    assert.equal(n.cursorCmd, 'oxe-cc runtime program init');
    assert.equal(journey.STEP_STAGE['program-init'], 'program');
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — A\n\n**Critérios de aceite:** A1\n');
    // the SPEC is unchanged, only the ROADMAP: a single-phase delivery plans directly
    assert.equal(next(dir).step, 'plan');
  });

  it('item 4: greenfield (sem código) com SPEC e sem mapas → plan, nunca /oxe-spec --refresh; brownfield sem aprovação ainda pede o scan', () => {
    const dir = project({}, { maps: false });
    write(dir, '.oxe/SPEC.md', SPEC());
    assert.equal(next(dir).step, 'plan', 'greenfield: nada a mapear');
    write(dir, 'src/app.js', 'module.exports = 1;\n');
    const n = next(dir);
    assert.equal(n.step, 'scan');
    assert.equal(n.cursorCmd, '/oxe-spec --refresh');
  });

  it('item 18: grill fechado com critério P0 e rfc.required risk → oxe-cc rfc new (antes da aprovação); rascunho → approve → /oxe-discuss --rfc', () => {
    const cfg = { rfc: { required: 'risk' } };
    const dir = project(cfg);
    closeGrill(dir);
    write(dir, '.oxe/SPEC.md', SPEC('P0'));
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — A\n\n**Critérios de aceite:** A1\n');
    // the spec check refuses the risky SPEC without an RFC: the next step is the draft, not "spec check" again
    let n = next(dir, cfg);
    assert.equal(n.step, 'rfc', JSON.stringify(n));
    assert.match(n.cursorCmd, /^oxe-cc rfc new --title "Envio ao celular"/);
    assert.match(n.reason, /A1/);
    assert.equal(journey.STEP_STAGE.rfc, 'decide');
    const created = require('../bin/lib/oxe-rfc.cjs').create(dir, { title: 'Envio ao celular' });
    n = next(dir, cfg);
    assert.equal(n.step, 'spec-approve');
    assert.equal(n.cursorCmd, 'oxe-cc spec approve --by <papel>');
    op.runtimeSpecApprove(dir, null, { by: 'po' });
    n = next(dir, cfg);
    assert.equal(n.step, 'discuss');
    assert.equal(n.cursorCmd, '/oxe-discuss --rfc');
    assert.match(n.reason, new RegExp(created.id));
  });

  it('item 18: rfc advisory nunca bloqueia — o plano cita o RFC pedido pelo grill (componente novo)', () => {
    const dir = project();
    closeGrill(dir, [{ branch: 'scope', answer: 'criar um novo serviço de fila para os envios' }]);
    write(dir, '.oxe/SPEC.md', SPEC());
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — A\n\n**Critérios de aceite:** A1\n');
    op.runtimeSpecApprove(dir, null, { by: 'po' });
    const n = next(dir);
    assert.equal(n.step, 'plan');
    assert.match(n.reason, /o grill pede RFC \(componente novo/);
    const s = grillLib.status(op.grillPaths(dir, null).dir);
    assert.equal(grillLib.rfcSuggestion(s, SPEC('P1')).risky.join(), 'A1');
  });

  it('item 10: rfcStep aceita RFC global (sem fase) aceito que cita os critérios de risco', () => {
    const dir = project({ rfc: { required: 'risk' } });
    write(dir, '.oxe/SPEC.md', SPEC('P1'));
    const phase = { id: 'F1', acceptance: ['A1'] };
    let s = journey.rfcStep(dir, null, phase, { cfg: { rfc: { required: 'risk' } } });
    assert.equal(s.step, 'discuss');
    write(dir, '.oxe/rfc/RFC-1-global.md', '# RFC-1 — Proposta global\n\n- **Status:** aceito (2026-11-21)\n- **Fase:** —\n\n## Resumo\n\ncobre A1 para o programa inteiro\n\n## Proposta\n\nfila única\n');
    s = journey.rfcStep(dir, null, phase, { cfg: { rfc: { required: 'risk' } } });
    assert.equal(s, null, 'o RFC global aceito vale para a fase');
    // a global draft is the one to decide
    fs.rmSync(path.join(dir, '.oxe', 'rfc', 'RFC-1-global.md'));
    write(dir, '.oxe/rfc/RFC-2-global.md', '# RFC-2 — Rascunho global\n\n- **Status:** rascunho\n- **Fase:** —\n\n## Proposta\n\nx\n');
    s = journey.rfcStep(dir, null, phase, { cfg: { rfc: { required: 'risk' } } });
    assert.match(s.reason, /RFC-2 em rascunho/);
  });
});

describe('next step — delivery without a program (delivery.mode pr) and CRs', () => {
  const greenCycle = (config) => {
    const dir = project(config);
    write(dir, '.oxe/STATE.md', '# STATE\n\n## Fase atual\n\n`verify_complete`\n');
    write(dir, '.oxe/SPEC.md', SPEC());
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/VERIFY.md', '# VERIFY\n\n## Gaps\n\nNenhum\n');
    const old = new Date(Date.now() - 60000);
    for (const f of ['SPEC.md', 'PLAN.md']) fs.utimesSync(path.join(dir, '.oxe', f), old, old);
    return dir;
  };
  // the plan gates (self evaluation, packs) are not the subject here: call the delivery part directly
  const deliver = (dir, cfg) => health.deliveryCycleStep(dir, null, health.resolvedReadableOxePaths(dir, null), cfg, null);

  it('item 2: PR → CI/merge → deploy → ciclo fechado, sem programa', () => {
    const cfg = { delivery: { mode: 'pr', deploy_env: 'staging' } };
    const dir = greenCycle(cfg);
    let n = deliver(dir, cfg);
    assert.equal(n.step, 'ship');
    assert.equal(n.cursorCmd, '/oxe-ship');
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'https://example.invalid/pr/9' } });
    n = deliver(dir, cfg);
    assert.equal(n.step, 'ship-wait');
    assert.equal(n.cursorCmd, 'oxe-cc ship status');
    op.appendEvent(dir, null, { type: 'AlmMerged', work_item_id: 'T1', payload: { merged_at: new Date().toISOString() } });
    n = deliver(dir, cfg);
    assert.equal(n.step, 'deploy');
    assert.match(n.cursorCmd, /^oxe-cc runtime deploy --attach staging/);
    // a deploy of an older cycle does not count
    write(dir, '.oxe/program/deploy.ndjson', `${JSON.stringify({ env: 'staging', version: '0.9.0', ok: true, at: '2020-01-01T00:00:00.000Z', phase: null })}\n`);
    assert.equal(deliver(dir, cfg).step, 'deploy');
    fs.appendFileSync(path.join(dir, '.oxe', 'program', 'deploy.ndjson'), `${JSON.stringify({ env: 'staging', version: '1.0.0', ok: true, at: new Date().toISOString(), phase: null })}\n`);
    n = deliver(dir, cfg);
    assert.equal(n.step, 'next');
    assert.equal(n.cursorCmd, '/oxe-spec');
    assert.equal(n.delivered, true);
    assert.equal(journey.STEP_STAGE.next, 'operate');
  });

  it('item 2: local → /oxe-ship; commit-record depois do verify → ciclo fechado', () => {
    const dir = greenCycle({});
    assert.equal(deliver(dir, {}).step, 'ship');
    write(dir, '.oxe/commit-record.json', JSON.stringify({ sha: 'abcdef1234567' }));
    const n = deliver(dir, {});
    assert.equal(n.step, 'next');
    assert.match(n.reason, /commit local abcdef123/);
  });

  it('item 8: CR aberto depois do verify verde → /oxe-plan --replan (com ou sem programa)', () => {
    const dir = greenCycle({});
    write(dir, '.oxe/program/changes.ndjson', `${JSON.stringify({ id: 'CR-1', kind: 'cr', class: 'defect', status: 'open', criteria: ['A1'], summary: 'quebra offline', at: new Date().toISOString() })}\n`);
    assert.ok(op.runtimeChanges(dir, null).some((c) => c.id === 'CR-1'));
    const n = deliver(dir, {});
    assert.equal(n.step, 'plan');
    assert.equal(n.cursorCmd, '/oxe-plan --replan');
    assert.match(n.reason, /CR-1 defect/);
  });
});

describe('next step — quick, status --json and the journey map', () => {
  it('item 9: quick done marca QUICK.md e STATE (quick_active → quick_done) e não fica em /oxe-execute', () => {
    const dir = project();
    spawnSync('git', ['init', '-q'], { cwd: dir });
    write(dir, '.oxe/STATE.md', '# STATE\n\n## Fase atual\n\n`quick_active`\n');
    const rec = quickLib.start(dir, { objective: 'conferir o texto do botão', quickFile: path.join(dir, '.oxe', 'QUICK.md') });
    assert.equal(next(dir).step, 'quick');
    const out = quickLib.done(dir, { noCommit: true });
    assert.equal(out.closed, true);
    assert.equal(out.quick_md_closed, true);
    assert.equal(out.state_closed, true);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'QUICK.md'), 'utf8'), new RegExp(`oxe-quick-status: done · ${out.closed_at.replace(/[.]/g, '\\.')}`));
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'STATE.md'), 'utf8'), /`quick_done`/);
    const n = next(dir);
    assert.notEqual(n.cursorCmd, '/oxe-execute');
    assert.equal(n.step, 'next');
    assert.match(n.reason, new RegExp(`Quick ${rec.id} concluído sem commit`));
  });

  it('items 14/17: status --json traz next (alias de nextStep); --journey usa a sessão ativa', () => {
    const dir = project();
    write(dir, '.oxe/STATE.md', '# STATE\n\n**active_session:** sessions/s1\n');
    write(dir, '.oxe/sessions/s1/spec/SPEC.md', SPEC());
    write(dir, '.oxe/sessions/s1/plan/PLAN.md', '# PLAN\n');
    const env = { ...process.env, NO_COLOR: '1', OXE_NO_PROMPT: '1' };
    const st = JSON.parse(spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], { encoding: 'utf8', env }).stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.equal(st.next, st.nextStep);
    assert.ok(st.cursorCmd && st.reason);
    const j = JSON.parse(spawnSync(process.execPath, [CLI, 'status', '--journey', '--json', '--dir', dir], { encoding: 'utf8', env }).stdout);
    const planStage = j.stages.find((s) => s.id === 'plan');
    assert.notEqual(planStage.state, 'pending', `o PLAN da sessão conta no mapa (${JSON.stringify(j.stages)})`);
    // the map without the session would not see it
    const noSession = journey.journey(dir, j.next, null).stages.find((s) => s.id === 'plan');
    assert.equal(noSession.state, j.current === 'plan' ? 'current' : 'pending');
  });
});
