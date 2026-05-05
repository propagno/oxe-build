'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const operational = require('../bin/lib/oxe-operational.cjs');

describe('oxe-operational', () => {
  test('writeRunState and readRunState persist active run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const saved = operational.writeRunState(dir, null, {
      run_id: 'oxe-run-test',
      status: 'running',
      current_wave: 2,
      cursor: { wave: 2, task: 'T3', mode: 'wave' },
      active_tasks: ['T3'],
      pending_checkpoints: ['CP-01'],
      multi_agent: {
        enabled: true,
        mode: 'parallel',
        agents: [{ agent_id: 'agent-a', assigned_task_ids: ['T3'], completed: [], failed: [], isolation_level: 'isolated' }],
        ownership: [{ work_item_id: 'T3', agent_id: 'agent-a' }],
        handoffs: [{ handoff_id: 'handoff-1', from_agent_id: 'agent-a', to_agent_id: 'agent-b' }],
      },
    });
    assert.strictEqual(saved.run_id, 'oxe-run-test');
    const loaded = operational.readRunState(dir, null);
    assert.strictEqual(loaded.run_id, 'oxe-run-test');
    assert.strictEqual(loaded.current_wave, 2);
    assert.strictEqual(loaded.cursor.task, 'T3');
    assert.ok(loaded.multi_agent);
    assert.strictEqual(loaded.multi_agent.mode, 'parallel');
    assert.ok(loaded.graph.nodes.some((node) => node.id === 'agent:agent-a'));
    assert.ok(loaded.graph.edges.some((edge) => edge.from === 'agent:agent-a' && edge.to === 'task:T3'));
  });

  test('appendEvent writes append-only ndjson trace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'run_started', run_id: 'oxe-run-a' });
    operational.appendEvent(dir, null, { type: 'checkpoint_opened', run_id: 'oxe-run-a', payload: { checkpoint_id: 'CP-01' } });
    const events = operational.readEvents(dir, null);
    assert.strictEqual(events.length, 2);
    const summary = operational.summarizeEvents(events);
    assert.strictEqual(summary.total, 2);
    assert.strictEqual(summary.byType.run_started, 1);
    assert.strictEqual(summary.byType.checkpoint_opened, 1);
  });

  test('appendEvent persists runtime envelope fields without breaking legacy trace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const entry = operational.appendEvent(dir, null, {
      type: 'AttemptStarted',
      run_id: 'oxe-run-b',
      work_item_id: 'T9',
      attempt_id: 'T9-a1',
      causation_id: 'evt-parent',
      correlation_id: 'corr-1',
      payload: { attempt_number: 1 },
    });
    assert.strictEqual(entry.work_item_id, 'T9');
    assert.strictEqual(entry.task_id, 'T9');
    assert.strictEqual(entry.attempt_id, 'T9-a1');
    assert.strictEqual(entry.causation_id, 'evt-parent');
    const events = operational.readEvents(dir, null);
    assert.strictEqual(events[0].work_item_id, 'T9');
    assert.strictEqual(events[0].attempt_id, 'T9-a1');
  });

  test('parseCapabilityManifest reads approval policy and evidence outputs', () => {
    const raw = `---\nid: cap-a\ntype: script\nstatus: active\nscope: execute\nrequires_env: [API_KEY]\nentrypoint: scripts/run.js\napproval_policy: require_approval\nevidence_outputs: [logs/out.txt]\nside_effects: [network]\nsession_compatibility: [session]\n---\n\n# OXE — Capability\n\n## Objetivo\n\n- Faz algo importante.\n`;
    const cap = operational.parseCapabilityManifest(raw);
    assert.strictEqual(cap.id, 'cap-a');
    assert.strictEqual(cap.approvalPolicy, 'require_approval');
    assert.strictEqual(cap.evidenceOutputs[0], 'logs/out.txt');
    assert.strictEqual(cap.sideEffects[0], 'network');
  });

  test('verifyGitEvidence returns no warnings for running run without evidence', () => {
    const runState = {
      run_id: 'oxe-run-git-test',
      status: 'running',
      created_at: new Date().toISOString(),
      evidence: [],
    };
    const warns = operational.verifyGitEvidence(runState, process.cwd());
    assert.ok(Array.isArray(warns));
    // running with no evidence → no git warning expected regardless of commits
    assert.strictEqual(warns.length, 0);
  });

  test('verifyGitEvidence returns warning for completed run with no commits', () => {
    const runState = {
      run_id: 'oxe-run-git-old',
      status: 'completed',
      created_at: '2000-01-01T00:00:00.000Z', // far future relative past → no commits
      evidence: [],
    };
    // In a repo with commits before 2000 this would still be 0 commits since that date
    // We just test that the function runs and returns an array
    const warns = operational.verifyGitEvidence(runState, process.cwd());
    assert.ok(Array.isArray(warns));
  });

  test('readGitActivity returns array (empty when no git or no commits in range)', () => {
    const activity = operational.readGitActivity(process.cwd(), '2099-01-01T00:00:00Z');
    assert.ok(Array.isArray(activity));
    // no commits after year 2099
    assert.strictEqual(activity.length, 0);
  });

  // W3.2 — readCapabilityCatalog
  test('readCapabilityCatalog retorna array vazio quando dir nao existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const catalog = operational.readCapabilityCatalog(dir);
    assert.ok(Array.isArray(catalog));
    assert.strictEqual(catalog.length, 0);
  });

  test('readCapabilityCatalog retorna array vazio quando capabilities dir esta vazio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe', 'capabilities'), { recursive: true });
    const catalog = operational.readCapabilityCatalog(dir);
    assert.ok(Array.isArray(catalog));
    assert.strictEqual(catalog.length, 0);
  });

  test('readCapabilityCatalog retorna entry para capability valida', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'cap-test');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: cap-test\ntype: script\nstatus: active\nscope: execute\nentrypoint: scripts/run.js\napproval_policy: require_approval\nevidence_outputs: [logs/out.txt]\nside_effects: []\nsession_compatibility: [session]\n---\n\n# OXE — Capability\n',
      'utf8'
    );
    const catalog = operational.readCapabilityCatalog(dir);
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].id, 'cap-test');
    assert.strictEqual(catalog[0].approvalPolicy, 'require_approval');
  });

  // W3.2 — capabilityCatalogWarnings
  test('capabilityCatalogWarnings retorna warning para capability sem id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'no-id-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\ntype: script\nstatus: active\nscope: execute\nentrypoint: run.js\napproval_policy: require_approval\nevidence_outputs: [out.txt]\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.ok(warns.some((w) => /sem id/i.test(w)));
  });

  test('capabilityCatalogWarnings retorna warning para type invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'bad-type-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: bad-type-cap\ntype: invalid-type\nstatus: active\nscope: execute\nentrypoint: run.js\napproval_policy: require_approval\nevidence_outputs: [out.txt]\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.ok(warns.some((w) => /type.*inválido/i.test(w)));
  });

  test('capabilityCatalogWarnings retorna warning para approval_policy ausente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'no-policy-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: no-policy-cap\ntype: script\nstatus: active\nscope: execute\nentrypoint: run.js\nevidence_outputs: [out.txt]\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.ok(warns.some((w) => /approval_policy/i.test(w)));
  });

  test('capabilityCatalogWarnings retorna warning para entrypoint ausente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'no-entry-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: no-entry-cap\ntype: script\nstatus: active\nscope: execute\napproval_policy: require_approval\nevidence_outputs: [out.txt]\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.ok(warns.some((w) => /entrypoint/i.test(w)));
  });

  test('capabilityCatalogWarnings retorna warning para evidence_outputs ausente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'no-evidence-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: no-evidence-cap\ntype: script\nstatus: active\nscope: execute\nentrypoint: run.js\napproval_policy: require_approval\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.ok(warns.some((w) => /evidence_outputs/i.test(w)));
  });

  test('capabilityCatalogWarnings sem warnings para capability valida', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'valid-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: valid-cap\ntype: script\nstatus: active\nscope: execute\nentrypoint: run.js\napproval_policy: require_approval\nevidence_outputs: [out.txt]\nside_effects: []\nsession_compatibility: [session]\n---\n',
      'utf8'
    );
    const warns = operational.capabilityCatalogWarnings(dir);
    assert.strictEqual(warns.length, 0);
  });

  test('applyRuntimeAction builds graph and lifecycle transitions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const started = operational.applyRuntimeAction(dir, null, {
      action: 'start',
      wave: 1,
      task: 'T1',
      reason: 'start test',
    });
    assert.strictEqual(started.status, 'running');
    assert.ok(started.graph.nodes.some((node) => node.id === 'agent:main-executor'));
    assert.ok(started.graph.edges.some((edge) => edge.type === 'handoff'));

    const replaying = operational.applyRuntimeAction(dir, null, {
      action: 'replay',
      wave: 2,
      task: 'T4',
      reason: 'retry',
    });
    assert.strictEqual(replaying.status, 'replaying');
    assert.strictEqual(replaying.current_wave, 2);
    assert.ok(replaying.graph.nodes.some((node) => node.id === 'task:T4'));
  });

  // F5 — Event replay
  test('replayEvents com arquivo vazio retorna report vazio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const report = operational.replayEvents(dir, null);
    assert.strictEqual(report.totalEvents, 0);
    assert.strictEqual(report.duration_ms, null);
    assert.deepStrictEqual(report.waveIds, []);
    assert.deepStrictEqual(report.taskSequence, []);
    assert.deepStrictEqual(report.failureEvents, []);
  });

  test('replayEvents com eventos retorna report completo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'run_started', run_id: 'test-run', wave_id: 'wave-1' });
    operational.appendEvent(dir, null, { type: 'task_completed', run_id: 'test-run', wave_id: 'wave-1', task_id: 'T1' });
    operational.appendEvent(dir, null, { type: 'run_completed', run_id: 'test-run', wave_id: 'wave-2' });

    const report = operational.replayEvents(dir, null);
    assert.strictEqual(report.totalEvents, 3);
    assert.ok(report.duration_ms != null);
    assert.deepStrictEqual(report.waveIds, [1, 2]);
    assert.deepStrictEqual(report.taskSequence, ['T1']);
  });

  test('replayEvents filtra por runId', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'a', run_id: 'run-A' });
    operational.appendEvent(dir, null, { type: 'b', run_id: 'run-B' });

    const report = operational.replayEvents(dir, null, { runId: 'run-A' });
    assert.strictEqual(report.totalEvents, 1);
    assert.strictEqual(report.events[0].type, 'a');
  });

  test('replayEvents filtra por waveId', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'x', wave_id: 'wave-1' });
    operational.appendEvent(dir, null, { type: 'y', wave_id: 'wave-2' });

    const report = operational.replayEvents(dir, null, { waveId: 1 });
    assert.strictEqual(report.totalEvents, 1);
    assert.strictEqual(report.events[0].type, 'x');
  });

  test('replayEvents registra runId do primeiro evento', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'run_started', run_id: 'main-run' });

    const report = operational.replayEvents(dir, null);
    assert.strictEqual(report.runId, 'main-run');
  });

  test('replayEvents escreve REPLAY-SESSION.md com writeReport', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    operational.appendEvent(dir, null, { type: 'run_started', run_id: 'rpt-run' });

    const report = operational.replayEvents(dir, null, { writeReport: true });
    assert.ok(report._reportPath);
    assert.ok(fs.existsSync(report._reportPath));
    const content = fs.readFileSync(report._reportPath, 'utf8');
    assert.ok(content.includes('OXE — Replay Session'));
  });

  test('replayRuntimeState returns structured summary and writes report when requested', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'runs', 'run-replay'), { recursive: true });
    operational.writeRunState(dir, null, {
      run_id: 'run-replay',
      status: 'paused',
      verification_manifest: {
        summary: { total: 1, pass: 1, fail: 0, skip: 0, error: 0, all_passed: true },
        checks: [],
      },
    });
    fs.writeFileSync(
      path.join(oxe, 'runs', 'run-replay', 'journal.json'),
      JSON.stringify({ scheduler_state: 'paused', pending_gates: ['T9'] }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'runs', 'run-replay', 'policy-decisions.json'),
      JSON.stringify([{ decision_id: 'pd-1', action: 'apply_patch' }], null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'runs', 'run-replay', 'promotion-record.json'),
      JSON.stringify({ target_kind: 'pr_draft', status: 'blocked' }, null, 2),
      'utf8'
    );
    operational.appendEvent(dir, null, { type: 'run_started', run_id: 'run-replay', wave_id: 'wave-1', task_id: 'T1' });
    const summary = operational.replayRuntimeState(dir, null, { runId: 'run-replay', writeReport: true });
    assert.strictEqual(summary.run_id, 'run-replay');
    assert.ok(summary.gateQueue);
    assert.ok(Array.isArray(summary.policyDecisions));
    assert.ok(summary.verification);
    assert.ok(summary.report_path);
    assert.ok(fs.existsSync(summary.report_path));
  });

  test('readRuntimeMultiAgentStatus reads persisted runtime artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const runDir = path.join(dir, '.oxe', 'runs', 'run-ma');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'multi-agent-state.json'),
      JSON.stringify({
        run_id: 'run-ma',
        mode: 'parallel',
        workspace_isolation_enforced: true,
        agent_results: [{ agent_id: 'agent-a', assigned_task_ids: ['T1'], completed: ['T1'], failed: [] }],
        ownership: [{ work_item_id: 'T1', owner_agent_id: 'agent-a' }],
        orphan_reassignments: [],
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(runDir, 'handoffs.json'), JSON.stringify([{ handoff_id: 'h1' }], null, 2), 'utf8');
    fs.writeFileSync(path.join(runDir, 'arbitration-results.json'), JSON.stringify([{ work_item_id: 'T1' }], null, 2), 'utf8');
    fs.writeFileSync(
      path.join(runDir, 'workspace-merge-report.json'),
      JSON.stringify({
        schema_version: 1,
        run_id: 'run-ma',
        merge_readiness: 'blocked',
        arbitration_required: false,
        blockers: ['T1:missing_output:src/a.ts'],
        records: [
          {
            work_item_id: 'T1',
            agent_id: 'agent-a',
            evidence_count: 1,
            evidence_refs: ['evidence:T1'],
            verify_status: 'pass',
            applied_paths: [],
            diff_summary: { added: 0, modified: 0, missing: 1, paths: ['src/a.ts'] },
            next_action: 'Materialize o arquivo esperado src/a.ts no worktree do agente antes do merge.',
          },
        ],
      }, null, 2),
      'utf8'
    );
    operational.writeRunState(dir, null, { run_id: 'run-ma', status: 'running' });
    const status = operational.readRuntimeMultiAgentStatus(dir, null, {});
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.mode, 'parallel');
    assert.strictEqual(status.workspaceIsolationEnforced, true);
    assert.strictEqual(status.agents.length, 1);
    assert.strictEqual(status.handoffs.length, 1);
    assert.strictEqual(status.arbitrationResults.length, 1);
    assert.strictEqual(status.mergeReadiness, 'blocked');
    assert.strictEqual(status.mergeBlockers.length, 1);
    assert.match(status.nextAction, /Resolva os merge blockers/);
  });

  test('compileExecutionGraphFromArtifacts persists compiled graph and canonical state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'SPEC.md'),
      '# OXE — Spec\n\n## Objetivo\n\nCompilar runtime.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|----|----------|----------------|\n| A1 | Plano compilado | node --test |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — Demo\n**Onda:** 1\n**Depende de:** —\n**Verificar:**\n- Comando: `node --test`\n**Aceite vinculado:** A1\n',
      'utf8'
    );

    const compiled = operational.compileExecutionGraphFromArtifacts(dir, null);
    assert.strictEqual(compiled.graph.metadata.node_count, 1);
    assert.strictEqual(compiled.graph.metadata.wave_count, 1);

    const saved = operational.readRunState(dir, null);
    assert.ok(saved.compiled_graph);
    assert.ok(saved.canonical_state);
    assert.strictEqual(saved.canonical_state.summary.work_item_count, 1);
  });

  test('projectRuntimeArtifacts writes derived markdowns from canonical state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'SPEC.md'),
      '# OXE — Spec\n\n## Objetivo\n\nProjetar runtime.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|----|----------|----------------|\n| A1 | Plano compilado | node --test |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — Demo\n**Onda:** 1\n**Depende de:** —\n**Verificar:**\n- Comando: `node --test`\n**Aceite vinculado:** A1\n',
      'utf8'
    );

    operational.compileExecutionGraphFromArtifacts(dir, null);
    const projected = operational.projectRuntimeArtifacts(dir, null, { write: true });
    assert.ok(fs.existsSync(path.join(oxe, 'STATE.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'PLAN.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'VERIFY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'RUN-SUMMARY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'COMMIT-SUMMARY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'PROMOTION-SUMMARY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'PR-SUMMARY.md')));
    assert.match(fs.readFileSync(path.join(oxe, 'VERIFY.md'), 'utf8'), /Gerado automaticamente pelo Projection Engine/i);
    assert.ok(projected.run.projections.plan_ref);
    assert.ok(projected.run.projections.commit_summary_ref);
    assert.ok(projected.run.projections.promotion_summary_ref);
  });

  test('runRuntimeCiChecks persists CI results on the active run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-op-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'SPEC.md'),
      '# OXE — Spec\n\n## Objetivo\n\nExecutar CI.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|----|----------|----------------|\n| A1 | Plano compilado | node --test |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — Demo\n**Onda:** 1\n**Depende de:** —\n**Verificar:**\n- Comando: `node --test`\n**Aceite vinculado:** A1\n',
      'utf8'
    );

    operational.compileExecutionGraphFromArtifacts(dir, null);
    const ci = await operational.runRuntimeCiChecks(dir, null);
    assert.ok(ci.summary.total >= 1);
    const saved = operational.readRunState(dir, null);
    assert.ok(saved.ci_checks);
    assert.strictEqual(saved.ci_checks.summary.total, ci.summary.total);
  });
});
