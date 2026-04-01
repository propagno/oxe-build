'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('../bin/lib/oxe-project-health.cjs');

describe('oxe-project-health', () => {
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
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(
      path.join(oxe, 'PLAN.md'),
      '## Tarefas\n\n### T1 — x\n- **Onda:** 1\n',
      'utf8'
    );
    const r = h.buildHealthReport(dir);
    assert.ok(r.planWarn.some((x) => /T1.*Aceite vinculado/i.test(x)));
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
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# S\n## Critérios de aceite\n| A1 | x | y |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '### T1\n- **Onda:** 1\n', 'utf8');
    const s = h.suggestNextStep(dir, { discuss_before_plan: false });
    assert.strictEqual(s.step, 'execute');
  });
});
