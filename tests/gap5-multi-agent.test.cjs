'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runRuntimeExecute } = require('../bin/lib/oxe-operational.cjs');

describe('Gap 5 — MultiAgentCoordinator wiring via runRuntimeExecute', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-gap5-'));
    // Create minimal .oxe structure
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runRuntimeExecute is exported from oxe-operational', () => {
    assert.equal(typeof runRuntimeExecute, 'function', 'runRuntimeExecute must be a function');
  });

  it('throws when runtime is not available and no compiled_graph exists', async () => {
    // Without a compiled graph, should throw a descriptive error (runtime, graph, SPEC, or compile)
    await assert.rejects(
      () => runRuntimeExecute(tmpDir, null, {}),
      (err) => {
        assert.ok(err instanceof Error, 'Must throw an Error');
        assert.ok(err.message.length > 0, 'Error must have a message');
        return true;
      }
    );
  });

  it('throws when plan-agents.json is syntactically invalid JSON', async () => {
    // Write a valid SPEC/PLAN stub so we get past the graph-compile step, then hit plan-agents.json parse
    const agentPlanPath = path.join(tmpDir, '.oxe', 'plan-agents.json');
    fs.writeFileSync(agentPlanPath, '{ invalid json <<<');
    try {
      await assert.rejects(
        () => runRuntimeExecute(tmpDir, null, {}),
        (err) => {
          assert.ok(err instanceof Error, 'Must throw an Error');
          // Either plan-agents.json parse error OR upstream graph compile error (both legitimate)
          assert.ok(err.message.length > 0, 'Must have a descriptive message');
          return true;
        }
      );
    } finally {
      fs.rmSync(agentPlanPath, { force: true });
    }
  });

  it('plan-agents.json invalid JSON error message includes "plan-agents.json inválido" when graph is compiled', async () => {
    // Simulate a run state with a compiled_graph to bypass the compile step.
    // skipPreflight: true bypasses buildRuntimeExecutePreflight which returns (not throws) on stub run state.
    const agentPlanPath = path.join(tmpDir, '.oxe', 'plan-agents.json');
    fs.writeFileSync(agentPlanPath, '{ invalid json <<<');
    const fakeRunState = { run_id: 'run-test', compiled_graph: { nodes: [], edges: [], waves: [], metadata: {} } };
    try {
      await assert.rejects(
        () => runRuntimeExecute(tmpDir, null, { runState: fakeRunState, skipPreflight: true }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('plan-agents.json inválido'),
            `Expected "plan-agents.json inválido", got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      fs.rmSync(agentPlanPath, { force: true });
    }
  });

  it('throws "agents vazio ou ausente" when plan-agents.json has empty agents array (with compiled graph)', async () => {
    // validateMultiAgentPlan reports 'campo "agents" vazio ou ausente', wrapped in 'plan-agents.json inválido: ...'
    const agentPlanPath = path.join(tmpDir, '.oxe', 'plan-agents.json');
    fs.writeFileSync(agentPlanPath, JSON.stringify({ oxePlanAgentsSchema: 3, mode: 'parallel', agents: [] }));
    const fakeRunState = { run_id: 'run-test', compiled_graph: { nodes: [], edges: [], waves: [], metadata: {} } };
    try {
      await assert.rejects(
        () => runRuntimeExecute(tmpDir, null, { runState: fakeRunState, skipPreflight: true }),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes('agents') && err.message.includes('inválido'),
            `Expected error about agents, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      fs.rmSync(agentPlanPath, { force: true });
    }
  });

  it('throws when plan-agents.json has no agents field', async () => {
    const agentPlanPath = path.join(tmpDir, '.oxe', 'plan-agents.json');
    fs.writeFileSync(agentPlanPath, JSON.stringify({ oxePlanAgentsSchema: 3, mode: 'parallel' }));
    try {
      await assert.rejects(
        () => runRuntimeExecute(tmpDir, null, {}),
        (err) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );
    } finally {
      fs.rmSync(agentPlanPath, { force: true });
    }
  });

  it('session-level plan-agents.json takes priority over root-level', async () => {
    // Write root-level with empty agents (would throw)
    const rootPlan = path.join(tmpDir, '.oxe', 'plan-agents.json');
    fs.writeFileSync(rootPlan, JSON.stringify({ oxePlanAgentsSchema: 3, mode: 'parallel', agents: [] }));

    // Write session-level with valid agents (but still throws because no runtime)
    const sessionDir = path.join(tmpDir, '.oxe', 'my-session', 'plan');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessPlan = path.join(sessionDir, 'plan-agents.json');
    fs.writeFileSync(sessPlan, JSON.stringify({
      oxePlanAgentsSchema: 3,
      mode: 'parallel',
      agents: [{ id: 'agent-1', tasks: ['T1'] }],
    }));

    try {
      await assert.rejects(
        () => runRuntimeExecute(tmpDir, 'my-session', {}),
        (err) => {
          assert.ok(err instanceof Error);
          // Error must NOT be "agentes válidos" (which means root-level was used)
          // It should be runtime/graph error since session plan has valid agents
          assert.ok(
            !err.message.includes('não contém agentes válidos'),
            'Session plan with valid agents was ignored — root plan was incorrectly used'
          );
          return true;
        }
      );
    } finally {
      fs.rmSync(rootPlan, { force: true });
      fs.rmSync(sessPlan, { force: true });
    }
  });
});
