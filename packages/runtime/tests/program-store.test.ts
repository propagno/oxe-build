import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoadmapPhases,
  createProgram,
  startPhase,
  setPhaseStatus,
  closePhase,
  programProgress,
  closedPhasesBefore,
  acceptanceOutsidePhase,
  findPhase,
  ProgramTransitionError,
} from '../src/program/program-model';

// 1.19: o ROADMAP aprovado vira um programa de fases executável; uma fase só fecha pelo gate.

const ROADMAP = `---
oxe_doc: roadmap
status: approved
---
# Roteiro de Entrega

<!-- ## Fase 9 — comentário não conta -->

## Fase 1 — Domínio e armazenamento

**Requisitos:** R1, R2
**Critérios de aceite:** A1, A2, A3
**Escopo:** entidades e repositório em arquivo

## Fase 2 — API HTTP

**Requisitos:** R3
**Critérios de aceite:** A4, A5
**Escopo:** rotas REST com token

## Phase 3: Reports

**Requirements:** R4
**Acceptance criteria:** A6
`;

const green = { verify_status: 'completed', regression_failed: [], contract_failed: [], checks_failed: [] };

describe('programa por fases', () => {
  test('parseRoadmapPhases lê fases, R-IDs, A* e escopo (PT e EN, ignora comentários)', () => {
    const phases = parseRoadmapPhases(ROADMAP);
    assert.deepEqual(phases.map((p) => p.id), ['F1', 'F2', 'F3']);
    assert.equal(phases[0].title, 'Domínio e armazenamento');
    assert.deepEqual(phases[0].requirements, ['R1', 'R2']);
    assert.deepEqual(phases[0].acceptance, ['A1', 'A2', 'A3']);
    assert.equal(phases[1].scope, 'rotas REST com token');
    assert.equal(phases[2].title, 'Reports');
    assert.deepEqual(phases[2].acceptance, ['A6']);
  });

  test('ROADMAP sem fases é erro explícito', () => {
    assert.throws(() => createProgram('# nada aqui'), ProgramTransitionError);
  });

  test('fases rodam em ordem; só fecham pelo gate', () => {
    let state = createProgram(ROADMAP, '.oxe/ROADMAP.md');
    assert.equal(programProgress(state).index, 1);
    assert.throws(() => startPhase(state, 'F2'), /feche antes: F1/);

    state = startPhase(state);
    assert.equal(state.active_phase, 'F1');
    assert.equal(findPhase(state, 'F1')!.status, 'planning');
    assert.equal(findPhase(state, '1')!.id, 'F1', 'aceita número');
    assert.throws(() => setPhaseStatus(state, 'F1', 'verifying'), /transição inválida/);

    state = setPhaseStatus(state, 'F1', 'executing', { run_id: 'run-1' });
    state = setPhaseStatus(state, 'F1', 'verifying');

    const blocked = closePhase(state, 'F1', { ...green, verify_status: 'failed', contract_failed: ['check-pack-t2'] });
    assert.equal(blocked.gate.ok, false);
    assert.equal(blocked.state, state, 'gate reprovado não muda o estado');
    assert.match(blocked.gate.reasons.join(' | '), /verify não concluído.*contratos do pack: check-pack-t2/);

    const closed = closePhase(state, 'F1', green, { closed_commit: 'abc123', regression_ref: '.oxe/program/regression/F1.json' });
    assert.equal(closed.gate.ok, true);
    state = closed.state;
    assert.equal(findPhase(state, 'F1')!.status, 'closed');
    assert.equal(findPhase(state, 'F1')!.closed_commit, 'abc123');
    assert.equal(state.active_phase, null);
    assert.throws(() => closePhase(state, 'F1', green), /já está fechada/);

    const progress = programProgress(state);
    assert.deepEqual([progress.index, progress.total, progress.closed, progress.phase!.id], [2, 3, 1, 'F2']);

    state = startPhase(state, 'F2');
    assert.deepEqual(closedPhasesBefore(state, 'F2').map((p) => p.id), ['F1']);
    assert.throws(() => closePhase(state, 'F3', green), /não foi iniciada/);
  });

  test('regressão falhada bloqueia o fechamento', () => {
    let state = startPhase(createProgram(ROADMAP));
    const result = closePhase(state, 'F1', { ...green, regression_failed: ['reg-f0-check-a1'] });
    assert.equal(result.gate.ok, false);
    assert.match(result.gate.reasons[0], /regressão de fases anteriores: reg-f0-check-a1/);
  });

  test('plano não pode usar A* de outra fase', () => {
    const state = createProgram(ROADMAP);
    assert.deepEqual(acceptanceOutsidePhase(findPhase(state, 'F1')!, ['A1', 'A4', 'A1']), ['A4']);
  });
});
