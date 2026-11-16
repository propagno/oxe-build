'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
};

const writeFiles = (dir, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
};

describe('OXB-C6 P2 #4: program close (normal & --by-ci) verifies all done tasks landed on main', () => {
  it('blocks close when done tasks are unpromoted on program branch, allows after cherry-pick or --accept-unpromoted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c6-close-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const dir = path.join(root, 'work');
    git(root, ['init', '-q', '--bare', origin]);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);
    writeFiles(dir, {
      '.gitignore': '.oxe/\n',
      '.oxe/STATE.md': '# S\n',
      '.oxe/SPEC.md': '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n',
      '.oxe/ROADMAP.md': '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n',
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false }),
      'src/promoted.ts': 'export const p = 0;\n',
      'src/pending.ts': 'export const u = 0;\n',
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'base']);
    git(dir, ['remote', 'add', 'origin', origin]);
    git(dir, ['push', '-q', 'origin', 'main']);

    git(dir, ['checkout', '-q', '-b', 'oxe/program-f1']);
    writeFiles(dir, { 'src/promoted.ts': 'export const p = 1;\n' });
    git(dir, ['add', 'src/promoted.ts']);
    git(dir, ['commit', '-qm', 'feat: T1 promoted change\n\nOXE-Task: F1/T1']);
    const t1Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, { 'src/pending.ts': 'export const u = 1;\n' });
    git(dir, ['add', 'src/pending.ts']);
    git(dir, ['commit', '-qm', 'feat: T2 NOT promoted yet\n\nOXE-Task: F1/T2']);
    const t2Sha = git(dir, ['rev-parse', 'HEAD']);

    // Land T1 onto main via cherry-pick -x, leaving T2 unpromoted on oxe/program-f1
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['cherry-pick', '-x', t1Sha]);
    git(dir, ['push', '-q', 'origin', 'main']);
    git(dir, ['checkout', '-q', 'oxe/program-f1']);

    writeFiles(dir, {
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F1',
        tasks: [
          { id: 'T1', title: 'promoted task', wave: 1, acceptance: ['A1'], files: ['src/promoted.ts'], done: true, done_commit: t1Sha },
          { id: 'T2', title: 'unpromoted task', wave: 1, acceptance: ['A1'], files: ['src/pending.ts'], done: true, done_commit: t2Sha },
        ],
      }, null, 2),
    });

    op.runtimeProgramInit(dir, null, {});
    op.runtimeProgramStart(dir, null, 'F1');

    const head = git(dir, ['rev-parse', 'HEAD']);
    const ghSpawn = () => ({ status: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'success', headSha: head, url: 'https://x/actions/runs/99' }), stderr: '' });
    require('../bin/lib/oxe-phase-gates.cjs').attachCiRun(path.join(dir, '.oxe', 'program'), { run: '99', phase: 'F1' });

    const blockedByCi = op.runtimeProgramClose(dir, null, {
      phase: 'F1', byCi: true, by: 'tech-lead', reason: 'CI verde na branch', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false, ghSpawn,
    });
    assert.equal(blockedByCi.closed, false);
    const reasonsText = blockedByCi.gate.reasons.join('\n');
    assert.match(reasonsText, /T2/, `expected T2 listed as unpromoted: ${reasonsText}`);
    assert.doesNotMatch(reasonsText, /T1 \(/, 'already promoted T1 must not block');

    // Too-short reason rejected
    assert.throws(() => op.runtimeProgramClose(dir, null, {
      phase: 'F1', byCi: true, by: 'tech-lead', reason: 'CI verde na branch', acceptUnpromoted: 'curto', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false, ghSpawn,
    }), /mínimo 8 caracteres/);

    // Explicit --accept-unpromoted "<motivo>" closes and audits the waiver
    const closedWithWaiver = op.runtimeProgramClose(dir, null, {
      phase: 'F1', byCi: true, by: 'tech-lead', reason: 'CI verde na branch', acceptUnpromoted: 'T2 diferida intencionalmente para o ciclo F2', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false, ghSpawn,
    });
    assert.equal(closedWithWaiver.closed, true, JSON.stringify(closedWithWaiver.gate && closedWithWaiver.gate.reasons));
    assert.deepEqual(closedWithWaiver.unpromoted_accepted.tasks, ['T2']);
    const changes = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
    assert.ok(changes.some((c) => c.kind === 'unpromoted_waiver' && c.tasks.includes('T2')));
  });
});

describe('OXB-C6 P2 #5: promote ratchet cap reconciliation when code removes elements (#907)', () => {
  it('recalculates cap = realCount on final promote branch even when task did not touch ratchet test file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c6-ratchet-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const dir = path.join(root, 'work');
    git(root, ['init', '-q', '--bare', origin]);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);

    const makeBtns = (n) => Array.from({ length: n }, (_, i) => `<button>${i}</button>`).join('');
    writeFiles(dir, {
      '.gitignore': '.oxe/\n',
      'src/Panel.tsx': `export const Panel = () => "${makeBtns(15)}";\n`,
      'src/Keep.tsx': `export const Keep = () => "${makeBtns(5)}";\n`,
      'tests/design-lint.test.ts': 'const RAW_BUTTON_CAP = 20;\n',
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'base']);
    git(dir, ['remote', 'add', 'origin', origin]);
    git(dir, ['push', '-q', 'origin', 'main']);

    git(dir, ['checkout', '-q', '-b', 'oxe/program-f6']);
    // T35 removes 13 buttons in src/Panel.tsx -> realCount drops from 20 to 7 WITHOUT touching tests/design-lint.test.ts
    writeFiles(dir, { 'src/Panel.tsx': `export const Panel = () => "${makeBtns(2)}";\n` });
    git(dir, ['add', 'src/Panel.tsx']);
    git(dir, ['commit', '-qm', 'feat: T35 replaces 13 raw buttons\n\nOXE-Task: F6/T35']);
    const t35Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/STATE.md': '# S\n',
      '.oxe/PLAN.md': '# P\n',
      '.oxe/config.json': JSON.stringify({
        external_dependency_check: false,
        lint: {
          ratchets: [{
            file: 'tests/design-lint.test.ts',
            pattern: 'RAW_BUTTON_CAP = (\\d+)',
            counts: '<button\\b',
            paths: ['src/**/*.tsx'],
            direction: 'down',
          }],
        },
      }, null, 2),
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [
          { id: 'T35', title: 'reduce raw buttons', wave: 1, files: ['src/Panel.tsx'], done: true, done_commit: t35Sha },
        ],
      }, null, 2),
    });

    const out = op.runtimePromote(dir, null, { task: 'T35', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.ratchets_adjusted.length, 1);
    assert.equal(out.ratchets_adjusted[0].promoted_cap, 7, 'cap must reconcile down 20 -> 7 on final promote branch');
    assert.equal(git(dir, ['show', `${out.branch}:tests/design-lint.test.ts`]), 'const RAW_BUTTON_CAP = 7;');
  });
});

describe('OXB-C6 P2 #6: warn when frozen acceptance tests never run on CI (doctor & plan lint)', () => {
  it('warns in plan lint and doctor when playwright.acceptance.config.ts / tests/acceptance/ are not run by scripts or workflows, and clears once wired', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c6-unrun-ci-'));
    dirs.push(dir);
    writeFiles(dir, {
      'package.json': JSON.stringify({
        name: 'c6-ci-check',
        scripts: {
          test: 'vitest run tests/unit',
          e2e: 'playwright test e2e/smoke',
        },
      }, null, 2),
      '.github/workflows/ci.yml': [
        'name: CI',
        'jobs:',
        '  test:',
        '    steps:',
        '      - run: npm test',
        '      - run: npm run e2e',
      ].join('\n') + '\n',
      'playwright.acceptance.config.ts': 'export default { testDir: "./e2e/acceptance" };\n',
      'e2e/acceptance/a1.spec.ts': "import { test } from '@playwright/test'; test('a1', () => {});\n",
      'tests/acceptance/a2.test.ts': "import { it } from 'vitest'; it('a2', () => {});\n",
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false, lint: { suite_impact: 'off' } }, null, 2),
      '.oxe/SPEC.md': '# SPEC\n\n| ID | Critério | Verificação |\n|---|---|---|\n| A1 | a1 | pw |\n| A2 | a2 | vitest |\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T1 — t1\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        acceptance_tests: [
          { criterion: 'A1', task: 'T1', files: ['e2e/acceptance/a1.spec.ts'], command: 'npx playwright test -c playwright.acceptance.config.ts e2e/acceptance/a1.spec.ts' },
          { criterion: 'A2', task: 'T1', files: ['tests/acceptance/a2.test.ts'], command: 'npx vitest run tests/acceptance/a2.test.ts' },
        ],
        tasks: [
          { id: 'T1', title: 't1', wave: 1, acceptance: ['A1', 'A2'], files: ['src/app.ts'], verify: { commands: ['node -e "process.exit(0)"'] } },
        ],
      }, null, 2),
    });

    const lint = op.runtimePlanLint(dir, null, { precheckTests: false });
    assert.ok(lint.unrun_acceptance_ci.some((f) => f.target === 'playwright.acceptance.config.ts'));
    assert.ok(lint.unrun_acceptance_ci.some((f) => f.target === 'tests/acceptance/'));
    assert.ok(lint.warnings.some((w) => w.includes('playwright.acceptance.config.ts') && /CI|workflow/i.test(w)));

    const report = health.buildHealthReport(dir);
    assert.ok(report.planWarn.some((w) => w.includes('playwright.acceptance.config.ts')), `expected doctor planWarn entry: ${report.planWarn.join('\n')}`);

    // Now wire both in package.json + CI workflow -> warnings disappear
    writeFiles(dir, {
      'package.json': JSON.stringify({
        name: 'c6-ci-check',
        scripts: {
          test: 'vitest run tests/unit',
          'test:acc': 'vitest run tests/acceptance',
          'test:e2e:acc': 'playwright test -c playwright.acceptance.config.ts',
        },
      }, null, 2),
      '.github/workflows/ci.yml': [
        'name: CI',
        'jobs:',
        '  test:',
        '    steps:',
        '      - run: npm test',
        '      - run: npm run test:acc',
        '      - run: npm run test:e2e:acc',
      ].join('\n') + '\n',
    });

    const lintWired = op.runtimePlanLint(dir, null, { precheckTests: false });
    assert.deepEqual(lintWired.unrun_acceptance_ci || [], []);
    const reportWired = health.buildHealthReport(dir);
    assert.ok(!reportWired.planWarn.some((w) => w.includes('playwright.acceptance.config.ts')));
  });
});

describe('OXB-C6 P3 #7: G34 exemption for catalog cards whose CAs only read shared/locales/**', () => {
  it('exempts OXE-233 style catalog cards reading shared/locales/**, while keeping G34 active when UI components are also verified', () => {
    const localeOnlyCard = [
      '# OXE-233 — Revisar chaves do catálogo pt-BR/en-US',
      '## Descrição',
      'Textos exibidos no painel `src/components/SettingsModal.tsx`.',
      '## Critérios de aceite',
      '- **CA-1 (A1)** — O catálogo `shared/locales/pt-BR.json` e `shared/locales/en-US.json` possuem todas as chaves novas sem valores vazios · Teste: `npx vitest run tests/unit/locales.test.ts` · Risco: P2',
      '- **CA-2 (A2)** — Nenhuma chave obsoleta permanece em `shared/locales/**` · Teste: `npx vitest run tests/unit/locales.test.ts` · Risco: P2',
    ].join('\n');

    const resExempt = op.uiCardGaps(localeOnlyCard, { labels: ['area-marca'] });
    assert.equal(resExempt.isUi, false);
    assert.deepEqual(resExempt.gaps, []);
    assert.equal(resExempt.locale_only_exempt, true);

    const mixedUiCard = [
      '# OXE-234 — Card de locale que também verifica layout de componente UI',
      '## Critérios de aceite',
      '- **CA-1 (A1)** — Lê `shared/locales/pt-BR.json` e renderiza em `src/components/SettingsModal.tsx` · Teste: manual · Risco: P1',
    ].join('\n');

    const resMixed = op.uiCardGaps(mixedUiCard, { labels: ['area-marca'] });
    assert.equal(resMixed.isUi, true);
    assert.ok(resMixed.gaps.some((g) => /BRD-n/.test(g)));
    assert.ok(resMixed.gaps.some((g) => /quais medidas/.test(g)));
  });
});
