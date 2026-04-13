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

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

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
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# OXE — Spec\n\n## Objetivo\n\nTeste\n\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 80%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 12/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 10/15\n  - Lacunas externas / decisões pendentes: 8/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n### T1 — Demo\n- **Depende de:** —\n- **Onda:** 1\n- **Verificar:**\n  - Comando: `npm test`\n- **Implementar:** x\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
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
    assert.strictEqual(ctx.sessions.items.length, 1);
    assert.strictEqual(ctx.sessions.current.id, 's001');
    assert.strictEqual(ctx.sessions.current.tags[0], 'backend');
    assert.ok(ctx.tracing.summary.total >= 1);
    assert.ok(ctx.memoryLayers.readOrder.includes('project_memory'));
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
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 80%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 12/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 10/15\n  - Lacunas externas / decisões pendentes: 8/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n', 'utf8');

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
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 80%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 12/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 10/15\n  - Lacunas externas / decisões pendentes: 8/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n', 'utf8');

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
});
