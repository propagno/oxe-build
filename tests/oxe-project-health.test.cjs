'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('../bin/lib/oxe-project-health.cjs');
const REPO_ROOT = path.join(__dirname, '..');

function writeRationalityPacks(oxeDir, taskIds = ['T1']) {
  fs.writeFileSync(
    path.join(oxeDir, 'IMPLEMENTATION-PACK.md'),
    '# IMPLEMENTATION-PACK\n\n- ready\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(oxeDir, 'IMPLEMENTATION-PACK.json'),
    JSON.stringify({
      schema_version: '1',
      generated_at: '2026-04-22T12:00:00Z',
      ready: true,
      critical_gaps: [],
      tasks: taskIds.map((taskId) => ({
        id: taskId,
        title: `Contrato ${taskId}`,
        mode: 'mutating',
        ready: true,
        exact_paths: [`src/${taskId.toLowerCase()}.ts`],
        write_set: 'closed',
        symbols: [{ kind: 'function', name: `${taskId.toLowerCase()}Handler`, path: `src/${taskId.toLowerCase()}.ts`, signature: '() => void' }],
        contracts: [{ name: `${taskId}-contract`, input_shape: 'void', output_shape: 'void', invariants: ['none'], not_allowed: ['none'] }],
        snippets: [{ source_ref: 'not_applicable', path: 'not_applicable', summary: 'not_applicable', status: 'not_applicable' }],
        expected_checks: ['npm test'],
        requires_fixture: false,
        critical_gaps: [],
      })),
    }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(oxeDir, 'REFERENCE-ANCHORS.md'),
    '<reference_anchors version="1" ready="true" status="not_applicable"></reference_anchors>\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(oxeDir, 'FIXTURE-PACK.md'),
    '# FIXTURE-PACK\n\n- not_applicable\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(oxeDir, 'FIXTURE-PACK.json'),
    JSON.stringify({
      schema_version: '1',
      generated_at: '2026-04-22T12:00:00Z',
      ready: true,
      critical_gaps: [],
      fixtures: [],
    }, null, 2),
    'utf8'
  );
}

function seedPackageRepoFixture(dir) {
  fs.mkdirSync(path.join(dir, '.oxe', 'release'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vscode-extension'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'oxe'), path.join(dir, 'oxe'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'commands', 'oxe'), path.join(dir, 'commands', 'oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'oxe-cc', version: '1.8.0' }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'packages', 'runtime', 'package.json'), JSON.stringify({ name: '@oxe/runtime', version: '1.8.0' }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'vscode-extension', 'package.json'), JSON.stringify({ name: 'oxe-agents', version: '1.8.0' }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'bin', 'oxe-cc.js'), '#!/usr/bin/env node\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'bin', 'banner.txt'), 'OXE v{version}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.8.0] - 2026-04-29\n\n- Release readiness fixture.\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '## Fase atual\n\n`initial`\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'runtime-smoke-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'runtime-real-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'recovery-fixture-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'multi-agent-soak-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'multi-agent-real-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
}

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

  test('suggestNextStep prefers release doctor in product package mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-package-'));
    seedPackageRepoFixture(dir);
    const s = h.suggestNextStep(dir, {});
    assert.strictEqual(s.step, 'doctor');
    assert.match(s.cursorCmd, /doctor --release --write-manifest/i);
  });

  test('suggestNextStep asks for replan when plan lacks rationality gate inputs', () => {
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
    assert.strictEqual(s.step, 'plan');
    assert.match(s.reason, /Autoavaliação do Plano|confidence_vector/i);
  });

  test('suggestNextStep execute only when confidence is strictly above 90 with rationality complete', () => {
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
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
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
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
    const s = h.suggestNextStep(dir, { discuss_before_plan: false });
    assert.strictEqual(s.step, 'execute');
    assert.match(s.reason, /checkpoint pendente/i);
  });

  test('suggestNextStep blocks execute when implementation pack is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-rationality-'));
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
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">\n  <dim name="requirements" score="0.92" weight="25" note="ok" />\n  <dim name="dependencies" score="0.93" weight="15" note="ok" />\n  <dim name="technical_risk" score="0.90" weight="20" note="controlado" />\n  <dim name="code_impact" score="0.93" weight="15" note="claro" />\n  <dim name="validation" score="0.87" weight="15" note="bom" />\n  <dim name="open_gaps" score="0.90" weight="10" note="sem gaps" />\n  <global score="0.91" gate="proceed" />\n</confidence_vector>\n\n### T1 — Demo\n- **Arquivos prováveis:** `src/demo.ts`\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'REFERENCE-ANCHORS.md'), '<reference_anchors version="1" ready="true" status="not_applicable"></reference_anchors>\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'FIXTURE-PACK.json'), JSON.stringify({ schema_version: '1', ready: true, critical_gaps: [], fixtures: [] }, null, 2), 'utf8');
    const suggestion = h.suggestNextStep(dir, {});
    assert.strictEqual(suggestion.step, 'plan');
    assert.match(suggestion.reason, /IMPLEMENTATION-PACK/i);
  });

  test('buildHealthReport exposes execution rationality readiness', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-rationality-report-'));
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
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">\n  <dim name="requirements" score="0.92" weight="25" note="ok" />\n  <dim name="dependencies" score="0.93" weight="15" note="ok" />\n  <dim name="technical_risk" score="0.90" weight="20" note="controlado" />\n  <dim name="code_impact" score="0.93" weight="15" note="claro" />\n  <dim name="validation" score="0.87" weight="15" note="bom" />\n  <dim name="open_gaps" score="0.90" weight="10" note="sem gaps" />\n  <global score="0.91" gate="proceed" />\n</confidence_vector>\n\n### T1 — Demo\n- **Arquivos prováveis:** `src/demo.ts`\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.implementationPackReady, true);
    assert.strictEqual(report.referenceAnchorsReady, true);
    assert.strictEqual(report.fixturePackReady, true);
    assert.strictEqual(report.executionRationalityReady, true);
    assert.deepStrictEqual(report.criticalExecutionGaps, []);
  });

  test('buildHealthReport keeps rationality non-blocking before PLAN exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-rationality-na-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '## Fase atual\n\n`scan_complete`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.executionRationality.applicable, false);
    assert.strictEqual(report.executionRationalityReady, false);
    assert.deepStrictEqual(report.criticalExecutionGaps, []);
    assert.strictEqual(report.next.step, 'plan');
  });

  test('buildHealthReport falls back to root rationality packs when session-scoped plan artifacts are absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-rationality-session-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    fs.mkdirSync(path.join(oxe, 'sessions', 's001-demo'), { recursive: true });
    for (const f of h.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', f), '# x', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '## Fase atual\n\n`plan_ready`\n\n**active_session:** `sessions/s001-demo`\n\n## Revisão do plano (opcional — dashboard / aprovação)\n\n- **plan_review_status:** `approved`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle="C-01" generated_at="2026-04-22T12:00:00Z">\n  <dim name="requirements" score="0.92" weight="25" note="ok" />\n  <dim name="dependencies" score="0.93" weight="15" note="ok" />\n  <dim name="technical_risk" score="0.90" weight="20" note="controlado" />\n  <dim name="code_impact" score="0.93" weight="15" note="claro" />\n  <dim name="validation" score="0.87" weight="15" note="bom" />\n  <dim name="open_gaps" score="0.90" weight="10" note="sem gaps" />\n  <global score="0.91" gate="proceed" />\n</confidence_vector>\n\n### T1 — Demo\n- **Arquivos prováveis:** `src/demo.ts`\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.activeSession, 'sessions/s001-demo');
    assert.strictEqual(report.executionRationalityReady, true);
    assert.deepStrictEqual(report.criticalExecutionGaps, []);
    assert.strictEqual(path.basename(report.executionRationality.implementationPack.path), 'IMPLEMENTATION-PACK.json');
    assert.ok(report.executionRationality.implementationPack.path.includes(`${path.sep}.oxe${path.sep}`));
  });

  test('buildHealthReport marks package repo mode and suppresses plan-execute blockers without active cycle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-package-report-'));
    seedPackageRepoFixture(dir);
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.workspaceMode, 'product_package');
    assert.strictEqual(report.next.step, 'doctor');
    assert.ok(report.releaseReadiness);
    assert.deepStrictEqual(report.planWarn, []);
    assert.deepStrictEqual(report.reviewWarn, []);
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
    fs.writeFileSync(
      path.join(oxe, 'config.json'),
      JSON.stringify({ runtime: { quotas: { max_work_items_per_run: 1, max_mutations_per_run: 0, max_retries_per_run: 0 } } }),
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`executing`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'ACTIVE-RUN.json'), JSON.stringify({ run_id: 'oxe-run-health', updated_at: '2026-04-11T00:00:00Z' }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'runs', 'oxe-run-health.json'), JSON.stringify({
      run_id: 'oxe-run-health',
      status: 'running',
      current_wave: 1,
      cursor: { wave: 1, task: 'T1' },
      graph: { nodes: [], edges: [] },
      compiled_graph: {
        nodes: {
          T1: { id: 'T1', mutation_scope: ['src/app.ts'], policy: { max_retries: 0 } },
        },
        edges: [],
      },
      canonical_state: {
        attempts: {
          T1: [{ attempt_id: 'a1' }, { attempt_id: 'a2' }],
        },
      },
      delivery: {
        promotion_record: {
          status: 'blocked',
          target_kind: 'branch_push',
          remote: 'origin',
          coverage_percent: 100,
          reasons: ['pending gate'],
        },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'OXE-EVENTS.ndjson'), `${JSON.stringify({ type: 'run_started' })}\n`, 'utf8');
    fs.writeFileSync(path.join(oxe, 'AUDIT-TRAIL.ndjson'), `${JSON.stringify({ action: 'gate_requested', severity: 'warn', run_id: 'oxe-run-health', actor: 'runtime', timestamp: '2026-04-11T00:00:00Z' })}\n`, 'utf8');
    fs.mkdirSync(path.join(oxe, 'execution'), { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'execution', 'GATES.json'),
      JSON.stringify([
        {
          gate_id: 'gate-health-1',
          scope: 'critical_mutation',
          run_id: 'oxe-run-health',
          work_item_id: 'T1',
          action: 'apply_patch',
          requested_at: '2026-04-10T00:00:00Z',
          context: { description: 'approve', evidence_refs: [], risks: ['scope'] },
          status: 'pending',
        },
      ], null, 2),
      'utf8'
    );
    fs.mkdirSync(path.join(oxe, 'runs', 'oxe-run-health'), { recursive: true });
    fs.writeFileSync(
      path.join(oxe, 'runs', 'oxe-run-health', 'multi-agent-state.json'),
      JSON.stringify({
        run_id: 'oxe-run-health',
        mode: 'parallel',
        workspace_isolation_enforced: true,
        agent_results: [{ agent_id: 'agent-a', assigned_task_ids: ['T1'], completed: [], failed: [] }],
        ownership: [{ work_item_id: 'T1', owner_agent_id: 'agent-a' }],
        orphan_reassignments: [],
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'runs', 'oxe-run-health', 'verification-manifest.json'), JSON.stringify({
      summary: { total: 1, pass: 1, fail: 0, skip: 0, error: 0, all_passed: true },
      checks: [{ evidence_refs: ['ev-1'] }],
      profile: 'standard',
    }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'runs', 'oxe-run-health', 'residual-risk-ledger.json'), JSON.stringify({
      risks: [{ severity: 'high' }],
    }), 'utf8');
    fs.writeFileSync(path.join(oxe, 'runs', 'oxe-run-health', 'evidence-coverage.json'), JSON.stringify({
      total_checks: 1,
      checks_with_evidence: 1,
      total_evidence_refs: 1,
      coverage_percent: 100,
    }), 'utf8');
    const report = h.buildHealthReport(dir);
    assert.strictEqual(report.activeRun.run_id, 'oxe-run-health');
    assert.strictEqual(report.eventsSummary.total, 1);
    assert.ok(report.memoryLayers.readOrder.includes('evidence'));
    assert.ok(report.verificationSummary);
    assert.strictEqual(report.verificationSummary.total, 1);
    assert.ok(report.residualRiskSummary);
    assert.strictEqual(report.residualRiskSummary.highOrCritical, 1);
    assert.ok(report.evidenceCoverage);
    assert.strictEqual(report.evidenceCoverage.coverage_percent, 100);
    assert.ok(report.quotaSummary);
    assert.strictEqual(report.quotaSummary.exceeded, true);
    assert.ok(report.auditSummary);
    assert.strictEqual(report.auditSummary.runEntries, 1);
    assert.ok(report.promotionSummary);
    assert.strictEqual(report.promotionSummary.targetKind, 'branch_push');
    assert.ok(report.runtimeMode);
    assert.strictEqual(report.runtimeMode.runtime_mode, 'enterprise');
    assert.strictEqual(report.fallbackMode, 'none');
    assert.ok(report.gateQueue);
    assert.ok(report.pendingGates);
    assert.ok(report.pendingGates.gateSlaHours >= 1);
    assert.ok(report.pendingGates.staleGateCount >= 0);
    assert.ok(report.policyCoverage);
    assert.strictEqual(report.policyCoverage.uncoveredMutations, 1);
    assert.ok(report.promotionReadiness);
    assert.strictEqual(report.promotionReadiness.status, 'blocked');
    assert.ok(report.providerCatalog);
    assert.ok(report.recoveryState);
    assert.ok(Array.isArray(report.recoveryState.issues));
    assert.ok(report.multiAgent);
    assert.strictEqual(report.multiAgent.mode, 'parallel');
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
