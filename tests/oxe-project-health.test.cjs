'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('../bin/lib/oxe-project-health.cjs');

describe('oxe-project-health', () => {
  test('copilotIntegrationReport is healthy when workspace prompts and instructions are aligned', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-'));
    const fakeCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-home-'));
    const prevCopilotHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = fakeCopilotHome;
    try {
      fs.mkdirSync(path.join(dir, '.github', 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.oxe', 'install'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.oxe', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'workflows', 'scan.md'), '# scan\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.github', 'prompts', 'oxe-scan.prompt.md'),
        'Veja `.oxe/workflows/scan.md`.\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.github', 'copilot-instructions.md'),
        '<!-- oxe-cc:install-begin -->\nworkspace\n<!-- oxe-cc:install-end -->\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.oxe', 'install', 'copilot-vscode.json'),
        JSON.stringify({ prompt_files: ['oxe-scan.prompt.md'] }),
        'utf8'
      );
      const report = h.copilotIntegrationReport(dir);
      assert.strictEqual(report.status, 'healthy');
      assert.strictEqual(report.promptSource, 'workspace');
      assert.deepStrictEqual(report.warnings, []);
    } finally {
      if (prevCopilotHome == null) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = prevCopilotHome;
    }
  });

  test('copilotIntegrationReport warns when only legacy global install exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-legacy-'));
    const fakeCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-home-'));
    const prevCopilotHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = fakeCopilotHome;
    try {
      const legacyPrompts = path.join(fakeCopilotHome, 'prompts');
      fs.mkdirSync(legacyPrompts, { recursive: true });
      fs.writeFileSync(path.join(legacyPrompts, 'oxe-plan.prompt.md'), 'legacy\n', 'utf8');
      fs.writeFileSync(
        path.join(fakeCopilotHome, 'copilot-instructions.md'),
        '<!-- oxe-cc:install-begin -->\nlegacy\n<!-- oxe-cc:install-end -->\n<!-- legacy managed -->\n',
        'utf8'
      );
      const report = h.copilotIntegrationReport(dir);
      assert.strictEqual(report.promptSource, 'legacy_global');
      assert.strictEqual(report.status, 'warning');
      assert.ok(report.warnings.some((w) => /apenas no legado global/i.test(w)));
      assert.ok(report.warnings.some((w) => /outro framework/i.test(w)));
    } finally {
      if (prevCopilotHome == null) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = prevCopilotHome;
    }
  });

  test('copilotIntegrationReport flags prompt path mismatch for nested layout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-path-'));
    const fakeCopilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-copilot-home-'));
    const prevCopilotHome = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = fakeCopilotHome;
    try {
      fs.mkdirSync(path.join(dir, '.github', 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.oxe', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'workflows', 'scan.md'), '# scan\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, '.github', 'prompts', 'oxe-scan.prompt.md'),
        'Veja `oxe/workflows/scan.md`.\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, '.github', 'copilot-instructions.md'),
        '<!-- oxe-cc:install-begin -->\nlegacy\n<!-- oxe-cc:install-end -->\n',
        'utf8'
      );
      const report = h.copilotIntegrationReport(dir);
      assert.strictEqual(report.status, 'broken');
      assert.ok(report.warnings.some((w) => /aponta para oxe\/workflows/i.test(w)));
    } finally {
      if (prevCopilotHome == null) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = prevCopilotHome;
    }
  });

  test('validateConfigShape flags invalid install.profile', () => {
    const { unknownKeys, typeErrors } = h.validateConfigShape({
      discuss_before_plan: false,
      install: { profile: 'not-a-real-profile', repo_layout: 'nested' },
    });
    assert.ok(!unknownKeys.includes('install'));
    assert.ok(typeErrors.some((t) => /install\.profile/i.test(t)));
  });

  test('validateConfigShape accepts install object', () => {
    const { typeErrors } = h.validateConfigShape({
      install: {
        profile: 'recommended',
        repo_layout: 'classic',
        vscode: false,
        include_commands_dir: true,
        include_agents_md: true,
      },
    });
    assert.ok(!typeErrors.length);
  });

  test('validateConfigShape accepts azure object', () => {
    const { typeErrors } = h.validateConfigShape({
      azure: {
        enabled: true,
        default_resource_group: 'rg-app',
        preferred_locations: ['brazilsouth'],
        inventory_max_age_hours: 24,
        resource_graph_auto_install: true,
        vpn_required: true,
      },
    });
    assert.deepStrictEqual(typeErrors, []);
  });

  test('parseStatePhase reads first backtick token', () => {
    const t = '## Fase atual\n\n`plan_ready` — notas\n';
    assert.strictEqual(h.parseStatePhase(t), 'plan_ready');
  });

  test('parseLastScanDate parses ISO line', () => {
    const t = '## Último scan\n\n- **Data:** 2026-03-15\n';
    const d = h.parseLastScanDate(t);
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getFullYear(), 2026);
  });

  test('parseLastCompactDate parses ISO under Último compact section', () => {
    const t =
      '## Último compact (codebase + RESUME) (opcional)\n\n- **Data:** 2026-03-20\n- **Notas:** x\n';
    const d = h.parseLastCompactDate(t);
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getUTCMonth(), 2);
    assert.strictEqual(d.getUTCDate(), 20);
  });

  test('parseLastCompactDate placeholder paren returns null', () => {
    assert.strictEqual(
      h.parseLastCompactDate(
        '## Último compact (codebase + RESUME)\n\n- **Data:** (**YYYY-MM-DD** — template)\n'
      ),
      null
    );
  });

  test('isStaleScan respects maxAgeDays', () => {
    const old = new Date('2020-01-01');
    assert.strictEqual(h.isStaleScan(old, 30).stale, true);
    assert.strictEqual(h.isStaleScan(new Date(), 30).stale, false);
    assert.strictEqual(h.isStaleScan(old, 0).stale, false);
  });

  test('specSectionWarnings when heading missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const spec = path.join(dir, 'SPEC.md');
    fs.writeFileSync(spec, '# Spec\n\n## Objetivo\nx\n', 'utf8');
    const w = h.specSectionWarnings(spec, ['## Critérios de aceite']);
    assert.ok(w.length >= 1);
  });

  test('planWaveWarningsFixed counts tasks per Onda', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const plan = path.join(dir, 'PLAN.md');
    fs.writeFileSync(
      plan,
      `## Tarefas\n\n- **Onda:** 1\n\n### T1 — a\n### T2 — b\n### T3 — c\n`,
      'utf8'
    );
    const w = h.planWaveWarningsFixed(plan, 2);
    assert.ok(w.some((x) => /onda\s*1/i.test(x) && /3\s*tarefas/i.test(x)));
  });

  test('planTaskAceiteWarnings flags Tn without Aceite vinculado', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const plan = path.join(dir, 'PLAN.md');
    fs.writeFileSync(
      plan,
      `## Tarefas\n\n### T1 — ok\n- **Aceite vinculado:** A1\n\n### T2 — sem aceite\n- foo\n`,
      'utf8'
    );
    const w = h.planTaskAceiteWarnings(plan);
    assert.strictEqual(w.length, 1);
    assert.ok(/T2/i.test(w[0]));
    assert.ok(!w[0].includes('T1'));
  });

  test('buildHealthReport merges planTaskAceiteWarnings into planWarn', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '## Fase atual\n\n`plan_ready`\n\n## Revisão do plano (opcional — dashboard / aprovação)\n\n- **plan_review_status:** `approved`\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — x\n- **Onda:** 1\n',
      'utf8'
    );
    const r = h.buildHealthReport(dir);
    assert.ok(r.planWarn.some((x) => /T1.*Aceite vinculado/i.test(x)));
  });

  test('runtimeWarnings flag missing runtime and checkpoints artifacts referenced by state', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    const stateText =
      '# OXE\n\n**checkpoint_status:** pending_approval\n\n**runtime_status:** blocked\n';
    const warns = h.runtimeWarnings(stateText, h.scopedOxePaths(dir, null));
    assert.ok(warns.some((x) => /checkpoint pendente/i.test(x)));
    assert.ok(warns.some((x) => /runtime bloqueado/i.test(x)));
  });

  test('capabilityWarnings flag missing capability index when dir exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe', 'capabilities'), { recursive: true });
    const warns = h.capabilityWarnings(h.scopedOxePaths(dir, null));
    assert.ok(warns.some((x) => /CAPABILITIES\.md/i.test(x)));
  });

  test('capabilityWarnings flag malformed capability policy metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const capDir = path.join(dir, '.oxe', 'capabilities', 'broken-cap');
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, 'CAPABILITY.md'),
      '---\nid: broken-cap\ntype: script\nstatus: active\nscope: execute\nentrypoint: ""\n---\n\n# OXE — Capability\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, '.oxe', 'CAPABILITIES.md'), '# idx\n', 'utf8');
    const warns = h.capabilityWarnings(h.scopedOxePaths(dir, null));
    assert.ok(warns.some((x) => /approval_policy/i.test(x)));
  });

  test('investigationWarnings flag missing investigations index when dir exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe', 'investigations'), { recursive: true });
    const warns = h.investigationWarnings(h.scopedOxePaths(dir, null));
    assert.ok(warns.some((x) => /INVESTIGATIONS\.md/i.test(x)));
  });

  test('suggestNextStep scan when no .oxe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const s = h.suggestNextStep(dir, {});
    assert.strictEqual(s.step, 'scan');
  });

  test('suggestNextStep execute when plan but no verify', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '## Fase atual\n\n`plan_ready`\n\n## Revisão do plano (opcional — dashboard / aprovação)\n\n- **plan_review_status:** `approved`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '### T1\n- **Onda:** 1\n', 'utf8');
    const s = h.suggestNextStep(dir, { discuss_before_plan: false });
    assert.strictEqual(s.step, 'execute');
  });

  test('suggestNextStep respects pending checkpoint approval', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '## Fase atual\n\n`plan_ready`\n\n**checkpoint_status:** pending_approval\n\n## Revisão do plano (opcional — dashboard / aprovação)\n\n- **plan_review_status:** `approved`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 80%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 12/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 10/15\n  - Lacunas externas / decisões pendentes: 8/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n',
      'utf8'
    );
    const s = h.suggestNextStep(dir, { discuss_before_plan: false });
    assert.strictEqual(s.step, 'execute');
    assert.match(s.reason, /checkpoint pendente/i);
  });

  // W3.1 — parseActiveSession
  test('parseActiveSession extrai session string do STATE', () => {
    const text = '## Fase atual\n\n`executing`\n\n**active_session:** `sessions/s001-demo`\n';
    assert.strictEqual(h.parseActiveSession(text), 'sessions/s001-demo');
  });

  test('parseActiveSession retorna null para placeholder em dash', () => {
    const text = '**active_session:** `—`\n';
    assert.strictEqual(h.parseActiveSession(text), null);
  });

  test('parseActiveSession retorna null para none', () => {
    const text = '**active_session:** none\n';
    assert.strictEqual(h.parseActiveSession(text), null);
  });

  test('parseActiveSession converte backslash para forward slash', () => {
    const text = '**active_session:** `sessions\\s001-demo`\n';
    const result = h.parseActiveSession(text);
    assert.ok(!result || !result.includes('\\'), 'should not contain backslashes');
  });

  test('parseActiveSession retorna null para texto vazio', () => {
    assert.strictEqual(h.parseActiveSession(''), null);
    assert.strictEqual(h.parseActiveSession(null), null);
  });

  // W3.1 — scopedOxePaths
  test('scopedOxePaths sem activeSession retorna paths base inalterados', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const base = h.oxePaths(dir);
    const scoped = h.scopedOxePaths(dir, null);
    assert.strictEqual(scoped.state, base.state);
    assert.strictEqual(scoped.oxe, base.oxe);
    assert.strictEqual(scoped.activeSession, null);
  });

  test('scopedOxePaths com activeSession escopa spec, plan e verify sob session root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const scoped = h.scopedOxePaths(dir, 'sessions/s001-demo');
    const sessionRoot = path.join(dir, '.oxe', 'sessions', 's001-demo');
    assert.strictEqual(scoped.sessionRoot, sessionRoot);
    assert.strictEqual(scoped.spec, path.join(sessionRoot, 'spec', 'SPEC.md'));
    assert.strictEqual(scoped.plan, path.join(sessionRoot, 'plan', 'PLAN.md'));
    assert.strictEqual(scoped.verify, path.join(sessionRoot, 'verification', 'VERIFY.md'));
    assert.strictEqual(scoped.discuss, path.join(sessionRoot, 'spec', 'DISCUSS.md'));
  });

  test('scopedOxePaths com activeSession mantem state no nivel base .oxe/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const scoped = h.scopedOxePaths(dir, 'sessions/s001-demo');
    const base = h.oxePaths(dir);
    assert.strictEqual(scoped.state, base.state);
    assert.strictEqual(scoped.oxe, base.oxe);
  });

  test('buildHealthReport exposes active run, event summary and memory layers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.mkdirSync(path.join(oxe, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`executing`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'ACTIVE-RUN.json'), JSON.stringify({ run_id: 'oxe-run-health', updated_at: '2026-04-11T00:00:00Z' }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'runs', 'oxe-run-health.json'), JSON.stringify({ run_id: 'oxe-run-health', status: 'running', current_wave: 1, cursor: { wave: 1, task: 'T1' }, graph: { nodes: [], edges: [] } }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'OXE-EVENTS.ndjson'), `${JSON.stringify({ type: 'run_started' })}\n`, 'utf8');
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.activeRun.run_id, 'oxe-run-health');
    assert.strictEqual(report.eventsSummary.total, 1);
    assert.ok(report.memoryLayers.readOrder.includes('evidence'));
  });

  // F3 — Permissions validation
  test('permissions array com regra válida aceita', () => {
    const { typeErrors } = h.validateConfigShape({
      permissions: [{ pattern: '*.env', action: 'deny', scope: 'execute' }],
    });
    assert.strictEqual(typeErrors.filter((e) => e.includes('permissions')).length, 0);
  });

  test('permissions regra com action inválido rejeitada', () => {
    const { typeErrors } = h.validateConfigShape({
      permissions: [{ pattern: '*.env', action: 'block' }],
    });
    assert.ok(typeErrors.some((e) => e.includes('permissions[0].action')));
  });

  test('permissions regra sem pattern rejeitada', () => {
    const { typeErrors } = h.validateConfigShape({
      permissions: [{ action: 'deny' }],
    });
    assert.ok(typeErrors.some((e) => e.includes('permissions[0].pattern')));
  });

  test('permissions scope inválido rejeitado', () => {
    const { typeErrors } = h.validateConfigShape({
      permissions: [{ pattern: '*.env', action: 'deny', scope: 'build' }],
    });
    assert.ok(typeErrors.some((e) => e.includes('permissions[0].scope')));
  });

  test('permissions não-array rejeitado', () => {
    const { typeErrors } = h.validateConfigShape({
      permissions: 'deny-all',
    });
    assert.ok(typeErrors.some((e) => e.includes('permissions')));
  });

  // F4 — Config hierarchy sources field
  test('loadOxeConfigMerged retorna sources com campos system/user/project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cfg-'));
    const result = h.loadOxeConfigMerged(dir);
    assert.ok('sources' in result);
    assert.ok('system' in result.sources);
    assert.ok('user' in result.sources);
    assert.ok('project' in result.sources);
  });

  test('loadOxeConfigMerged project source aponta para .oxe/config.json quando existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cfg-'));
    const oxeDir = path.join(dir, '.oxe');
    fs.mkdirSync(oxeDir, { recursive: true });
    fs.writeFileSync(path.join(oxeDir, 'config.json'), JSON.stringify({ discuss_before_plan: true }), 'utf8');
    const result = h.loadOxeConfigMerged(dir);
    assert.strictEqual(result.sources.project, path.join(oxeDir, 'config.json'));
    assert.strictEqual(result.config.discuss_before_plan, true);
  });

  // F6 — Plugins array validation
  test('plugins array com source objects aceita', () => {
    const { typeErrors } = h.validateConfigShape({
      plugins: [{ source: 'npm:oxe-plugin-foo' }],
    });
    assert.strictEqual(typeErrors.filter((e) => e.includes('plugins')).length, 0);
  });

  test('plugins array com strings legado aceita', () => {
    const { typeErrors } = h.validateConfigShape({
      plugins: ['my-plugin.cjs'],
    });
    assert.strictEqual(typeErrors.filter((e) => e.includes('plugins')).length, 0);
  });

  test('plugins source vazia rejeitada', () => {
    const { typeErrors } = h.validateConfigShape({
      plugins: [{ source: '' }],
    });
    assert.ok(typeErrors.some((e) => e.includes('plugins[0].source')));
  });

  test('plugins não-array rejeitado', () => {
    const { typeErrors } = h.validateConfigShape({
      plugins: 'my-plugin.cjs',
    });
    assert.ok(typeErrors.some((e) => e.includes('plugins')));
  });
});
