"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const program_model_1 = require("../src/program/program-model");
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
(0, node_test_1.describe)('programa por fases', () => {
    (0, node_test_1.test)('parseRoadmapPhases lê fases, R-IDs, A* e escopo (PT e EN, ignora comentários)', () => {
        const phases = (0, program_model_1.parseRoadmapPhases)(ROADMAP);
        strict_1.default.deepEqual(phases.map((p) => p.id), ['F1', 'F2', 'F3']);
        strict_1.default.equal(phases[0].title, 'Domínio e armazenamento');
        strict_1.default.deepEqual(phases[0].requirements, ['R1', 'R2']);
        strict_1.default.deepEqual(phases[0].acceptance, ['A1', 'A2', 'A3']);
        strict_1.default.equal(phases[1].scope, 'rotas REST com token');
        strict_1.default.equal(phases[2].title, 'Reports');
        strict_1.default.deepEqual(phases[2].acceptance, ['A6']);
    });
    (0, node_test_1.test)('ROADMAP sem fases é erro explícito', () => {
        strict_1.default.throws(() => (0, program_model_1.createProgram)('# nada aqui'), program_model_1.ProgramTransitionError);
    });
    (0, node_test_1.test)('fases rodam em ordem; só fecham pelo gate', () => {
        let state = (0, program_model_1.createProgram)(ROADMAP, '.oxe/ROADMAP.md');
        strict_1.default.equal((0, program_model_1.programProgress)(state).index, 1);
        strict_1.default.throws(() => (0, program_model_1.startPhase)(state, 'F2'), /feche antes: F1/);
        state = (0, program_model_1.startPhase)(state);
        strict_1.default.equal(state.active_phase, 'F1');
        strict_1.default.equal((0, program_model_1.findPhase)(state, 'F1').status, 'planning');
        strict_1.default.equal((0, program_model_1.findPhase)(state, '1').id, 'F1', 'aceita número');
        strict_1.default.throws(() => (0, program_model_1.setPhaseStatus)(state, 'F1', 'verifying'), /transição inválida/);
        state = (0, program_model_1.setPhaseStatus)(state, 'F1', 'executing', { run_id: 'run-1' });
        state = (0, program_model_1.setPhaseStatus)(state, 'F1', 'verifying');
        const blocked = (0, program_model_1.closePhase)(state, 'F1', { ...green, verify_status: 'failed', contract_failed: ['check-pack-t2'] });
        strict_1.default.equal(blocked.gate.ok, false);
        strict_1.default.equal(blocked.state, state, 'gate reprovado não muda o estado');
        strict_1.default.match(blocked.gate.reasons.join(' | '), /verify não concluído.*contratos do pack: check-pack-t2/);
        const closed = (0, program_model_1.closePhase)(state, 'F1', green, { closed_commit: 'abc123', regression_ref: '.oxe/program/regression/F1.json' });
        strict_1.default.equal(closed.gate.ok, true);
        state = closed.state;
        strict_1.default.equal((0, program_model_1.findPhase)(state, 'F1').status, 'closed');
        strict_1.default.equal((0, program_model_1.findPhase)(state, 'F1').closed_commit, 'abc123');
        strict_1.default.equal(state.active_phase, null);
        strict_1.default.throws(() => (0, program_model_1.closePhase)(state, 'F1', green), /já está fechada/);
        const progress = (0, program_model_1.programProgress)(state);
        strict_1.default.deepEqual([progress.index, progress.total, progress.closed, progress.phase.id], [2, 3, 1, 'F2']);
        state = (0, program_model_1.startPhase)(state, 'F2');
        strict_1.default.deepEqual((0, program_model_1.closedPhasesBefore)(state, 'F2').map((p) => p.id), ['F1']);
        strict_1.default.throws(() => (0, program_model_1.closePhase)(state, 'F3', green), /não foi iniciada/);
    });
    (0, node_test_1.test)('regressão falhada bloqueia o fechamento', () => {
        let state = (0, program_model_1.startPhase)((0, program_model_1.createProgram)(ROADMAP));
        const result = (0, program_model_1.closePhase)(state, 'F1', { ...green, regression_failed: ['reg-f0-check-a1'] });
        strict_1.default.equal(result.gate.ok, false);
        strict_1.default.match(result.gate.reasons[0], /regressão de fases anteriores: reg-f0-check-a1/);
    });
    (0, node_test_1.test)('plano não pode usar A* de outra fase', () => {
        const state = (0, program_model_1.createProgram)(ROADMAP);
        strict_1.default.deepEqual((0, program_model_1.acceptanceOutsidePhase)((0, program_model_1.findPhase)(state, 'F1'), ['A1', 'A4', 'A1']), ['A4']);
    });
});
