'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dh = require('../bin/lib/oxe-dom-hooks.cjs');

// OxeSpace 15/11 (OxeCode F6 T30 → #852): CommandMenu became the CommandBar palette and dropped the cmdk markup that
// ~30 e2e specs read; the break showed only in the PR's CI. A static check of the removed DOM hooks and their readers.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-domhooks-'));
  dirs.push(dir);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'src/CommandMenu.tsx', [
    'export function CommandMenu({ items }) {',
    '  return (<div cmdk-root="" data-ui="command-menu">',
    '    {items.map((i) => <div cmdk-item="" data-value={`cmd-${i.id}`} key={i.id}>{i.label}</div>)}',
    '    <span data-testid="menu-empty">vazio</span>',
    '  </div>);',
    '}',
    '',
  ].join('\n'));
  write(dir, 'src/Other.tsx', 'export const Other = () => <div data-ui="other-panel" />;\n');
  write(dir, 'e2e/helpers/panels.ts', "export const openMenu = (p) => p.locator('[cmdk-root]');\nexport const item = (p, id) => p.locator(`[cmdk-item][data-value=\"cmd-${id}\"]`);\n");
  write(dir, 'e2e/menu.spec.ts', "test('empty', async ({ page }) => { await page.getByTestId('menu-empty').isVisible(); await page.locator('[data-ui=\"other-panel\"]'); });\n");
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('DOM hooks removed while tests still read them', () => {
  it('names each removed hook gone from the product that e2e still reads, with the readers', () => {
    const dir = repo();
    // a leftover global CSS rule and a doc still name cmdk-root: they never render it (cross-review 15/11)
    write(dir, 'src/styles/global.css', '[cmdk-root] { display: flex; }\n');
    write(dir, 'docs/menu.md', 'The menu uses cmdk-root and cmdk-item.\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'css and docs');
    const parent = git(dir, 'rev-parse', 'HEAD');
    write(dir, 'src/CommandMenu.tsx', 'export function CommandMenu({ items }) {\n  return (<ul className="palette">{items.map((i) => <li key={i.id}>{i.label}</li>)}</ul>);\n}\n');
    write(dir, 'src/New.tsx', 'export const New = () => <div />;\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'palette');
    const found = dh.hooksStillRead(dir, parent, git(dir, 'rev-parse', 'HEAD'));
    const hooks = found.map((f) => f.hook).sort();
    assert.ok(hooks.includes('cmdk-root'), hooks.join(','));
    assert.ok(hooks.includes('cmdk-item'), hooks.join(','));
    assert.ok(hooks.includes('data-value=cmd-…'), hooks.join(','));
    assert.ok(hooks.includes('data-testid=menu-empty'), hooks.join(','));
    assert.ok(!hooks.some((h) => h.startsWith('data-ui=command-menu')), 'no test reads data-ui=command-menu');
    assert.ok(found.find((f) => f.hook === 'cmdk-root').readers.some((r) => r.startsWith('e2e/helpers/panels.ts:1')));
    assert.match(dh.message(found), /cmdk-root \(removido de src\/CommandMenu\.tsx\) ainda é lido por/);
  });

  it('a hook kept elsewhere in the product, or whose readers go in the same commit, is not reported', () => {
    const dir = repo();
    const parent = git(dir, 'rev-parse', 'HEAD');
    // data-ui="other-panel" moves to another component; the e2e helpers that read cmdk go with the palette change
    write(dir, 'src/Other.tsx', 'export const Other = () => <section />;\n');
    write(dir, 'src/Panel.tsx', 'export const Panel = () => <div data-ui="other-panel" />;\n');
    write(dir, 'src/CommandMenu.tsx', 'export function CommandMenu() {\n  return (<ul><span data-testid="menu-empty">vazio</span></ul>);\n}\n');
    write(dir, 'e2e/helpers/panels.ts', "export const openMenu = (p) => p.locator('ul');\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'move');
    assert.deepEqual(dh.hooksStillRead(dir, parent, git(dir, 'rev-parse', 'HEAD')), []);
  });

  it('an accessible name removed (aria-label static or by i18n key) that e2e reads by role + name is reported (OxeSpace 15/11, F5 T22)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-domhooks-aria-'));
    dirs.push(dir);
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'core.autocrlf', 'false');
    write(dir, 'src/Shell.tsx', "export const Shell = ({ t }) => (<><nav aria-label={t('nav.primary')}>x</nav><button aria-label=\"Clear search\">x</button><nav aria-label={t('nav.footer')}>y</nav></>);\n");
    write(dir, 'src/Footer.tsx', "export const Footer = ({ t }) => <nav aria-label={t('nav.footer')} />;\n");
    write(dir, 'shared/locales/en/app.json', JSON.stringify({ nav: { primary: 'Primary navigation', footer: 'Footer links' } }));
    write(dir, 'e2e/orca-shell.spec.ts', "await page.getByRole('navigation', { name: 'Primary navigation' });\nawait page.getByRole('button', { name: 'Clear search' });\nawait page.getByRole('navigation', { name: 'Footer links' });\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    const parent = git(dir, 'rev-parse', 'HEAD');
    write(dir, 'src/Shell.tsx', 'export const Shell = () => (<div>x</div>);\n');
    git(dir, 'commit', '-qam', 'drop the nav');
    const found = dh.hooksStillRead(dir, parent, git(dir, 'rev-parse', 'HEAD'), { locale: 'shared/locales/en/app.json' });
    const hooks = found.map((f) => f.hook).sort();
    assert.deepEqual(hooks, ['aria-label="Clear search"', 'aria-label="Primary navigation" (nav.primary)'], 'nav.footer is still used by Footer.tsx');
    // without the locale the i18n key cannot be resolved: only the static name
    assert.deepEqual(dh.hooksStillRead(dir, parent, git(dir, 'rev-parse', 'HEAD')).map((f) => f.hook), ['aria-label="Clear search"']);
  });

  it('generated_files: a generated file edited without its source is refused; with the source, it passes (OxeSpace 15/11, Celular F3)', () => {
    const rules = [{ file: 'mobile/android/**/strings.xml', source: 'shared/locales/*/mobile.json', test: 'tests/android-generated.test.ts', generator: 'node scripts/android/generate.mjs' }];
    const hit = dh.generatedEdits(['mobile/android/app/src/main/res/values/strings.xml', 'src/a.ts'], rules);
    assert.equal(hit.length, 1);
    assert.match(dh.generatedMessage(hit), /strings\.xml é gerado de shared\/locales\/\*\/mobile\.json: edite a fonte e rode o gerador \(node scripts\/android\/generate\.mjs\); o teste tests\/android-generated\.test\.ts/);
    assert.equal(dh.generatedEdits(['mobile/android/app/src/main/res/values/strings.xml', 'shared/locales/pt/mobile.json'], rules).length, 0, 'the source changed too');
    assert.equal(dh.generatedEdits(['src/a.ts'], rules).length, 0);
  });

  it('removedHooks reads only removed markup lines (not tests, not added lines)', () => {
    const diff = [
      '--- a/src/A.tsx', '+++ b/src/A.tsx', '-  <div data-testid="x-box" cmdk-list>', '+  <div data-testid="x-box">',
      '--- a/e2e/a.spec.ts', '+++ b/e2e/a.spec.ts', "-  page.locator('[data-ui=\"gone\"]')",
      '--- a/src/util.ts', '+++ b/src/util.ts', "-  const k = 'data-ui=\"nope\"'",
    ].join('\n');
    const hooks = dh.removedHooks(diff).map((h) => `${h.name}=${h.value ?? ''}`).sort();
    assert.deepEqual(hooks, ['cmdk-list=', 'data-testid=x-box']);
  });
});
