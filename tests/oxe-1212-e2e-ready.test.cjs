'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const r = require('../bin/lib/oxe-e2e-ready.cjs');

// OxeSpace 15/11 (PR #863): a frozen e2e pressed Ctrl+Shift+U ~50 ms after launchApp, before the shell mounted its
// keybindings. G40: the first action after a launch must come after a readiness wait.

const RACY = [
  "import { test, expect } from '@playwright/test';",
  "test('toast', async () => {",
  '  const page = await launchApp();',
  "  await resizeWindow(page, 1280, 800);",
  "  await page.keyboard.press('Control+Shift+U');",
  "  await expect(page.locator('[data-toast]')).toBeVisible();",
  '});',
].join('\n');

describe('G40: frozen e2e act only after the app is ready', () => {
  it('flags the first keyboard press right after launch/resize; a wait in between clears it', () => {
    const found = r.racyActions(RACY);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 5);
    assert.match(found[0].action, /keyboard\.press/);
    const fixed = RACY.replace("  await page.keyboard.press", "  await page.locator('button[data-app-mode]').first().waitFor();\n  await page.keyboard.press");
    assert.equal(r.racyActions(fixed).length, 0);
  });

  it('a repo readiness helper counts as the wait (lint.e2e_ready_helpers); each test body is on its own', () => {
    const withHelper = RACY.replace("  await page.keyboard.press", "  await waitForAppReady(page);\n  await page.keyboard.press");
    assert.equal(r.racyActions(withHelper).length, 1, 'unknown helper: still flagged');
    assert.equal(r.racyActions(withHelper, { helpers: ['waitForAppReady'] }).length, 0);
    const two = `${RACY}\ntest('second', async () => {\n  await page.click('#x');\n});\n`;
    assert.equal(r.racyActions(two).length, 1, 'no launch in the second test: nothing pending');
  });

  it('G40b: a case-sensitive regex name the real catalog string cannot match is named; /i and string names pass (#862)', () => {
    const spec = [
      "test('density', async () => {",
      "  await page.getByRole('menuitem', { name: /Comfortable/ }).click();",
      "  await page.getByRole('menuitem', { name: /comfortable/i }).click();",
      "  await page.getByRole('menuitem', { name: 'Use comfortable density' }).click();",
      "  await page.getByRole('button', { name: /Dynamic \\d+/ }).click();",
      '});',
    ].join('\n');
    const files = { 'e2e/polish/pm-02-8.spec.ts': spec, 'shared/locales/en/app.json': JSON.stringify({ palette: { density: 'Use comfortable density' } }) };
    const doc = { tasks: [{ id: 'T8', acceptance: ['A8'] }], acceptance_tests: [{ criterion: 'A8', files: ['e2e/polish/pm-02-8.spec.ts'] }] };
    const found = r.labelMismatches('/x', doc, { catalogs: ['shared/locales/en/app.json'], readText: (f) => files[f] || '' });
    assert.deepEqual(found.map((f) => [f.line, f.pattern, f.real]), [[2, '/Comfortable/', 'Use comfortable density']]);
    assert.match(r.labelMessages(found)[0], /use \/Comfortable\/i/);
    assert.equal(r.labelMismatches('/x', doc, { catalogs: [], readText: (f) => files[f] || '' }).length, 0, 'no catalog: nothing to compare');
  });

  it('G41: a frozen Paparazzi test that changes locale through createConfigurationContext is named (Celular F4 T13)', () => {
    const kt = [
      'class SettingsSectionsTest {',
      '  @get:Rule val paparazzi = Paparazzi()',
      '  @Test fun theComputerCardShowsTheOsAndThePairingDate() {',
      '    val ctx = context.createConfigurationContext(config)',
      '  }',
      '}',
    ].join('\n');
    const doc = { tasks: [{ id: 'T13', acceptance: ['A13'] }], acceptance_tests: [{ criterion: 'A13', files: ['app/src/test/SettingsSectionsTest.kt', 'app/src/test/Plain.kt'] }] };
    const files = { 'app/src/test/SettingsSectionsTest.kt': kt, 'app/src/test/Plain.kt': 'class Plain { fun x() = context.createConfigurationContext(c) }' };
    const found = r.layoutlibHazards('/x', doc, { readText: (f) => files[f] || '' });
    assert.deepEqual(found.map((f) => [f.task, f.file, f.line]), [['T13', 'app/src/test/SettingsSectionsTest.kt', 4]], 'only Paparazzi tests');
    assert.match(r.layoutlibMessages(found)[0], /DeviceConfig .*\[G41\]/);
  });

  it('G42: a docker info guard without OSType, and a skip with no reason, in a frozen test that starts containers (PR #867)', () => {
    const bad = [
      "const noContainerEngine = () => spawnSync('docker', ['info']).status !== 0;",
      'test.skip(noContainerEngine());',
      "test('pg', async () => { spawnSync('docker', ['run', '-d', 'postgres:16-alpine']); });",
    ].join('\n');
    const good = [
      "const linuxEngine = () => spawnSync('docker', ['info', '--format', '{{.OSType}}']).stdout.trim() === 'linux';",
      "test.skip(!linuxEngine(), 'sem engine Linux de containers');",
      "test('pg', async () => { spawnSync('docker', ['run', '-d', 'postgres:16-alpine']); });",
    ].join('\n');
    const files = { 'e2e/polish/pq-07-1.spec.ts': bad, 'e2e/polish/pq-07-2.spec.ts': good };
    const doc = { tasks: [{ id: 'T7', acceptance: ['A7'] }], acceptance_tests: [{ criterion: 'A7', files: Object.keys(files) }] };
    const found = r.containerGuardHazards('/x', doc, { readText: (f) => files[f] || '' });
    assert.deepEqual(found.map((f) => [f.file, f.line, f.kind]), [['e2e/polish/pq-07-1.spec.ts', 1, 'ostype'], ['e2e/polish/pq-07-1.spec.ts', 2, 'skip_reason']]);
    assert.match(r.containerGuardMessages(found)[0], /OSType.*\[G42\]/);
  });

  it('racyFrozenE2e reads only the plan frozen e2e specs of pending tasks', () => {
    const files = { 'e2e/polish/pm-02-10.spec.ts': RACY, 'tests/unit/x.test.ts': RACY };
    const doc = {
      tasks: [{ id: 'T9', acceptance: ['A9'] }, { id: 'T1', done: true, acceptance: ['A1'] }],
      acceptance_tests: [
        { criterion: 'A9', files: ['e2e/polish/pm-02-10.spec.ts', 'tests/unit/x.test.ts'] },
        { criterion: 'A1', task: 'T1', files: ['e2e/polish/old.spec.ts'] },
      ],
    };
    const found = r.racyFrozenE2e('/x', doc, { readText: (f) => files[f] || RACY });
    assert.deepEqual(found.map((f) => [f.task, f.file, f.line]), [['T9', 'e2e/polish/pm-02-10.spec.ts', 5]]);
    assert.match(r.racyMessages(found)[0], /pm-02-10\.spec\.ts:5 age logo depois de abrir o app .*\[G40\]/);
  });
});
