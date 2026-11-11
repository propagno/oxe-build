'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const probe = require('../bin/lib/oxe-spec-probe.cjs');

// 1.21.2 — OXB-123: edge and prohibition probes on the spec; needs_human never passes.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const SPEC = '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | O formulário de consentimento salva a escolha e mostra o botão Enviar desabilitado até marcar | teste |\n| A2 | O cálculo de dias | teste |\n';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sp-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', SPEC);
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.tsx'], acceptance: ['A1', 'A2'], verify: { commands: ['node -e 0'] } }] }));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-123: spec probe', () => {
  it('only the applicable edge categories; prohibitions for what the feature could do by accident', () => {
    const p = probe.probe({ id: 'A1', text: 'O formulário de consentimento salva a escolha e mostra o botão Enviar desabilitado até marcar' });
    const edges = p.edges.map((e) => e.edge);
    assert.ok(edges.includes('idempotência') && edges.includes('teclado e foco'));
    assert.ok(!edges.includes('concorrência') && !edges.includes('precisão'));
    assert.ok(p.prohibitions.some((x) => x.kind === 'perda de dado'));
    assert.deepEqual(probe.probe({ id: 'A9', text: 'xyz' }).edges, []);
  });

  it('spec probe writes the sections once; discarding without a reason is refused; an open edge needs an assumption', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'spec', 'probe', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let spec = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
    assert.match(spec, /## Bordas/);
    assert.match(spec, /\| A1\.e1 \| A1 \|/);
    assert.match(spec, /## Proibições/);
    spawnSync(process.execPath, [CLI, 'spec', 'probe', '--dir', dir], { encoding: 'utf8' });
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8'), spec, 'idempotent');
    spec = spec.replace(/\| A1\.e1 \| A1 \| ([^|]*)\| aberta \| \|/, '| A1.e1 | A1 | $1| descartada | |');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), spec);
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.errors.some((e) => /A1\.e1: borda descartada sem motivo/.test(e)), lint.errors.join('\n'));
    assert.ok(lint.warnings.some((w) => /A1\.e2: borda aberta sem suposição no plano/.test(w)));
  });

  it('a julgamento prohibition without a sign-off leaves the close needs_human; the sign-off naming it clears it', () => {
    const dir = project();
    op.runtimeSpecProbe(dir, null, {});
    const reasons = () => { try { return op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false }).gate.reasons.join('\n'); } catch (e) { return e.message; } };
    assert.match(reasons(), /needs_human: N1 pede evidência explícita/);
    const ids = probe.readProhibitions(fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8')).map((p) => p.id);
    op.runtimeSignoff(dir, null, { phase: 'F1', criteria: ids.join(','), by: 'po', evidence: 'docs/revisao.md' });
    assert.doesNotMatch(reasons(), /needs_human/);
  });
});
