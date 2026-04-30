'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const { isolatedHomeEnv } = require('./isolated-home-env.cjs');
const CODEBASE_MAPS = [
  'OVERVIEW.md',
  'STACK.md',
  'STRUCTURE.md',
  'TESTING.md',
  'INTEGRATIONS.md',
  'CONVENTIONS.md',
  'CONCERNS.md',
];

function parseJsonFromCli(stdout) {
  const text = String(stdout || '').trim();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  });
  assert.notStrictEqual(start, -1, `Saída sem JSON: ${text}`);
  return JSON.parse(lines.slice(start).join('\n'));
}

function seedContextProject(dir, options = {}) {
  const phase = options.phase || 'scan_complete';
  const oxe = path.join(dir, '.oxe');
  const codebase = path.join(oxe, 'codebase');
  fs.mkdirSync(codebase, { recursive: true });
  for (const fileName of CODEBASE_MAPS) {
    fs.writeFileSync(path.join(codebase, fileName), `# ${fileName}\n\nok\n`, 'utf8');
  }
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${phase}\`\n`, 'utf8');
  if (options.spec) fs.writeFileSync(path.join(oxe, 'SPEC.md'), options.spec, 'utf8');
  if (options.plan) fs.writeFileSync(path.join(oxe, 'PLAN.md'), options.plan, 'utf8');
  if (options.runtime) fs.writeFileSync(path.join(oxe, 'EXECUTION-RUNTIME.md'), options.runtime, 'utf8');
  if (options.verify) fs.writeFileSync(path.join(oxe, 'VERIFY.md'), options.verify, 'utf8');
  return { oxe, codebase };
}

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
  fs.writeFileSync(
    path.join(oxeDir, 'FIXTURE-PACK.json'),
    JSON.stringify({ schema_version: '1', generated_at: '2026-04-22T12:00:00Z', ready: true, critical_gaps: [], fixtures: [] }, null, 2),
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
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'recovery-fixture-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'release', 'multi-agent-soak-report.json'), JSON.stringify({ ok: true, results: [] }, null, 2), 'utf8');
}

describe('oxe-cc CLI edge', () => {
  test('install --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /oxe-cc|Instalação/i);
  });

  test('uninstall --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('update --dry-run exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /simulação|npx/i);
  });

  test('update --dry-run forwards install flags', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run', '--cursor', '--ide-local', '--global-cli'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /--cursor/);
    assert.match(r.stdout + r.stderr, /--ide-local/);
    assert.match(r.stdout + r.stderr, /--global-cli/);
  });

  test('capabilities help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'capabilities', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('dashboard help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'dashboard', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('runtime help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'runtime', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /runtime/i);
  });

  test('azure help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'azure', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /azure/i);
  });

  test('doctor missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'doctor', path.join(os.tmpdir(), 'oxe-nope-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('doctor --release --json returns structured blockers without banner noise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-release-json-'));
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--release', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1, r.stderr || r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    assert.strictEqual(payload.status, 'blocked');
    assert.ok(Array.isArray(payload.blockers));
    assert.ok(payload.blockers.length >= 1);
  });

  test('status missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'status', path.join(os.tmpdir(), 'oxe-nope2-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status --json prints valid JSON with nextStep', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-json-'));
    seedContextProject(dir, { phase: 'scan_complete' });
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    assert.strictEqual(j.oxeStatusSchema, 5);
    assert.ok(typeof j.healthStatus === 'string');
    assert.ok(typeof j.nextStep === 'string');
    assert.ok(Array.isArray(j.artifacts));
    assert.ok(j.contextPacks && typeof j.contextPacks === 'object');
    assert.ok(j.contextQuality && typeof j.contextQuality === 'object');
    assert.ok(j.semanticsDrift && typeof j.semanticsDrift === 'object');
    assert.ok(j.packFreshness && typeof j.packFreshness === 'object');
    assert.ok(j.activeSummaryRefs && typeof j.activeSummaryRefs === 'object');
    assert.ok(j.pendingGates && typeof j.pendingGates === 'object');
    assert.ok('verificationSummary' in j);
    assert.ok('residualRiskSummary' in j);
    assert.ok('evidenceCoverage' in j);
    assert.ok('policyDecisionSummary' in j);
    assert.ok('quotaSummary' in j);
    assert.ok('auditSummary' in j);
    assert.ok('promotionSummary' in j);
    assert.ok('runtimeMode' in j);
    assert.ok('fallbackMode' in j);
    assert.ok('gateQueue' in j);
    assert.ok('policyCoverage' in j);
    assert.ok('promotionReadiness' in j);
    assert.ok('recoveryState' in j);
    assert.ok('providerCatalog' in j);
    assert.ok('gateSla' in j);
    assert.ok('staleGateCount' in j);
    assert.ok('multiAgent' in j);
    assert.ok('implementationPackReady' in j);
    assert.ok('referenceAnchorsReady' in j);
    assert.ok('fixturePackReady' in j);
    assert.ok('executionRationalityReady' in j);
    assert.ok(Array.isArray(j.criticalExecutionGaps));
    assert.ok(j.executionRationality && typeof j.executionRationality === 'object');
    assert.ok(j.diagnostics && typeof j.diagnostics === 'object');
    assert.ok(Array.isArray(j.diagnostics.planWarnings));
    assert.ok(Array.isArray(j.diagnostics.enterpriseWarnings));
    assert.ok(j.staleCompact && typeof j.staleCompact.stale === 'boolean');
  });

  test('status --json suggests /oxe for fresh workspace without spec or codebase maps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-fresh-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '## Fase atual\n\n`initial`\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.nextStep, 'oxe');
    assert.strictEqual(j.cursorCmd, '/oxe');
  });

  test('status --json exposes package repo mode and release readiness without plan noise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-package-'));
    seedPackageRepoFixture(dir);
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.workspaceMode, 'product_package');
    assert.strictEqual(j.nextStep, 'doctor');
    assert.ok(j.releaseReadiness && typeof j.releaseReadiness === 'object');
    assert.deepStrictEqual(j.diagnostics.planWarnings, []);
  });

  test('context inspect resolves on demand without materializing pack files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-context-inspect-'));
    const { oxe } = seedContextProject(dir, {
      phase: 'planning',
      spec: '# SPEC\n\n## Objetivo\n\nPlanejar mudança.\n',
    });
    const packPath = path.join(oxe, 'context', 'packs', 'plan.json');
    const r = spawnSync(process.execPath, [CLI, 'context', 'inspect', '--workflow', 'plan', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const pack = parseJsonFromCli(r.stdout);
    assert.strictEqual(pack.workflow, 'plan');
    assert.strictEqual(pack.context_tier, 'standard');
    assert.ok(pack.contract && pack.contract.workflow_slug === 'plan');
    assert.ok(pack.context_quality && typeof pack.context_quality.score === 'number');
    assert.strictEqual(fs.existsSync(packPath), false, 'inspect não deve materializar pack por padrão');
  });

  test('context build materializes structured pack files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-context-build-'));
    const { oxe } = seedContextProject(dir, {
      phase: 'planning',
      spec: '# SPEC\n\n## Objetivo\n\nPlanejar mudança.\n',
      plan: '# PLAN\n\n## Objetivo\n\nExecutar mudança.\n',
      runtime: '# EXECUTION-RUNTIME\n\n- estado inicial\n',
    });
    const r = spawnSync(process.execPath, [CLI, 'context', 'build', '--workflow', 'execute', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const pack = parseJsonFromCli(r.stdout);
    assert.strictEqual(pack.workflow, 'execute');
    const packPath = path.join(oxe, 'context', 'packs', 'execute.json');
    const packMdPath = path.join(oxe, 'context', 'packs', 'execute.md');
    assert.strictEqual(fs.existsSync(packPath), true);
    assert.strictEqual(fs.existsSync(packMdPath), true);
    const stored = JSON.parse(fs.readFileSync(packPath, 'utf8'));
    assert.strictEqual(stored.workflow, 'execute');
    assert.ok(Array.isArray(stored.read_order));
    assert.ok(stored.selected_artifacts.some((artifact) => artifact.alias === 'state'));
    assert.ok(stored.selected_artifacts.some((artifact) => artifact.alias === 'plan'));
    assert.ok(stored.selected_artifacts.some((artifact) => artifact.alias === 'implementation_pack_json'));
    assert.ok(stored.selected_artifacts.some((artifact) => artifact.alias === 'reference_anchors'));
    assert.ok(stored.selected_artifacts.some((artifact) => artifact.alias === 'fixture_pack_json'));
  });

  test('status --json exposes Copilot workspace-vs-legacy diagnostics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-copilot-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-copilot-home-'));
    const env = isolatedHomeEnv(fakeHome);
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`scan_complete`\n', 'utf8');
    fs.mkdirSync(path.join(fakeHome, '.copilot', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.copilot', 'prompts', 'oxe-scan.prompt.md'), 'legacy\n', 'utf8');
    fs.writeFileSync(
      path.join(fakeHome, '.copilot', 'copilot-instructions.md'),
      '<!-- oxe-cc:install-begin -->\nlegacy\n<!-- oxe-cc:install-end -->\n',
      'utf8'
    );

    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.copilot.promptSource, 'legacy_global');
    assert.ok(Array.isArray(j.diagnostics.copilotWarnings));
    assert.ok(j.diagnostics.copilotWarnings.some((x) => /legado global/i.test(x)));
  });

  test('status --json exposes Codex prompts and skills diagnostics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-codex-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-codex-home-'));
    const env = isolatedHomeEnv(fakeHome);
    seedContextProject(dir);
    const codexPrompts = path.join(fakeHome, '.codex', 'prompts');
    const codexSkill = path.join(fakeHome, '.agents', 'skills', 'oxe');
    fs.mkdirSync(codexPrompts, { recursive: true });
    fs.mkdirSync(codexSkill, { recursive: true });
    fs.writeFileSync(path.join(codexPrompts, 'oxe.md'), '---\ndescription: OXE\n---\n<!-- oxe-cc managed -->\n', 'utf8');
    fs.writeFileSync(path.join(codexSkill, 'SKILL.md'), '---\nname: oxe\n---\n<!-- oxe-cc managed -->\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.codex.commandsReady, true);
    assert.strictEqual(j.codex.skillsReady, true);
    assert.ok(Array.isArray(j.diagnostics.codexWarnings));
  });

  test('status --json marks Codex as global-only when only user-wide installation exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-codex-global-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-codex-global-home-'));
    const env = isolatedHomeEnv(fakeHome);
    seedContextProject(dir);
    const codexPrompts = path.join(fakeHome, '.codex', 'prompts');
    const codexSkill = path.join(fakeHome, '.agents', 'skills', 'oxe');
    fs.mkdirSync(codexPrompts, { recursive: true });
    fs.mkdirSync(codexSkill, { recursive: true });
    fs.writeFileSync(path.join(codexPrompts, 'oxe.md'), '---\ndescription: OXE\n---\n<!-- oxe-cc managed -->\n', 'utf8');
    fs.writeFileSync(path.join(codexSkill, 'SKILL.md'), '---\nname: oxe\n---\n<!-- oxe-cc managed -->\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.codex.promptSource, 'global');
    assert.ok(j.diagnostics.codexWarnings.some((warning) => /apenas no ambiente global/i.test(warning)));
  });

  test('status warns when PLAN.md misses autoavaliação and suggests replan on low confidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-plan-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '## Critérios de aceite\n\n| ID | Critério | Como verificar |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.healthStatus, 'warning');
    assert.ok(j.diagnostics.planWarnings.some((x) => /Autoavaliação do Plano/i.test(x)));

    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 60%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 8/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 7/15\n  - Lacunas externas / decisões pendentes: 3/10\n- **Principais incertezas:** integração\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.80\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.80\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.40\" weight=\"20\" note=\"integração\" />\n  <dim name=\"code_impact\" score=\"0.67\" weight=\"15\" note=\"moderado\" />\n  <dim name=\"validation\" score=\"0.47\" weight=\"15\" note=\"baixa clareza\" />\n  <dim name=\"open_gaps\" score=\"0.30\" weight=\"10\" note=\"gaps externos\" />\n  <global score=\"0.60\" gate=\"refine_first\" />\n</confidence_vector>\n\n## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    const r2 = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r2.status, 0, r2.stderr || r2.stdout);
    const j2 = JSON.parse(r2.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j2.nextStep, 'plan');
    assert.strictEqual(j2.planSelfEvaluation.confidence, 60);
    assert.ok(j2.diagnostics.planWarnings.some((x) => /não supera o limiar executável/i.test(x)));
  });

  test('status suggests dashboard when plan is executable but review is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-dash-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '## Critérios de aceite\n\n| ID | Critério | Como verificar |\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 91%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 18/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.90\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.91\" gate=\"proceed\" />\n</confidence_vector>\n\n## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    writeRationalityPacks(oxe, ['T1']);
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.nextStep, 'dashboard');
    assert.strictEqual(j.cursorCmd, '/oxe-dashboard');
    assert.ok(j.diagnostics.reviewWarnings.some((x) => /plan_review_status/i.test(x)));
  });

  test('status keeps nextStep in plan when confidence is exactly 90%', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-90-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of CODEBASE_MAPS) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '## Critérios de aceite\n\n| ID | Critério | Como verificar |\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 90%\n- **Base da confiança:**\n  - Completude dos requisitos: 23/25\n  - Dependências conhecidas: 14/15\n  - Risco técnico: 17/20\n  - Impacto no código existente: 14/15\n  - Clareza da validação / testes: 13/15\n  - Lacunas externas / decisões pendentes: 9/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n<confidence_vector cycle=\"C-01\" generated_at=\"2026-04-22T12:00:00Z\">\n  <dim name=\"requirements\" score=\"0.92\" weight=\"25\" note=\"ok\" />\n  <dim name=\"dependencies\" score=\"0.93\" weight=\"15\" note=\"ok\" />\n  <dim name=\"technical_risk\" score=\"0.85\" weight=\"20\" note=\"controlado\" />\n  <dim name=\"code_impact\" score=\"0.93\" weight=\"15\" note=\"claro\" />\n  <dim name=\"validation\" score=\"0.87\" weight=\"15\" note=\"bom\" />\n  <dim name=\"open_gaps\" score=\"0.90\" weight=\"10\" note=\"sem gaps\" />\n  <global score=\"0.90\" gate=\"refine_first\" />\n</confidence_vector>\n\n## Tarefas\n\n### T1 — Demo\n- **Aceite vinculado:** A1\n',
      'utf8'
    );
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    assert.strictEqual(j.nextStep, 'plan');
    assert.strictEqual(j.planConfidenceThreshold, 90);
    assert.strictEqual(j.planConfidenceExecutable, false);
    assert.ok(j.diagnostics.planWarnings.some((x) => />90%/.test(x)));
  });

  test('status --json --hints includes hints array', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-hints-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const f of [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ]) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(
      path.join(oxe, 'config.json'),
      JSON.stringify({ scan_max_age_days: 1, compact_max_age_days: 1 }),
      'utf8'
    );
    const old = new Date();
    old.setDate(old.getDate() - 9);
    const iso = old.toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(oxe, 'STATE.md'),
      `## Fase atual\n\n\`scan_complete\`\n\n## Último scan\n\n**Data:** ${iso}\n\n## Último compact (codebase + RESUME)\n\n- **Data:** ${iso}\n`,
      'utf8'
    );
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--hints', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    assert.ok(Array.isArray(j.hints));
    assert.ok(j.hints.length >= 1);
    assert.ok(j.hints.some((/** @type {string} */ x) => /oxe-scan|oxe-compact/i.test(x)));
  });

  test('runtime lifecycle commands persist ACTIVE-RUN and trace events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-runtime-'));
    const env = { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' };

    const start = spawnSync(process.execPath, [CLI, 'runtime', 'start', '--dir', dir, '--wave', '2', '--task', 'T3', '--reason', 'iniciar onda 2'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(start.status, 0, start.stderr + start.stdout);
    assert.match(start.stdout, /Runtime atualizado/i);

    const activeRunRef = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'ACTIVE-RUN.json'), 'utf8'));
    const runFile = path.join(dir, '.oxe', 'runs', `${activeRunRef.run_id}.json`);
    let runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(runState.status, 'running');
    assert.strictEqual(runState.current_wave, 2);
    assert.strictEqual(runState.cursor.task, 'T3');

    const pause = spawnSync(process.execPath, [CLI, 'runtime', 'pause', '--dir', dir, '--reason', 'aguardando aprovação'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(pause.status, 0, pause.stderr + pause.stdout);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(runState.status, 'paused');

    const resume = spawnSync(process.execPath, [CLI, 'runtime', 'resume', '--dir', dir, '--reason', 'aprovação recebida'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(resume.status, 0, resume.stderr + resume.stdout);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(runState.status, 'running');

    const replay = spawnSync(process.execPath, [CLI, 'runtime', 'replay', '--dir', dir, '--wave', '3', '--task', 'T7', '--reason', 'reprocessar onda 3'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(replay.status, 0, replay.stderr + replay.stdout);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.strictEqual(runState.status, 'replaying');
    assert.strictEqual(runState.current_wave, 3);
    assert.strictEqual(runState.cursor.task, 'T7');
    assert.ok(Array.isArray(runState.graph.nodes));
    assert.ok(Array.isArray(runState.graph.edges));

    const eventsPath = path.join(dir, '.oxe', 'OXE-EVENTS.ndjson');
    const events = fs.readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'run_started'));
    assert.ok(events.some((event) => event.type === 'run_paused'));
    assert.ok(events.some((event) => event.type === 'run_resumed'));
    assert.ok(events.some((event) => event.type === 'run_replay_requested'));
  });

  test('runtime compile, project and ci integrate the TypeScript runtime package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-runtime-compile-'));
    const env = { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' };
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(oxe, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# runtime fixture\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'SPEC.md'),
      '# OXE — Spec\n\n## Objetivo\n\nCompilar runtime.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|----|----------|----------------|\n| A1 | Runtime compilado | node --test |\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — Demo\n**Onda:** 1\n**Depende de:** —\n**Verificar:**\n- Comando: `node --test`\n**Aceite vinculado:** A1\n',
      'utf8'
    );
    let git = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr + git.stdout);
    git = spawnSync('git', ['config', 'user.email', 'oxe@test.local'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr + git.stdout);
    git = spawnSync('git', ['config', 'user.name', 'OXE Test'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr + git.stdout);
    git = spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr + git.stdout);
    git = spawnSync('git', ['commit', '-m', 'init runtime fixture'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr + git.stdout);

    const compiled = spawnSync(process.execPath, [CLI, 'runtime', 'compile', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(compiled.status, 0, compiled.stderr + compiled.stdout);
    assert.match(compiled.stdout, /Runtime compilado/i);

    const activeRunRef = JSON.parse(fs.readFileSync(path.join(oxe, 'ACTIVE-RUN.json'), 'utf8'));
    const runFile = path.join(oxe, 'runs', `${activeRunRef.run_id}.json`);
    let runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.ok(runState.compiled_graph);
    assert.ok(runState.verification_suite);
    assert.ok(runState.canonical_state);

    const verified = spawnSync(process.execPath, [CLI, 'runtime', 'verify', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(verified.status, 0, verified.stderr + verified.stdout);
    const verifiedPayload = parseJsonFromCli(verified.stdout);
    assert.ok(verifiedPayload.manifest || verifiedPayload.summary || verifiedPayload.run);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.ok(runState.verification_manifest);
    assert.ok(runState.residual_risks);
    assert.ok(runState.verification_evidence_coverage);
    assert.ok(fs.existsSync(path.join(oxe, 'runs', activeRunRef.run_id, 'verification-manifest.json')));
    assert.ok(fs.existsSync(path.join(oxe, 'runs', activeRunRef.run_id, 'residual-risk-ledger.json')));
    assert.ok(fs.existsSync(path.join(oxe, 'runs', activeRunRef.run_id, 'evidence-coverage.json')));

    const runtimeStatus = spawnSync(process.execPath, [CLI, 'runtime', 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(runtimeStatus.status, 0, runtimeStatus.stderr + runtimeStatus.stdout);
    const runtimeStatusPayload = parseJsonFromCli(runtimeStatus.stdout);
    assert.strictEqual(runtimeStatusPayload.runtimeMode.runtime_mode, 'enterprise');
    assert.ok(runtimeStatusPayload.gateQueue);
    assert.ok(runtimeStatusPayload.providerCatalog);

    const gatesDir = path.join(oxe, 'execution');
    fs.mkdirSync(gatesDir, { recursive: true });
    const gateId = 'gate-enterprise-1';
    fs.writeFileSync(
      path.join(gatesDir, 'GATES.json'),
      JSON.stringify([
        {
          gate_id: gateId,
          scope: 'critical_mutation',
          run_id: activeRunRef.run_id,
          work_item_id: 'T1',
          action: 'apply_patch',
          requested_at: new Date().toISOString(),
          context: { description: 'Approve mutation', evidence_refs: [], risks: ['scope'], rationale: null, policy_decision_id: null },
          status: 'pending',
        },
      ], null, 2),
      'utf8'
    );
    const gatesList = spawnSync(process.execPath, [CLI, 'runtime', 'gates', 'list', '--status', 'pending', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(gatesList.status, 0, gatesList.stderr + gatesList.stdout);
    const gatesListPayload = parseJsonFromCli(gatesList.stdout);
    assert.strictEqual(gatesListPayload.pending.length, 1);
    assert.strictEqual(gatesListPayload.filters.status, 'pending');
    const gateShow = spawnSync(process.execPath, [CLI, 'runtime', 'gates', 'show', '--gate', gateId, '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(gateShow.status, 0, gateShow.stderr + gateShow.stdout);
    const gate = parseJsonFromCli(gateShow.stdout);
    assert.strictEqual(gate.gate_id, gateId);
    const gateResolve = spawnSync(
        process.execPath,
        [CLI, 'runtime', 'gates', 'resolve', '--gate', gateId, '--decision', 'approve', '--actor', 'qa', '--json', '--dir', dir],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env,
        }
      );
    assert.strictEqual(gateResolve.status, 0, gateResolve.stderr + gateResolve.stdout);
    const gateResolvePayload = parseJsonFromCli(gateResolve.stdout);
    assert.strictEqual(gateResolvePayload.gate.status, 'resolved');
    assert.strictEqual(gateResolvePayload.impact.pendingRemaining, 0);

    const projected = spawnSync(process.execPath, [CLI, 'runtime', 'project', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(projected.status, 0, projected.stderr + projected.stdout);
    assert.match(projected.stdout, /Projeções geradas/i);
    assert.ok(fs.existsSync(path.join(oxe, 'STATE.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'VERIFY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'RUN-SUMMARY.md')));
    assert.ok(fs.existsSync(path.join(oxe, 'PR-SUMMARY.md')));

    const promoted = spawnSync(process.execPath, [CLI, 'runtime', 'promote', '--target', 'pr_draft', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(promoted.status, 0, promoted.stderr + promoted.stdout);
    const promotionPayload = parseJsonFromCli(promoted.stdout);
    assert.ok(promotionPayload && typeof promotionPayload === 'object');
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.ok(runState.delivery && runState.delivery.promotion_record);
    assert.strictEqual(runState.delivery.promotion_record.target_kind, 'pr_draft');

    fs.writeFileSync(
      path.join(oxe, 'runs', activeRunRef.run_id, 'multi-agent-state.json'),
      JSON.stringify({
        run_id: activeRunRef.run_id,
        mode: 'parallel',
        workspace_isolation_enforced: true,
        agent_results: [{ agent_id: 'agent-a', assigned_task_ids: ['T1'], completed: [], failed: [] }],
        ownership: [{ work_item_id: 'T1', agent_id: 'agent-a' }],
        orphan_reassignments: [],
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(oxe, 'runs', activeRunRef.run_id, 'handoffs.json'), JSON.stringify([{ handoff_id: 'h1' }], null, 2), 'utf8');
    fs.writeFileSync(path.join(oxe, 'runs', activeRunRef.run_id, 'arbitration-results.json'), JSON.stringify([{ work_item_id: 'T1' }], null, 2), 'utf8');
    const agentsStatus = spawnSync(process.execPath, [CLI, 'runtime', 'agents', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(agentsStatus.status, 0, agentsStatus.stderr + agentsStatus.stdout);
    const agentsPayload = parseJsonFromCli(agentsStatus.stdout);
    assert.strictEqual(agentsPayload.enabled, true);
    assert.strictEqual(agentsPayload.mode, 'parallel');

    fs.writeFileSync(
      path.join(oxe, 'runs', activeRunRef.run_id, 'journal.json'),
      JSON.stringify({
        run_id: activeRunRef.run_id,
        paused_at: new Date().toISOString(),
        cancelled: false,
        eligible_work_items: ['T1'],
        completed_work_items: [],
        failed_work_items: [],
        blocked_work_items: [],
        pending_gates: [],
        replay_cursor: null,
        scheduler_state: 'paused',
        partial_result: { run_id: activeRunRef.run_id, completed: [], failed: [], blocked: [] },
      }, null, 2),
      'utf8'
    );
    const replayStructured = spawnSync(process.execPath, [CLI, 'runtime', 'replay', '--json', '--run', activeRunRef.run_id, '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(replayStructured.status, 0, replayStructured.stderr + replayStructured.stdout);
    const replayPayload = parseJsonFromCli(replayStructured.stdout);
    assert.strictEqual(replayPayload.run_id, activeRunRef.run_id);
    assert.ok(replayPayload.gateQueue);

    const recovered = spawnSync(process.execPath, [CLI, 'runtime', 'recover', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(recovered.status, 0, recovered.stderr + recovered.stdout);
    const recoverPayload = parseJsonFromCli(recovered.stdout);
    assert.ok(recoverPayload.recoverySummary);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.ok(runState.recovery_summary);
    assert.ok(fs.existsSync(path.join(oxe, 'RECOVERY-SUMMARY.md')));

    const ci = spawnSync(process.execPath, [CLI, 'runtime', 'ci', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(ci.status, 0, ci.stderr + ci.stdout);
    const ciPayload = parseJsonFromCli(ci.stdout);
    assert.ok(ciPayload.summary.total >= 1);
    runState = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    assert.ok(runState.ci_checks);
    assert.ok(runState.ci_checks.summary.total >= 1);

    const statusJson = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(statusJson.status, 0, statusJson.stderr + statusJson.stdout);
    const statusPayload = parseJsonFromCli(statusJson.stdout);
    assert.strictEqual(statusPayload.runtimeMode.runtime_mode, 'enterprise');
    assert.strictEqual(statusPayload.fallbackMode, 'none');
    assert.ok(statusPayload.policyCoverage.coveragePercent >= 0);
    assert.ok(statusPayload.promotionReadiness);
    assert.ok(statusPayload.recoveryState);
    assert.ok(statusPayload.providerCatalog);
    assert.ok('gateSla' in statusPayload);
    assert.ok('staleGateCount' in statusPayload);
    assert.ok('multiAgent' in statusPayload);
  });

  test('init-oxe exits 1 when target path does not exist without dry-run', () => {
    const missing = path.join(os.tmpdir(), `oxe-init-miss-${Date.now()}`);
    assert.ok(!fs.existsSync(missing));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', missing], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /não encontrado/i);
  });

  test('init-oxe --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-init-'));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', '--dry-run', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('init-oxe bootstraps active run and trace artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-init-op-'));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'ACTIVE-RUN.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'runs')));
  });

  test('--config-dir with --all-agents exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--all-agents', '--config-dir', fakeHome, '--oxe-only', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
  });

  test('uninstall --ide-local with --config-dir exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd2-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h2-'));
    const r = spawnSync(
      process.execPath,
      [CLI, 'uninstall', '--ide-local', '--config-dir', fakeHome, '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /config-dir|ide-local/i);
  });

  test('uninstall unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('uninstall --global-cli calls npm uninstall -g', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-uninst-g-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-hg-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-npm-g-'));
    const marker = path.join(fakeBin, 'npm-global-uninstall.txt');
    const npmCli = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(
      npmCli,
      `'use strict';\nconst fs = require('fs');\nconst path = require('path');\nif (process.argv[2] === 'uninstall' && process.argv[3] === '-g') { fs.writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '), 'utf8'); process.exit(0); }\nif (process.argv[2] === 'root' && process.argv[3] === '-g') { console.log(path.join(process.cwd(), 'fake-global-root')); process.exit(0); }\nprocess.exit(0);\n`,
      'utf8'
    );
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), `@node "${npmCli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(fakeBin, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\nrequire(${JSON.stringify(npmCli.replace(/\\/g, '\\\\'))});\n`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--global-cli', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...isolatedHomeEnv(fakeHome), PATH: fakeBin + path.delimiter + process.env.PATH },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(marker), 'npm uninstall -g deveria ter sido chamado');
    assert.match(fs.readFileSync(marker, 'utf8'), /uninstall -g oxe-cc/);
  });

  test('update unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check --dry-run exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /inválid|check|dry-run/i);
  });

  test('update --check --if-newer exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--if-newer'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-skip-'));
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer sai 0 sem npx quando npm latest é mais antigo', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-if-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-npm-cli-'));
    const body = `'use strict';
const v = process.env.OXE_TEST_FAKE_NPM_VERSION || '0.0.1';
if (process.argv.includes('view')) { console.log(v); process.exit(0); }
process.exit(1);
`;
    const npmCli = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(npmCli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), `@node "${npmCli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(fakeBin, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const pathEnv = fakeBin + path.delimiter + process.env.PATH;
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        OXE_NO_BANNER: '1',
        PATH: pathEnv,
        OXE_TEST_FAKE_NPM_VERSION: '0.0.1',
      },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Nenhuma versão mais nova|npm latest/i);
  });

  test('install --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dr-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(process.execPath, [CLI, '--dry-run', '--oxe-only', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fakeHome),
    });
    assert.strictEqual(r.status, 0);
  });

  test('capabilities install/list/update/remove manage local capability catalog', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cap-'));
    let r = spawnSync(process.execPath, [CLI, 'capabilities', 'install', 'sample-http', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cap-home-'))),
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'capabilities', 'sample-http', 'CAPABILITY.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'CAPABILITIES.md')));
    const indexText = fs.readFileSync(path.join(dir, '.oxe', 'CAPABILITIES.md'), 'utf8');
    assert.match(indexText, /sample-http/);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'list', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /sample-http/);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'update', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);

    r = spawnSync(process.execPath, [CLI, 'capabilities', 'remove', 'sample-http', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'capabilities', 'sample-http')));
  });
});
