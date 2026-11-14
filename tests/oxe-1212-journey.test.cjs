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

// 1.21.2 — the guided journey: the single next step now knows the grill, the spec approval, the ALM writes and the
// delivery (PR → merge → deploy) after a green verify.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

const SPEC = '# SPEC\n\n## Requisitos\n\n| R-ID | Requisito | Versão | Critério de aceite |\n|---|---|---|---|\n| R1 | x | v1 | A1 |\n\n## Critérios de aceite\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | salva | P2 | vitest |\n';
const PRD = '# PRD — X\n\n## Histórias de usuário\n\n| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |\n|---|---|---|---|---|---|---|\n| US-1 | cliente | salvar | não perder | R1 | A1 | Must |\n';

function project(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-journey-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/config.json', JSON.stringify({ adr: false, ...config }));
  for (const m of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONVENTIONS.md', 'CONCERNS.md']) write(dir, `.oxe/codebase/${m}`, `# ${m}\n`);
  return dir;
}
const next = (dir) => health.suggestNextStep(dir, {});
const walkGrill = (dir) => {
  const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, ...o });
  g('start', { type: 'investigação' });
  for (const b of ['problem', 'scope', 'risks']) { const q = g('ask', { branch: b, question: `pergunta ${b}?`, recommended: 'sim' }); g('answer', { id: q.id, choice: 'ok' }); g('confirm', { branch: b }); }
  return g;
};

describe('journey: upstream', () => {
  it('grill open → /oxe-spec with the next branch; closed and not approved → spec check; approved → plan', () => {
    const dir = project();
    op.runtimeGrill(dir, null, { action: 'start', type: 'bugfix' });
    let n = next(dir);
    assert.equal(n.step, 'spec');
    assert.match(n.reason, /grill aberto — próximo ramo: problem/);
    const g = walkGrill(project());
    void g;
    const d2 = dirs[dirs.length - 1];
    op.runtimeGrill(d2, null, { action: 'close' });
    write(d2, '.oxe/SPEC.md', SPEC);
    write(d2, '.oxe/ROADMAP.md', '# R\n\n**Critérios de aceite:** A1\n');
    n = next(d2);
    assert.equal(n.step, 'spec-approve');
    assert.equal(n.cursorCmd, 'oxe-cc spec check');
    op.runtimeSpecApprove(d2, null, { by: 'po' });
    assert.equal(next(d2).step, 'plan');
    fs.appendFileSync(path.join(d2, '.oxe', 'SPEC.md'), '\nmudança\n');
    assert.match(next(d2).reason, /mudou depois da aprovação/);
  });

  it('ALM: stories not pushed → alm push --stories-only; tasks not pushed → --tasks-only; MCP queue → alm queue', async () => {
    const dir = project({ alm: { provider: 'jira', transport: 'mcp', program: 'p', jira: { project: 'OXE' } } });
    write(dir, '.oxe/SPEC.md', SPEC);
    write(dir, '.oxe/PRD.md', PRD);
    let n = next(dir);
    assert.equal(n.step, 'alm-push');
    assert.match(n.cursorCmd, /--stories-only/);
    await op.runtimeAlm(dir, null, { action: 'push', tasks: false });
    n = next(dir);
    assert.equal(n.step, 'alm-queue', 'the queued ensure ops come first');
    for (const opn of require('../bin/lib/oxe-alm.cjs').pendingOps(path.join(dir, '.oxe', 'program'))) {
      op.runtimeAlm(dir, null, { action: 'ack', ref: opn.id, key: opn.op === 'ensure' ? `OXE-${opn.ref.length}${opn.ref.replace(/\D/g, '') || 0}` : undefined });
    }
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', acceptance: ['A1'] }] }));
    n = next(dir);
    assert.equal(n.step, 'alm-push');
    assert.match(n.cursorCmd, /--tasks-only/);
  });

  it('without ALM and without grill nothing changes (legacy path: SPEC without PLAN → plan)', () => {
    const dir = project();
    write(dir, '.oxe/SPEC.md', SPEC);
    assert.equal(next(dir).step, 'plan');
  });
});

describe('journey: delivery after a green verify', () => {
  const phase = { id: 'F1', status: 'verifying', started_at: new Date(Date.now() - 60_000).toISOString() };

  it('local delivery (default) → no step: the phase closes as before', () => {
    const dir = project();
    assert.equal(journey.deliveryStep(dir, null, phase), null);
  });

  it('delivery pr: no PR → /oxe-ship; PR open → ship status; merged → deploy (with deploy_env); deployed → close', () => {
    const dir = project({ delivery: { mode: 'pr', deploy_env: 'staging' } });
    write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ schema_version: 1, active_phase: 'F1', phases: [{ ...phase, acceptance: [] }] }));
    assert.equal(journey.deliveryStep(dir, null, phase).step, 'ship');
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'https://github.com/o/r/pull/7' } });
    const wait = journey.deliveryStep(dir, null, phase);
    assert.equal(wait.step, 'ship-wait');
    assert.match(wait.reason, /pull\/7/);
    op.appendEvent(dir, null, { type: 'AlmMerged', work_item_id: 'T1', payload: { pr: 'https://github.com/o/r/pull/7' } });
    const dep = journey.deliveryStep(dir, null, phase);
    assert.equal(dep.step, 'deploy');
    assert.match(dep.cursorCmd, /runtime deploy --attach staging/);
    fs.appendFileSync(path.join(dir, '.oxe', 'program', 'deploy.ndjson'), `${JSON.stringify({ phase: 'F1', env: 'staging', version: '1.0', ok: true })}\n`);
    assert.equal(journey.deliveryStep(dir, null, phase), null);
  });

  it('ship status (offline) lists the PRs and the merge, and the next step', () => {
    const dir = project({ delivery: 'pr' });
    write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ schema_version: 1, active_phase: 'F1', phases: [{ ...phase, acceptance: [] }] }));
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'https://github.com/o/r/pull/7' } });
    const s = op.runtimeDeliveryStatus(dir, null, { refresh: false });
    assert.equal(s.mode, 'pr');
    assert.deepEqual(s.prs.map((p) => [p.task, p.merged]), [['T1', false]]);
    const merged = op.runtimeDeliveryStatus(dir, null, { ghSpawn: () => ({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-11-13T10:00:00Z' }) }) });
    assert.equal(merged.prs[0].merged, true, 'gh (fake) reported the merge; recorded as AlmMerged');
  });
});

describe('journey: status --journey', () => {
  it('prints the 0–9 map with the current stage and the next step (json too)', () => {
    const dir = project();
    op.runtimeGrill(dir, null, { action: 'start', type: 'bugfix' });
    const r = spawnSync(process.execPath, [CLI, 'status', '--journey', '--json', '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.stages.length, 10);
    assert.equal(j.current, 'discover');
    assert.equal(j.stages.find((s) => s.id === 'discover').state, 'current');
    assert.equal(j.stages.find((s) => s.id === 'prepare').state, 'done');
    const t = spawnSync(process.execPath, [CLI, 'status', '--journey', '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(t.stdout, /1 Descobrir \(grill\)/);
    assert.match(t.stdout, /Próximo passo: \/oxe-spec/);
  });
});
