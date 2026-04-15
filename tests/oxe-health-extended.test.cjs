'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const health = require('../bin/lib/oxe-project-health.cjs');
const contextEngine = require('../bin/lib/oxe-context-engine.cjs');

function writeState(dir, phase, scanLine = '') {
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  const body = `## Fase atual\n\n\`${phase}\`\n\n## Último scan\n\n${scanLine}\n`;
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), body, 'utf8');
}

describe('oxe-project-health extended', () => {
  test('loadOxeConfigMerged invalid top-level array', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '[]', 'utf8');
    const r = health.loadOxeConfigMerged(dir);
    assert.strictEqual(r.parseError, 'não é um objeto');
  });

  test('parseLastScanDate placeholder and BR date', () => {
    assert.strictEqual(
      health.parseLastScanDate('## Último scan\n\n**Data:** (placeholder)\n'),
      null
    );
    const d = health.parseLastScanDate('## Último scan\n\n**Data:** 15/03/2024\n');
    assert.ok(d instanceof Date);
  });

  test('parseLastScanDate paren line', () => {
    assert.strictEqual(
      health.parseLastScanDate('## Último scan\n\n**Data:** (use ISO)\n'),
      null
    );
  });

  test('phaseCoherenceWarnings several phases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const p = health.oxePaths(dir);
    fs.mkdirSync(p.codebase, { recursive: true });
    assert.ok(health.phaseCoherenceWarnings('scan_complete', p).length >= 1);
    writeState(dir, 'spec_ready');
    assert.ok(health.phaseCoherenceWarnings('spec_ready', p).length >= 1);
    writeState(dir, 'discuss_complete');
    assert.ok(health.phaseCoherenceWarnings('discuss_complete', p).length >= 1);
    writeState(dir, 'plan_ready');
    assert.ok(health.phaseCoherenceWarnings('plan_ready', p).length >= 1);
    writeState(dir, 'quick_active');
    assert.ok(health.phaseCoherenceWarnings('quick_active', p).length >= 1);
    writeState(dir, 'executing');
    assert.ok(health.phaseCoherenceWarnings('executing', p).length >= 1);
    writeState(dir, 'verify_complete');
    assert.ok(health.phaseCoherenceWarnings('verify_complete', p).length >= 1);
  });

  test('verifyGapsWithoutSummaryWarning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const v = path.join(dir, 'VERIFY.md');
    fs.writeFileSync(v, '## Gaps\n\nalgo relevante aqui', 'utf8');
    const w = health.verifyGapsWithoutSummaryWarning(v, path.join(dir, 'SUMMARY.md'));
    assert.ok(w && w.includes('SUMMARY'));
  });

  test('planWaveWarningsFixed over limit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const plan = path.join(dir, 'PLAN.md');
    fs.writeFileSync(
      plan,
      '**Onda:** 1\n### T1\n**Onda:** 1\n### T2\n**Onda:** 1\n### T3\n',
      'utf8'
    );
    const w = health.planWaveWarningsFixed(plan, 2);
    assert.ok(w.length >= 1);
  });

  test('suggestNextStep verify_failed and gaps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe', 'codebase'), { recursive: true });
    for (const m of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(dir, '.oxe', 'codebase', m), 'x', 'utf8');
    }
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '## S\n', 'utf8');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '## P\n### T1\n**Onda:** 1\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, '.oxe', 'STATE.md'),
      '## Fase atual\n\n`verify_failed`\n',
      'utf8'
    );
    fs.writeFileSync(path.join(dir, '.oxe', 'VERIFY.md'), 'x', 'utf8');
    let n = health.suggestNextStep(dir, {});
    assert.strictEqual(n.step, 'plan');

    fs.writeFileSync(
      path.join(dir, '.oxe', 'STATE.md'),
      '## Fase atual\n\n`executing`\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, '.oxe', 'VERIFY.md'),
      '## Gaps\n\nprecisa corrigir isto mesmo',
      'utf8'
    );
    n = health.suggestNextStep(dir, {});
    assert.strictEqual(n.step, 'plan');

    fs.writeFileSync(
      path.join(dir, '.oxe', 'VERIFY.md'),
      'Verificação falhou.\n## Resultado\n| x | não |\n',
      'utf8'
    );
    n = health.suggestNextStep(dir, {});
    assert.strictEqual(n.step, 'plan');
  });

  test('buildHealthReport with stale scan', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ scan_max_age_days: 1 }),
      'utf8'
    );
    const old = new Date();
    old.setDate(old.getDate() - 5);
    fs.writeFileSync(
      path.join(dir, '.oxe', 'STATE.md'),
      `## Fase atual\n\n\`initial\`\n\n## Último scan\n\n**Data:** ${old.toISOString().slice(0, 10)}\n`,
      'utf8'
    );
    const rep = health.buildHealthReport(dir);
    assert.strictEqual(rep.stale.stale, true);
  });

  test('buildHealthReport with stale compact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'config.json'),
      JSON.stringify({ compact_max_age_days: 1 }),
      'utf8'
    );
    const old = new Date();
    old.setDate(old.getDate() - 10);
    fs.writeFileSync(
      path.join(dir, '.oxe', 'STATE.md'),
      `## Fase atual\n\n\`initial\`\n\n## Último compact (codebase + RESUME)\n\n- **Data:** ${old.toISOString().slice(0, 10)}\n`,
      'utf8'
    );
    const rep = health.buildHealthReport(dir);
    assert.strictEqual(rep.staleCompact.stale, true);
    assert.ok(typeof rep.staleCompact.days === 'number');
  });

  test('validateConfigShape many type errors', () => {
    const { typeErrors } = health.validateConfigShape({
      install: [],
      scan_max_age_days: 'x',
      compact_max_age_days: 'bad',
      plan_max_tasks_per_wave: 'y',
      scan_focus_globs: 'z',
      scan_ignore_globs: 1,
      spec_required_sections: {},
    });
    assert.ok(typeErrors.length >= 5);
    assert.ok(typeErrors.some((e) => /compact_max_age_days/i.test(e)));
  });

  test('buildHealthReport exposes context and semantics summaries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-context-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    for (const mapName of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(codebase, mapName), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`planning`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nPlanejar.\n', 'utf8');
    contextEngine.buildContextPack(dir, { workflow: 'dashboard', write: true });
    const report = health.buildHealthReport(dir);
    assert.ok(report.contextQuality);
    assert.strictEqual(report.contextQuality.primaryWorkflow, 'dashboard');
    assert.ok(report.packFreshness && report.packFreshness.dashboard);
    assert.ok(report.activeSummaryRefs && /context[\\/]summaries[\\/]project\.json$/i.test(report.activeSummaryRefs.project));
    assert.ok(report.semanticsDrift && typeof report.semanticsDrift.ok === 'boolean');
  });
});
