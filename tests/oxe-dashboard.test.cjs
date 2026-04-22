'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const dashboard = require('../bin/lib/oxe-dashboard.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');
const operational = require('../bin/lib/oxe-operational.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

function writeRationalityPacks(oxeDir, taskIds = ['T1']) {
  fs.writeFileSync(path.join(oxeDir, 'IMPLEMENTATION-PACK.md'), '# implementation\n', 'utf8');
  fs.writeFileSync(
    path.join(oxeDir, 'IMPLEMENTATION-PACK.json'),
    JSON.stringify({
      schema_version: '1',
      generated_at: '2026-04-22T12:00:00Z',
      ready: true,
      critical_gaps: [],
      tasks: taskIds.map((taskId) => ({
        id: taskId,
        title: taskId,
        mode: 'mutating',
        ready: true,
        exact_paths: [`src/${taskId.toLowerCase()}.ts`],
        write_set: 'closed',
        symbols: [{ kind: 'function', name: `${taskId.toLowerCase()}Handler`, path: `src/${taskId.toLowerCase()}.ts`, signature: '() => void' }],
        contracts: [{ name: `${taskId}-contract`, input_shape: 'void', output_shape: 'void', invariants: ['none'], not_allowed: ['none'] }],
        snippets: [],
        expected_checks: ['npm test'],
        requires_fixture: false,
        critical_gaps: [],
      })),
    }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(oxeDir, 'REFERENCE-ANCHORS.md'), '<reference_anchors version="1" ready="true" status="not_applicable"></reference_anchors>\n', 'utf8');
  fs.writeFileSync(path.join(oxeDir, 'FIXTURE-PACK.md'), '# fixture\n', 'utf8');
  fs.writeFileSync(path.join(oxeDir, 'FIXTURE-PACK.json'), JSON.stringify({ schema_version: '1', generated_at: '2026-04-22T12:00:00Z', ready: true, critical_gaps: [], fixtures: [] }, null, 2), 'utf8');
}

function requestJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode || 0, body: raw ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('oxe-dashboard', () => {
  test('savePlanReviewStatus writes state markers and PLAN-REVIEW.md', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '# OXE — Plano\n', 'utf8');

    const result = dashboard.savePlanReviewStatus(dir, {
      status: 'approved',
      note: 'Plano aprovado para execução.',
      author: 'test',
    });

    const stateText = fs.readFileSync(path.join(oxe, 'STATE.md'), 'utf8');
    assert.match(stateText, /plan_review_status:\*\*\s*`approved`/i);
    assert.match(stateText, /PLAN-REVIEW\.md/i);
    assert.ok(fs.existsSync(path.join(oxe, 'PLAN-REVIEW.md')));
    assert.strictEqual(result.status, 'approved');
  });

  test('addPlanReviewComment persists comment json and markdown summary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '# OXE — Plano\n', 'utf8');

    const comment = dashboard.addPlanReviewComment(dir, {
      target: 'wave:1',
      type: 'risk',
      text: 'Há mistura de migração com validação na onda 1.',
      author: 'test',
    });

    const comments = JSON.parse(fs.readFileSync(path.join(oxe, 'plan-review-comments.json'), 'utf8'));
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].id, comment.id);
    const reviewMd = fs.readFileSync(path.join(oxe, 'PLAN-REVIEW.md'), 'utf8');
    assert.match(reviewMd, /Comentários abertos/i);
    assert.match(reviewMd, /wave:1/i);
  });

  test('loadDashboardContext consolidates plan, review and diagnostics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'config.json'),
      JSON.stringify({ runtime: { quotas: { max_work_items_per_run: 1, max_mutations_per_run: 0, max_retries_per_run: 0 } } }),
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# OXE — Spec\n\n## Objetivo\n\nTeste\n\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n\n### T1 — Demo\n- **Depende de:** —\n- **Onda:** 1\n- **Verificar:**\n  - Comando: `npm test`\n- **Implementar:** x\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
    fs.writeFileSync(
      path.join(oxe, 'EXECUTION-RUNTIME.md'),
      '## Onda atual\n\n- **Onda:** 1\n- **Estado:** running\n- **Tarefas ativas:** T1\n\n## Agentes ativos\n\n| ID | Papel | Tarefas | Estado | Último handoff |\n|----|-------|---------|--------|----------------|\n| agent-a | executor | T1 | active | — |\n\n## Checkpoints\n\n| ID | Tipo | Escopo | Estado | Decisão | Evidência |\n|----|------|--------|--------|---------|-----------|\n| CP-01 | approval | Onda 1 | pending_approval | — | — |\n\n## Evidências produzidas\n\n- logs/test.txt: teste da onda 1\n\n## Bloqueios\n\n- aguardando aprovação humana\n\n## Próximo movimento operacional\n\n- **Ação:** aguardar aprovação\n- **Motivo:** gate humano antes da execução externa\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'CHECKPOINTS.md'),
      '# OXE — Checkpoints\n\n| ID | Tipo | Fase | Escopo | Estado | Criado em | Resolvido em | Notas |\n|----|------|------|--------|--------|-----------|--------------|-------|\n| CP-01 | approval | execution | Onda 1 | pending_approval | 2026-04-10 | — | aprovação manual |\n',
      'utf8'
    );
    fs.mkdirSync(path.join(oxe, 'sessions', 's001-demo'), { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'SESSIONS.md'),
      '# OXE — Índice de sessões\n\n| ID | Nome | Status | Criada | Última atividade | Resumo | Path |\n|----|------|--------|--------|------------------|--------|------|\n| s001 | demo | active | 2026-04-10 | 2026-04-10 | Sessão de teste | `sessions/s001-demo` |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'sessions', 's001-demo', 'SESSION.md'),
      '# Session s001 — demo\n\n## Metadados\n\n- **ID:** s001\n- **Nome:** demo\n- **Status:** active\n- **Criada:** 2026-04-10\n- **Última atividade:** 2026-04-10\n- **Resumo:** Sessão de teste\n\n## Tags\n\n- backend\n\n## Histórico\n\n| Data | Evento |\n|------|--------|\n| 2026-04-10 | Sessão criada |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n\n- **active_session:** `sessions/s001-demo`\n',
      'utf8'
    );
    operational.writeRunState(dir, 'sessions/s001-demo', {
      run_id: 'oxe-runtime-demo',
      status: 'running',
      verification_manifest: {
        summary: { total: 1, pass: 1, fail: 0, skip: 0, error: 0, all_passed: true },
        checks: [{ evidence_refs: ['ev-1'] }],
        profile: 'standard',
      },
      residual_risks: {
        risks: [{ severity: 'high', description: 'Residual high risk' }],
      },
      verification_evidence_coverage: {
        total_checks: 1,
        checks_with_evidence: 1,
        total_evidence_refs: 1,
        coverage_percent: 100,
      },
      delivery: {
        promotion_record: {
          status: 'blocked',
          target_kind: 'branch_push',
          remote: 'origin',
          reasons: ['pending gate'],
          coverage_percent: 100,
        },
      },
      compiled_graph: {
        nodes: {
          T1: {
            id: 'T1',
            title: 'Demo',
            wave: 1,
            depends_on: [],
            workspace_strategy: 'inplace',
            mutation_scope: [],
            actions: [],
            verify: { must_pass: [], acceptance_refs: ['A1'], command: null },
            policy: { requires_human_approval: false, max_retries: 1 },
          },
        },
        edges: [],
        waves: [{ wave_number: 1, node_ids: ['T1'] }],
        metadata: { compiled_at: new Date().toISOString(), plan_hash: 'plan12345678', spec_hash: 'spec12345678', node_count: 1, wave_count: 1 },
      },
      canonical_state: {
        run: { run_id: 'oxe-runtime-demo', session_id: null, graph_version: 'plan12345678', started_at: new Date().toISOString(), ended_at: null, status: 'running', initiator: 'scheduler', mode: 'por_onda' },
        workItems: [{ work_item_id: 'T1', run_id: 'oxe-runtime-demo', title: 'Demo', type: 'task', depends_on: [], mutation_scope: [], policy_ref: null, verify_ref: ['A1'], status: 'running', workspace_strategy: 'inplace' }],
        attempts: {},
        workspaces: [],
        completedWorkItems: [],
        failedWorkItems: [],
        blockedWorkItems: [],
      },
    });
    fs.mkdirSync(path.join(oxe, 'runs', 'oxe-runtime-demo'), { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'runs', 'oxe-runtime-demo', 'multi-agent-state.json'),
      JSON.stringify({
        run_id: 'oxe-runtime-demo',
        mode: 'parallel',
        workspace_isolation_enforced: true,
        agent_results: [{ agent_id: 'agent-a', assigned_task_ids: ['T1'], completed: [], failed: [] }],
        ownership: [{ work_item_id: 'T1', owner_agent_id: 'agent-a' }],
        orphan_reassignments: [],
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'AUDIT-TRAIL.ndjson'),
      `${JSON.stringify({ action: 'gate_requested', severity: 'warn', run_id: 'oxe-runtime-demo', actor: 'runtime', timestamp: '2026-04-10T00:00:00Z' })}\n`,
      'utf8'
    );
    dashboard.savePlanReviewStatus(dir, { status: 'in_review', note: 'Revisão em curso', author: 'test' });

    const ctx = dashboard.loadDashboardContext(dir);
    assert.strictEqual(ctx.plan.totalTasks, 1);
    assert.strictEqual(ctx.planReviewStatus, 'in_review');
    assert.ok(Array.isArray(ctx.plan.waves));
    assert.ok(ctx.review.markdownPath.endsWith('PLAN-REVIEW.md'));
    assert.strictEqual(ctx.runtime.parsed.status, 'running');
    assert.strictEqual(ctx.runtime.parsed.currentWave, 1);
    assert.strictEqual(ctx.checkpoints.parsed.length, 1);
    assert.strictEqual(ctx.visual.flow.nodes.length, 8);
    assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'runtime'));
    assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'active-run'));
    assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'implementation-pack'));
    assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'reference-anchors'));
    assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'fixture-pack'));
    assert.strictEqual(ctx.sessions.items.length, 1);
    assert.strictEqual(ctx.sessions.current.id, 's001');
    assert.strictEqual(ctx.sessions.current.tags[0], 'backend');
    assert.ok(ctx.tracing.summary.total >= 1);
    assert.ok(ctx.memoryLayers.readOrder.includes('project_memory'));
    assert.ok(ctx.runtimeCanonical);
    assert.ok(ctx.compiledGraph);
    assert.ok(ctx.enterprise);
    assert.ok(ctx.enterprise.runtimeMode);
    assert.strictEqual(ctx.enterprise.runtimeMode.runtime_mode, 'enterprise');
    assert.strictEqual(ctx.enterprise.fallbackMode, 'none');
    assert.ok(ctx.enterprise.gateQueue);
    assert.ok(ctx.enterprise.policyCoverage);
    assert.ok(ctx.enterprise.quotaSummary);
    assert.ok(ctx.enterprise.auditSummary);
    assert.ok(ctx.enterprise.promotionSummary);
    assert.ok(ctx.enterprise.promotionReadiness);
    assert.ok(ctx.enterprise.recoveryState);
    assert.ok(ctx.enterprise.multiAgent);
    assert.strictEqual(ctx.enterprise.multiAgent.mode, 'parallel');
    assert.ok(ctx.enterprise.providerCatalog);
    assert.ok(ctx.executionRationality);
    assert.strictEqual(ctx.executionRationality.executionRationalityReady, true);
    assert.ok(Array.isArray(ctx.diagnostics.enterpriseWarnings));
  });

  test('dashboard dump-context prints json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-cli-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Objetivo\nx\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n', 'utf8');
    writeRationalityPacks(oxe, ['T1']);

    const r = spawnSync(process.execPath, [CLI, 'dashboard', '--dump-context', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const data = JSON.parse(r.stdout.trim());
    assert.strictEqual(data.phase, 'plan_ready');
    assert.ok(data.plan);
  });

  test('dashboard runtime API updates active run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-api-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Objetivo\nx\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n', 'utf8');
    writeRationalityPacks(oxe, ['T1']);

    const server = dashboard.createDashboardServer(dir);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = /** @type {{port:number}} */ (server.address()).port;
    try {
      const start = await requestJson(
        port,
        'POST',
        '/api/runtime/action',
        JSON.stringify({ action: 'start', wave: 1, task: 'T1', reason: 'api test' })
      );
      assert.strictEqual(start.statusCode, 200);
      assert.strictEqual(start.body.status, 'running');

      const context = await requestJson(port, 'GET', '/api/context');
      assert.strictEqual(context.statusCode, 200);
      assert.strictEqual(context.body.activeRun.status, 'running');
      assert.ok(context.body.operationalGraph.nodes.length >= 2);
    } finally {
      server.close();
    }
  });

  test('dashboard runtime gates resolve API returns updated queue payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dash-gate-api-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    fs.mkdirSync(path.join(oxe, 'execution'), { recursive: true });
    for (const f of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`executing`\n', 'utf8');
    operational.writeRunState(dir, null, { run_id: 'oxe-run-gate-api', status: 'running' });
    fs.writeFileSync(
      path.join(oxe, 'execution', 'GATES.json'),
      JSON.stringify([
        {
          gate_id: 'gate-api-1',
          scope: 'critical_mutation',
          run_id: 'oxe-run-gate-api',
          work_item_id: 'T1',
          action: 'apply_patch',
          requested_at: new Date().toISOString(),
          context: { description: 'approve change', evidence_refs: [], risks: ['scope'] },
          status: 'pending',
          resolution_history: [],
        },
      ], null, 2),
      'utf8'
    );

    const server = dashboard.createDashboardServer(dir);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = /** @type {{port:number}} */ (server.address()).port;
    try {
      const resolved = await requestJson(
        port,
        'POST',
        '/api/runtime/gates/resolve',
        JSON.stringify({ gateId: 'gate-api-1', decision: 'approve', actor: 'qa' })
      );
      assert.strictEqual(resolved.statusCode, 200);
      assert.strictEqual(resolved.body.gate.gate_id, 'gate-api-1');
      assert.strictEqual(resolved.body.gate.status, 'resolved');
      assert.ok(resolved.body.queue);
      assert.strictEqual(resolved.body.impact.pendingRemaining, 0);
    } finally {
      server.close();
    }
  });
});
