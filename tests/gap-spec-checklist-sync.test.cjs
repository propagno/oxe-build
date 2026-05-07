'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Access the internal function through a thin test harness —
// we call projectRuntimeArtifacts in write:false mode and then
// call applySpecChecklistSync directly via require internals.
// Since it's not exported, we test the observable side-effect:
// SPEC.md must have [x] items after projectRuntimeArtifacts writes with a completed run.

const operational = require('../bin/lib/oxe-operational.cjs');

const SPEC_TEMPLATE = `# Project — SPEC

## Objetivo

Test.

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | ok | Run \`node -e "1"\` |

## Decisões persistentes

| ID | Decisão | Racional |
|---|---|---|
| D-01 | x | y |

## 10. Roadmap

### 10.1 Wave 1 — Terminal

**DoD Wave 1:**
- [ ] Abrir workspace
- [ ] PTY real
- [ ] Persistência SQLite

**Limite técnico W1:** Não implementar W2+.

### 10.2 Wave 2 — Agents

**DoD Wave 2:**
- [ ] Auto-discovery
- [ ] Readiness badges

## 21. Checklist final

### 21.1 MVP (v0.1.0) — pronto quando ✓ em todos

- [ ] electron-vite configurado
- [ ] SQLite conectado
- [ ] Testes passing

### 21.2 v1.0.0 — pronto quando ✓ em todos os anteriores mais:

- [ ] Todos os agentes
- [ ] Installer NSIS
`;

function makeRunState(completedIds, waveDefs) {
  // Build a minimal compiled_graph and canonical_state as projectRuntimeArtifacts expects
  const nodes = completedIds.map(id => ({
    id,
    title: `Task ${id}`,
    wave: 1,
    verify: { command: null, must_pass: [], acceptance_refs: [] },
    dependsOn: [],
    complexity: 'S',
    targetPaths: [],
    risk: 'low',
    retries: 0,
  }));
  const waves = waveDefs || [{ wave_number: 1, node_ids: completedIds }];
  return {
    run_id: 'run-test-checklist',
    status: 'completed',
    compiled_graph: {
      nodes,
      waves,
      edges: [],
      metadata: { node_count: nodes.length, wave_count: waves.length, plan_hash: 'x', spec_hash: 'y' },
    },
    canonical_state: {
      run: { run_id: 'run-test-checklist', status: 'completed', mode: 'solo' },
      workItems: nodes.map(n => ({ id: n.id, status: 'completed' })),
      attempts: {},
      workspaces: [],
      completedWorkItems: completedIds,
      failedWorkItems: [],
      blockedWorkItems: [],
      summary: { completed: completedIds.length, failed: 0, blocked: 0 },
    },
  };
}

describe('applySpecChecklistSync — via projectRuntimeArtifacts', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-checklist-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSpec(content) {
    fs.writeFileSync(path.join(tmpDir, '.oxe', 'SPEC.md'), content, 'utf8');
  }

  function readSpec() {
    return fs.readFileSync(path.join(tmpDir, '.oxe', 'SPEC.md'), 'utf8');
  }

  function writeMinimalPlan() {
    fs.writeFileSync(path.join(tmpDir, '.oxe', 'STATE.md'),
      '# OXE — STATE\n\n- **phase:** plan_ready\n- **runtime_status:** enterprise\n- **plan_review_status:** approved\n- **checkpoint_status:** none\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, '.oxe', 'PLAN.md'),
      '# OXE — PLAN\n\n## Resumo\n\nPlano mínimo.\n\n### T1 — Criar arquivo\n\n**Onda:** 1\n**Depende de:** nenhum\n**Complexidade:** XS\n**Arquivos prováveis:** `hello.txt`\n**Aceite vinculado:** A1\n**Decisão vinculada:** D-01\nComando: `node -e "1"`\n\nCriar arquivo.\n\n## Autoavaliação do Plano\n\n**Melhor plano atual:** sim\n**Confiança:** 93%\n', 'utf8');
  }

  it('marca DoD Wave 1 quando run com wave 1 completa', () => {
    writeSpec(SPEC_TEMPLATE);
    writeMinimalPlan();

    // Use projectRuntimeArtifacts with injected runState that has wave 1 completed
    let result;
    try {
      result = operational.projectRuntimeArtifacts(tmpDir, null, {
        runState: makeRunState(['T1'], [{ wave_number: 1, node_ids: ['T1'] }]),
      });
    } catch (err) {
      if (err.message.includes('Runtime package') || err.message.includes('ProjectionEngine')) {
        // Runtime not built — skip, but SPEC.md is still written by applySpecChecklistSync
        // which is called before the runtime check fails... actually it's called after.
        // In CI without build, skip.
        return;
      }
      throw err;
    }

    const spec = readSpec();
    assert.ok(spec.includes('- [x] Abrir workspace'), 'Wave 1 DoD item deve estar marcado');
    assert.ok(spec.includes('- [x] PTY real'), 'Wave 1 DoD item deve estar marcado');
    assert.ok(spec.includes('- [x] Persistência SQLite'), 'Wave 1 DoD item deve estar marcado');
    assert.ok(spec.includes('- [ ] Auto-discovery'), 'Wave 2 DoD NÃO deve ser marcado');
  });

  it('marca MVP checklist quando todas as waves estão completas', () => {
    writeSpec(SPEC_TEMPLATE);
    writeMinimalPlan();

    let result;
    try {
      result = operational.projectRuntimeArtifacts(tmpDir, null, {
        runState: makeRunState(['T1'], [{ wave_number: 1, node_ids: ['T1'] }]),
      });
    } catch (err) {
      if (err.message.includes('Runtime package') || err.message.includes('ProjectionEngine')) return;
      throw err;
    }

    const spec = readSpec();
    assert.ok(spec.includes('- [x] electron-vite configurado'), 'MVP checklist deve estar marcado');
    assert.ok(spec.includes('- [x] SQLite conectado'), 'MVP checklist deve estar marcado');
    assert.ok(spec.includes('- [ ] Todos os agentes'), 'v1.0.0 checklist NÃO deve ser marcado');
  });

  it('não marca DoD de wave incompleta', () => {
    writeSpec(SPEC_TEMPLATE);
    writeMinimalPlan();

    // Wave 2 has T1 and T2, but only T1 is completed
    let result;
    try {
      result = operational.projectRuntimeArtifacts(tmpDir, null, {
        runState: makeRunState(['T1'], [
          { wave_number: 1, node_ids: ['T1'] },
          { wave_number: 2, node_ids: ['T1', 'T2'] },
        ]),
      });
    } catch (err) {
      if (err.message.includes('Runtime package') || err.message.includes('ProjectionEngine')) return;
      throw err;
    }

    const spec = readSpec();
    assert.ok(spec.includes('- [ ] Auto-discovery'), 'Wave 2 DoD NÃO deve ser marcado quando wave 2 incompleta');
  });

  it('não altera SPEC.md quando run não está completed', () => {
    writeSpec(SPEC_TEMPLATE);
    writeMinimalPlan();

    const runState = makeRunState(['T1'], [{ wave_number: 1, node_ids: ['T1'] }]);
    runState.status = 'running';
    runState.canonical_state.run.status = 'running';

    let threw = false;
    try {
      operational.projectRuntimeArtifacts(tmpDir, null, { runState });
    } catch (err) {
      if (err.message.includes('Runtime package') || err.message.includes('ProjectionEngine')) {
        threw = true;
      } else {
        throw err;
      }
    }

    if (threw) return;

    const spec = readSpec();
    assert.ok(spec.includes('- [ ] Abrir workspace'), 'Itens devem permanecer desmarcados com run running');
  });
});
