'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dossier = require('../bin/lib/oxe-dossier.cjs');

// 1.20 — Dossiê vivo verificado (formato do workflow de engenharia: context / architecture / techspec com Prova /
// plan com diário / decisões / notas). A projeção nunca apaga o texto humano e acusa drift.

const SPEC = `# SPEC

## Objetivo

Ditado push-to-talk.

## Contexto e decisões

- **D-01 Motores híbridos:** registry com privacy.
- **D-02 Windows:** WinRT online só com opt-in.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | registry escolhe motor | \`npx vitest run r.test.ts\` |
| A8 | ditado real no Windows | UAT manual no Windows |

## Riscos

- latência do helper

## Fora de escopo

TTS.
`;

function input(overrides = {}) {
  return {
    phase: { id: 'F1', title: 'Ditado', acceptance: ['A1', 'A8'], requirements: ['R1'], status: 'verifying' },
    specText: SPEC,
    plan: {
      tasks: [{ id: 'T1', title: 'registry', files: ['src/registry.ts'], aceite: ['A1'] }],
      acceptanceTests: [{ criterion: 'A1', command: 'npx vitest run r.test.ts', files: [{ path: 'r.test.ts', sha256: 'abc' }], proves: ['starts one session'] }],
    },
    pack: { tasks: [{ id: 'T1', exact_paths: ['src/registry.ts'] }] },
    run: {
      run_id: 'run-1', status: 'blocked',
      verification_check_results: [
        { check_id: 'check-accept-a1', acceptance_ref: 'A1', status: 'pass', tests_executed: 6 },
        { check_id: 'check-a8', acceptance_ref: 'A8', status: 'skip', skip_reason: 'needs_structured_check' },
      ],
    },
    events: [
      { type: 'AttemptStarted', work_item_id: 'T1', timestamp: '2026-11-01T02:00:00Z' },
      { type: 'ExecutorUsage', work_item_id: 'T1', payload: { attempt: 1, turns: 5, cost_usd: 0.3, success: true, tools: { write_file: 2 } } },
      { type: 'VerificationCompleted', work_item_id: 'T1', payload: { status: 'failed' } },
      { type: 'ExecutorUsage', work_item_id: 'T1', payload: { attempt: 1, turns: 3, cost_usd: 0.1, success: true, tools: {} } },
      { type: 'WorkItemCompleted', work_item_id: 'T1', timestamp: '2026-11-01T02:10:00Z' },
    ],
    changes: [{ path: 'src/registry.ts', status: 'A' }, { path: 'r.test.ts', status: 'A' }],
    hashFile: () => 'abc',
    ...overrides,
  };
}

describe('dossiê vivo', () => {
  it('gera os 6 documentos com decisões, prova, diário e adiados', () => {
    const built = dossier.buildDossier(input());
    assert.deepEqual(Object.keys(built.files).sort(), ['architecture.md', 'context.md', 'decisions.md', 'notes.md', 'plan.md', 'techspec.md']);
    assert.match(built.files['context.md'], /\| D-01 \| Motores híbridos \|/);
    assert.match(built.files['context.md'], /latência do helper/);
    assert.match(built.files['techspec.md'], /\| A1 \| registry escolhe motor \| r\.test\.ts \| starts one session \| pass \(6 testes\) \|/);
    assert.match(built.files['techspec.md'], /\| A8 .* ADIADO — UAT\/sign-off pendente \|/);
    assert.match(built.files['plan.md'], /Tentativa 2 \(execução retomada\)/);
    assert.match(built.files['plan.md'], /2 tentativa\(s\), 8 turnos, US\$ 0\.40, 6 testes de aceite/);
    assert.deepEqual(built.issues, []);
    assert.deepEqual(built.pending, ['signoff_pending: A8']);
  });

  it('sign-off do UAT tira o critério de pendente e registra quem aceitou', () => {
    const built = dossier.buildDossier(input({ signoffs: [{ phase: 'F1', criteria: ['A8'], by: 'eduardo', at: '2026-11-01T03:00:00Z' }] }));
    assert.deepEqual(built.pending, []);
    assert.match(built.files['techspec.md'], /aceito por eduardo em 2026-11-01 03:00/);
  });

  it('drift: arquivo fora do contrato, aceite com hash diferente e prova não executada', () => {
    const built = dossier.buildDossier(input({
      changes: [{ path: 'src/registry.ts', status: 'M' }, { path: 'src/rogue.ts', status: 'A' }],
      hashFile: () => 'changed',
      run: { run_id: 'r', status: 'failed', verification_check_results: [{ check_id: 'check-accept-a1', acceptance_ref: 'A1', status: 'fail', error: 'proof_not_executed: starts one session' }] },
    }));
    const text = built.issues.join('\n');
    assert.match(text, /architecture_drift: tocados fora do contrato: src\/rogue\.ts/);
    assert.match(text, /acceptance_changed: r\.test\.ts/);
    assert.match(text, /proof_not_executed: A1/);
  });

  it('a regeneração preserva o texto humano e o handoff; placeholder não conta como handoff', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dossier-'));
    try {
      const file = path.join(dir, 'plan.md');
      const first = dossier.writeDossierFile(file, '# gerado v1', { withHandoff: true });
      assert.equal(dossier.handoffFilled(dossier.humanPart(first)), false);
      fs.writeFileSync(file, first.replace(dossier.HANDOFF_PLACEHOLDER, 'O helper PowerShell não emite parciais; a F2 precisa do helper nativo.') + '\nNota humana extra.\n');
      const second = dossier.writeDossierFile(file, '# gerado v2', { withHandoff: true });
      assert.match(second, /# gerado v2/);
      assert.doesNotMatch(second, /# gerado v1/);
      assert.match(second, /Nota humana extra\./);
      assert.equal(dossier.handoffFilled(dossier.humanPart(second)), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
