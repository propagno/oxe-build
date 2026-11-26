'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRules = require('../bin/lib/oxe-repo-rules.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const domHooks = require('../bin/lib/oxe-dom-hooks.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix = 'oxe-shift-left-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function initGitRepo(files) {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@oxe.local']);
  git(dir, ['config', 'user.name', 'Oxe Test']);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

describe('1.21.2 shift-left contracts: repo_rules, plan lint & node prompt DOM lessons', () => {
  it('collectRepoRules surfaces generated_files rules in .oxe/config.json and respects repo_rules.disabled', () => {
    const dir = tmpDir();
    const config = {
      generated_files: [
        {
          file: 'mobile/android/**/strings.xml',
          source: 'shared/locales/*/mobile.json',
          generator: 'npm run i18n:gen',
          test: 'tests/i18n-sync.test.ts',
        },
      ],
    };
    const collected = repoRules.collectRepoRules(dir, { config });
    assert.equal(collected.length, 1);
    assert.equal(collected[0].source, '.oxe/config.json');
    assert.match(collected[0].text, /Nunca edite manualmente o arquivo gerado mobile\/android\/\*\*\/strings\.xml/);
    assert.match(collected[0].text, /shared\/locales\/\*\/mobile\.json/);
    assert.match(collected[0].text, /npm run i18n:gen/);
    assert.match(collected[0].text, /tests\/i18n-sync\.test\.ts/);
    assert.match(collected[0].text, /\[generated_files\]$/);

    assert.deepEqual(
      repoRules.collectRepoRules(dir, { config: { ...config, repo_rules: { disabled: true } } }),
      [],
    );
  });

  it('plan lint warns before execute when a task touches a generated file without source in files or dependsOn, or without generator test', () => {
    const config = {
      generated_files: [
        {
          file: 'mobile/android/**/strings.xml',
          source: 'shared/locales/*/mobile.json',
          generator: 'npm run i18n:gen',
          test: 'tests/i18n-sync.test.ts',
        },
      ],
    };

    // Case 1: T1 touches strings.xml without source and without generator test -> 2 warnings
    const bad = planJson.lintPlan({
      config,
      plan: {
        tasks: [
          {
            id: 'T1',
            wave: 1,
            files: ['mobile/android/app/src/main/res/values/strings.xml'],
            verifyCommand: 'npx vitest run tests/unrelated.test.ts',
            aceite: ['A1'],
          },
        ],
        acceptanceTests: [{ criterion: 'A1', files: ['tests/a1.test.ts'], command: 'npx vitest run tests/a1.test.ts' }],
      },
    });
    assert.equal(bad.ok, true);
    assert.ok(
      bad.warnings.some((w) => w.includes('T1:') && w.includes('scope_insufficient') && w.includes('shared/locales/*/mobile.json')),
      `expected scope_insufficient warning, got: ${bad.warnings.join(' | ')}`,
    );
    assert.ok(
      bad.warnings.some((w) => w.includes('T1:') && w.includes('tests/i18n-sync.test.ts')),
      `expected generator test warning, got: ${bad.warnings.join(' | ')}`,
    );

    // Case 2: T1 (even already done) owns source in wave 1, T2 dependsOn T1 and runs generator + generator test -> 0 generated_files warnings
    const viaDep = planJson.lintPlan({
      config,
      plan: {
        tasks: [
          {
            id: 'T1',
            wave: 1,
            done: true,
            files: ['shared/locales/pt-BR/mobile.json'],
            verifyCommand: 'node -e 1',
            aceite: ['A1'],
          },
          {
            id: 'T2',
            wave: 2,
            dependsOn: ['T1'],
            files: ['mobile/android/app/src/main/res/values/strings.xml'],
            verifyCommand: 'npx vitest run tests/i18n-sync.test.ts',
            aceite: ['A1'],
          },
        ],
        acceptanceTests: [{ criterion: 'A1', files: ['tests/a1.test.ts'], command: 'npx vitest run tests/a1.test.ts' }],
      },
    });
    assert.equal(
      viaDep.warnings.some((w) => w.includes('arquivo gerado')),
      false,
      `unexpected generated_files warnings: ${viaDep.warnings.join(' | ')}`,
    );

    // Case 3: directory in task.files ("shared/locales/") also covers source
    const viaDir = planJson.lintPlan({
      config,
      plan: {
        tasks: [
          {
            id: 'T1',
            wave: 1,
            files: ['shared/locales/', 'shared/locales/en/mobile.json', 'mobile/android/app/src/main/res/values/strings.xml'],
            verifyCommand: 'npx vitest run tests/i18n-sync.test.ts',
            aceite: ['A1'],
          },
        ],
        acceptanceTests: [{ criterion: 'A1', files: ['tests/a1.test.ts'], command: 'npx vitest run tests/a1.test.ts' }],
      },
    });
    assert.equal(
      viaDir.warnings.some((w) => w.includes('arquivo gerado')),
      false,
      `unexpected generated_files warnings: ${viaDir.warnings.join(' | ')}`,
    );
  });

  it('hooksReadInFiles & buildNodeContextProvider surface active test-read DOM/aria hooks before Attempt 1 (even past line 40)', () => {
    // Non-UI scope in a plain non-git dir: 0 git calls, returns []
    const plain = tmpDir();
    assert.deepEqual(domHooks.hooksReadInFiles(plain, ['src/backend/service.ts']), []);
    assert.equal(domHooks.activeHooksLesson(plain, ['src/backend/service.ts']), null);

    // Pad 55 header lines so markup sits well past snapshotWorkspaceFile's 40-line head preview
    const pad = Array.from({ length: 55 }, (_, i) => `// header line ${i + 1}`).join('\n');
    const dir = initGitRepo({
      '.oxe/config.json': JSON.stringify({
        checkpoint_dom_hooks: { locale: 'shared/locales/en/common.json' },
        generated_files: [
          {
            file: 'mobile/android/**/strings.xml',
            source: 'shared/locales/*/mobile.json',
            generator: 'npm run i18n:gen',
          },
        ],
      }, null, 2),
      '.oxe/PLAN.md': '# Plan\n\n### T1: CommandBar\n',
      '.oxe/PLAN.json': JSON.stringify({
        tasks: [{ id: 'T1', wave: 1, files: ['src/CommandMenu.tsx'], verifyCommand: 'node -e 1' }],
      }, null, 2),
      'shared/locales/en/common.json': JSON.stringify({
        search: { clear: 'Clear search' },
        common: { search: 'Search' },
      }, null, 2),
      'src/CommandMenu.tsx': [
        pad,
        'export function CommandMenu({ id, t }: any) {',
        '  return (',
        '    <div cmdk-root data-ui="command-menu" data-testid="menu-unused">',
        '      <nav aria-label="Primary navigation" />',
        '      <input aria-label={t("common.search")} />',
        '      <button aria-label={t(\'search.clear\')} data-testid="clear-btn" />',
        '      <div cmdk-item="" data-value={`cmd-${id}`} />',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
      // File name contains "menu-unused", but body does NOT read data-testid="menu-unused": must NOT false-match!
      'e2e/menu-unused.spec.ts': [
        "import { test, expect } from '@playwright/test';",
        "test.describe('Search suite', () => {",
        "  test('opens palette', async ({ page }) => {",
        "    await page.locator('[cmdk-root]').waitFor();",
        "    await page.locator('[cmdk-item][data-value^=\"cmd-\"]').first().click();",
        "    await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible();",
        "    await page.getByRole('button', { name: 'Clear search' }).click();",
        "    await page.getByTestId('clear-btn').click();",
        '  });',
        '});',
      ].join('\n'),
    });

    const found = domHooks.hooksReadInFiles(dir, ['src/CommandMenu.tsx'], { locale: 'shared/locales/en/common.json' });
    const hookNames = found.map((f) => f.hook);
    assert.ok(hookNames.includes('cmdk-root'), `missing cmdk-root in ${hookNames}`);
    assert.ok(hookNames.includes('cmdk-item'), `missing cmdk-item in ${hookNames}`);
    assert.ok(hookNames.includes('data-value=cmd-…'), `missing data-value=cmd-… in ${hookNames}`);
    assert.ok(hookNames.includes('data-testid=clear-btn'), `missing data-testid=clear-btn in ${hookNames}`);
    assert.ok(hookNames.includes('aria-label="Primary navigation"'), `missing Primary navigation in ${hookNames}`);
    assert.ok(hookNames.includes('aria-label="Clear search" (search.clear)'), `missing Clear search in ${hookNames}`);

    // Unread hooks and filename-only / describe()-only occurrences must NOT appear
    assert.equal(hookNames.some((h) => h.includes('command-menu')), false, `unread data-ui leaked: ${hookNames}`);
    assert.equal(hookNames.some((h) => h.includes('menu-unused')), false, `filename leaked into body match: ${hookNames}`);
    assert.equal(hookNames.some((h) => h.includes('"Search"')), false, `describe('Search') leaked as aria reader: ${hookNames}`);

    // End-to-end via buildNodeContextProvider
    const provider = op.buildNodeContextProvider(dir, null);
    const uiCtx = provider({ id: 'T1', mutation_scope: ['src/CommandMenu.tsx', 'src/NewComponent.tsx'] }, null);
    assert.ok(
      uiCtx.repoRules.some((r) => r.text.includes('[generated_files]')),
      `expected generated_files in repoRules, got: ${JSON.stringify(uiCtx.repoRules)}`,
    );
    assert.ok(
      uiCtx.lessons.some((l) => l.includes('Contratos de DOM/acessibilidade') && l.includes('cmdk-root') && l.includes('Clear search')),
      `expected active DOM hooks lesson in node context, got: ${JSON.stringify(uiCtx.lessons)}`,
    );

    // Backend node in the same repo gets 0 DOM hook lessons
    const backendCtx = provider({ id: 'T2', mutation_scope: ['src/server/index.ts'] }, null);
    assert.equal(
      backendCtx.lessons.some((l) => l.includes('Contratos de DOM/acessibilidade')),
      false,
    );

    // checkpoint_dom_hooks: false disables the DOM hook lesson
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ checkpoint_dom_hooks: false }, null, 2));
    const disabledProvider = op.buildNodeContextProvider(dir, null);
    const disabledCtx = disabledProvider({ id: 'T1', mutation_scope: ['src/CommandMenu.tsx'] }, null);
    assert.equal(
      disabledCtx.lessons.some((l) => l.includes('Contratos de DOM/acessibilidade')),
      false,
    );
  });
});
