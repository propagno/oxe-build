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

  it('G40c: geometry read inside an overlay before its entrance animation finished (OxeSpace OQ T14)', () => {
    const racy = [
      "test('pq-07-12 alinha', async () => {",
      "  const dialog = page.getByRole('dialog');",
      "  await expect(dialog).toBeVisible();",
      "  const a = await dialog.locator('.label').boundingBox();",
      "  const b = await dialog.locator('.value').boundingBox();",
      '});',
    ].join('\n');
    assert.deepEqual(r.overlayGeometryReads(racy).map((f) => f.line), [4]);
    const waited = racy.replace("  const a =", "  await dialog.evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((x) => x.finished)));\n  const a =");
    assert.equal(r.overlayGeometryReads(waited).length, 0);
    assert.equal(r.overlayGeometryReads(racy.replace("  const a =", "  await waitForEntrance(dialog);\n  const a ="), { helpers: ['waitForEntrance'] }).length, 0);
    assert.equal(r.overlayGeometryReads("test('x', async () => {\n  const b = await page.locator('#card').boundingBox();\n});").length, 0, 'no overlay: no finding');
    assert.match(r.overlayGeometryMessages([{ task: 'T14', file: 'e2e/pq-07-12.spec.ts', line: 4, overlay: 'x', read: 'y' }])[0], /getAnimations.*\[G40c\]/);
    // R45: a title, a URL or a text with "menu" is no overlay; a closed overlay does not count
    assert.equal(r.overlayGeometryReads("test('sidebar menu stays aligned', async () => {\n  await page.goto('/settings/menu');\n  await expect(h1).toHaveText('Menu');\n  const b = await page.locator('#header').boundingBox();\n});").length, 0);
    const closed = "test('x', async () => {\n  const d = page.getByRole('dialog');\n  await d.getByRole('button').click();\n  await expect(d).toBeHidden();\n  const b = await page.locator('#main').boundingBox();\n});";
    assert.equal(r.overlayGeometryReads(closed).length, 0);
    assert.equal(r.overlayGeometryReads("test('x', async () => {\n  const m = page.locator('[data-test=user-menu]');\n  const b = await m.boundingBox();\n});").length, 1, 'a locator naming a menu counts');
    // chat-f5 T12 (false positive live on 58cc988): a listbox opened and closed with Escape, then a toolbar measured
    const f5 = [
      "test('composer bar', async () => {",
      "  const list = page.getByRole('listbox');",
      "  await expect(list).toBeVisible();",
      "  await page.keyboard.press('Escape');",
      "  await resizeWindow(app, 900, 700);",
      "  const box = await toolbar.locator('[data-ui=\"mode-switch\"]').boundingBox();",
      '});',
    ].join('\n');
    assert.equal(r.overlayGeometryReads(f5).length, 0, 'Escape closes it');
    assert.equal(r.overlayGeometryReads(f5.replace("  await page.keyboard.press('Escape');\n", '')).length, 0, 'the toolbar is not the listbox');
    // OQ pq-07-17 (true positive): a locator derived from the dialog
    const oq = "test('import map', async () => {\n  const dialog = page.getByRole('dialog');\n  const map = dialog.locator('.oq-import-map');\n  const b = await map.boundingBox();\n});";
    assert.deepEqual(r.overlayGeometryReads(oq).map((f) => f.line), [4]);
    // R50: a chain broken by a formatter; a second overlay keeps the first one's variable
    const chain = "test('x', async () => {\n  const dialog = page.getByRole('dialog');\n  const b = await dialog\n    .locator('.oq-import-map')\n    .boundingBox();\n});";
    assert.deepEqual(r.overlayGeometryReads(chain).map((f) => f.line), [5]);
    const css = "test('x', async () => {\n  const dialog = page.getByRole('dialog');\n  await expect(dialog.locator('.header'))\n    .toHaveCSS('height', '48px');\n});";
    assert.equal(r.overlayGeometryReads(css).length, 1);
    const two = "test('x', async () => {\n  const dialog = page.getByRole('dialog');\n  const list = dialog.getByRole('listbox');\n  const b = await dialog.locator('.row').boundingBox();\n});";
    assert.equal(r.overlayGeometryReads(two).length, 1);
    const doneDoc = { tasks: [{ id: 'T1', done: true, acceptance: ['A1'] }], acceptance_tests: [{ criterion: 'A1', files: ['e2e/x.spec.ts'] }] };
    assert.equal(r.overlayGeometryFrozenE2e('.', doneDoc, { readText: () => racy }).length, 0, 'owners all done: not read');
  });

  it('R29: a URL in a string is no comment; a hook starts anew; a launch and an action on one line count', () => {
    const url = "test('a', async () => {\n  await page.goto('http://localhost:3000'); await page.locator('#ready').waitFor();\n  await page.click('#x');\n});";
    assert.equal(r.racyActions(url).length, 0, 'the wait after the URL is read');
    const hook = "test('a', async () => {\n  await page.reload();\n});\ntest.afterEach(async () => {\n  await page.click('#logout');\n});";
    assert.equal(r.racyActions(hook).length, 0, 'the afterEach is its own sequence');
    const same = "test('a', async () => {\n  await page.goto(u); await page.click('#x');\n});";
    assert.deepEqual(r.racyActions(same).map((f) => f.line), [2]);
    const commented = "test('a', async () => {\n  await page.goto(u); // then page.click('#x')\n  await page.locator('#ready').waitFor();\n});";
    assert.equal(r.racyActions(commented).length, 0);
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

  it('a pending task sharing a file with a task whose checkpoint failed (uncommitted work) waits for it (OxeSpace 15/11, Celular F4 T14/T15)', () => {
    const { planJsonToParsedPlan } = require('../bin/lib/oxe-plan-json.cjs');
    const doc = { schema_version: 1, tasks: [
      { id: 'T14', title: 'a', wave: 1, files: ['app/pairing/PairingFlow.kt', 'app/res/strings.xml'], checkpoint_failed: { kind: 'scope_insufficient', reason: 'x', related_red: [] } },
      { id: 'T15', title: 'b', wave: 1, files: ['app/pairing/PairingFlow.kt', 'app/Other.kt'] },
      { id: 'T16', title: 'c', wave: 1, files: ['app/Unrelated.kt'] },
    ] };
    const parsed = planJsonToParsedPlan(doc);
    const by = Object.fromEntries(parsed.tasks.map((t) => [t.id, t]));
    assert.ok((by.T15.meta.blocked_by || []).some((b) => /waiting_shared_files: T14 \(app\/pairing\/PairingFlow\.kt\)/.test(b)), JSON.stringify(by.T15.meta));
    assert.equal(by.T16.meta.blocked_by, undefined, 'no shared file: runs');
  });

  it('R31: a directory scope overlaps; an empty_checkpoint with nothing left in the tree holds no wait; the own waits are not a delivery', () => {
    const { planJsonToParsedPlan } = require('../bin/lib/oxe-plan-json.cjs');
    const { isExternallyDelivered } = require('../bin/lib/oxe-operational.cjs');
    const doc = { schema_version: 1, tasks: [
      { id: 'T14', title: 'a', wave: 1, files: ['app/pairing'], checkpoint_failed: { kind: 'integration', reason: 'x' } },
      { id: 'T15', title: 'b', wave: 1, files: ['app/pairing/PairingFlow.kt'] },
      { id: 'T20', title: 'c', wave: 1, files: ['app/z/Z.kt'], checkpoint_failed: { kind: 'empty_checkpoint', reason: 'nada mudou' } },
      { id: 'T21', title: 'd', wave: 1, files: ['app/z/Z.kt'] },
      { id: 'T22', title: 'e', wave: 1, files: ['app/y/Y.kt'], checkpoint_failed: { kind: 'empty_checkpoint', reason: 'restos', leftover: ['app/y/Y.kt'] } },
      { id: 'T23', title: 'f', wave: 1, files: ['app/y/Y.kt'] },
    ] };
    const by = Object.fromEntries(planJsonToParsedPlan(doc).tasks.map((t) => [t.id, t]));
    assert.ok((by.T15.meta.blocked_by || []).some((b) => /^waiting_shared_files: T14 \(app\/pairing\)/.test(b)), JSON.stringify(by.T15.meta));
    assert.equal(by.T21.meta.blocked_by, undefined, 'empty_checkpoint without leftover: no wait');
    assert.ok((by.T23.meta.blocked_by || []).some((b) => /waiting_shared_files: T22/.test(b)));
    assert.equal(isExternallyDelivered(doc.tasks[1], by.T15), false, 'waiting_shared_files is not an external delivery');
    assert.equal(isExternallyDelivered({}, { meta: { blocked_by: ['scope_insufficient: tests/x.test.ts'] } }), false);
    assert.equal(isExternallyDelivered({}, { meta: { blocked_by: ['PR #12 do repo-b'] } }), true);
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
