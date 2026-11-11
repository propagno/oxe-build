'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const pb = require('../bin/lib/oxe-plan-build.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OXB-207:
//   (1) Auto-couple `e2e/offer-audit.spec.ts` into `files` when editing `src/components/Navigation/appMenus.ts`
//       or `src/components/Settings/SettingsModal.tsx`, with a lint warning mentioning `MENU_EFFECTS`.
//   (2) Auto-inject `tests/design-lint.test.ts` and `tests/design-lint-target-size.test.ts` into `Tn.verify.commands`
//       for every `FE-*` / frontend task that creates or edits `.tsx` / `.css` in `src/`.

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
};

function makeOxespaceProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-oxb207-'));
  dirs.push(dir);

  write(dir, '.oxe/STATE.md', '# S\n');
  write(
    dir,
    '.oxe/SPEC.md',
    '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A30 | menu e settings | t |\n| A50 | painel HTTP | t |\n| A51 | backend | t |\n'
  );
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 8 — UI & Menus\n\n**Critérios de aceite:** A30, A50, A51\n');
  write(dir, '.oxe/config.json', '{}');

  write(dir, 'src/components/Navigation/appMenus.ts', "export const APP_MENUS = [{ id: 'help.check-updates' }];\n");
  write(dir, 'src/components/Settings/SettingsModal.tsx', 'export function SettingsModal() { return null; }\n');
  write(dir, 'src/components/Settings/AgentActivitySettings.tsx', 'export function AgentActivitySettings() { return null; }\n');
  write(dir, 'src/utils/formatHttp.ts', 'export const formatHttp = (x: string) => x;\n');
  write(dir, 'electron/main/services/http/inspector.ts', 'export function inspectHttp() { return []; }\n');

  write(dir, 'e2e/offer-audit.spec.ts', 'export const MENU_EFFECTS = {};\n');
  write(dir, 'tests/design-lint.test.ts', "import { describe, it } from 'vitest';\ndescribe('design-lint', () => { it('tokens', () => {}); });\n");
  write(dir, 'tests/design-lint-target-size.test.ts', "import { describe, it } from 'vitest';\ndescribe('target-size', () => { it('targets', () => {}); });\n");
  write(dir, 'tests/app-menus.test.ts', "import { describe, it } from 'vitest';\ndescribe('menus', () => { it('items', () => {}); });\n");

  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');

  return dir;
}

describe('OXB-207: coupled `e2e/offer-audit.spec.ts` on `appMenus.ts` / `SettingsModal.tsx` with `MENU_EFFECTS` lint warning', () => {
  it('auto-includes `e2e/offer-audit.spec.ts` in `files` and `pack` and emits `MENU_EFFECTS` warnings in build, check-role, and plan lint', () => {
    const dir = makeOxespaceProject();
    const roleDoc = {
      role: 'frontend',
      tasks: [
        {
          rid: 'FE-F11-MENU',
          title: "Adicionar 'help.whats-new' em appMenus.ts",
          edited: ['src/components/Navigation/appMenus.ts'],
          verify: { commands: ['npx vitest run tests/app-menus.test.ts'] },
          acceptance: ['A30'],
        },
        {
          rid: 'FE-F3-SETTINGS',
          title: 'Redirecionar Check for updates de Updates para About em SettingsModal',
          edited: ['src/components/Settings/SettingsModal.tsx'],
          verify: { commands: ['npx vitest run tests/app-menus.test.ts'] },
          acceptance: ['A30'],
        },
      ],
    };

    // 1. checkRole recommends e2e/offer-audit.spec.ts and warns about MENU_EFFECTS
    const roleCheck = pb.checkRole(dir, roleDoc);
    assert.deepEqual(roleCheck.errors, []);
    assert.ok(
      roleCheck.warnings.some((w) => w.includes('e2e/offer-audit.spec.ts') && w.includes('MENU_EFFECTS')),
      `expected MENU_EFFECTS warning in checkRole, got: ${roleCheck.warnings.join(' | ')}`
    );

    // 2. plan build auto-includes e2e/offer-audit.spec.ts in both tasks and pack exact_paths
    const built = pb.build([{ file: 'f8-FRONTEND.json', doc: roleDoc }], { root: dir, phase: 'F8' });
    assert.deepEqual(built.errors, []);

    const tMenu = built.plan.tasks.find((t) => t.rid === 'FE-F11-MENU');
    const tSettings = built.plan.tasks.find((t) => t.rid === 'FE-F3-SETTINGS');
    assert.ok(tMenu.files.includes('e2e/offer-audit.spec.ts'));
    assert.ok(tSettings.files.includes('e2e/offer-audit.spec.ts'));

    const pMenu = built.pack.tasks.find((p) => p.id === tMenu.id);
    assert.ok(pMenu.exact_paths.includes('e2e/offer-audit.spec.ts'));
    assert.ok(built.warnings.some((w) => w.includes(tMenu.id) && w.includes('MENU_EFFECTS')));
    assert.ok(built.warnings.some((w) => w.includes(tSettings.id) && w.includes('MENU_EFFECTS')));

    // 3. plan lint warns when e2e/offer-audit.spec.ts is missing AND reminds about MENU_EFFECTS when included
    const lintMissing = planJson.lintPlan({
      projectRoot: dir,
      plan: {
        source: 'PLAN.json',
        tasks: [
          {
            id: 'T1',
            title: 'Editar menu',
            wave: 1,
            files: ['src/components/Navigation/appMenus.ts'],
            verifyCommand: 'npx vitest run tests/app-menus.test.ts',
          },
        ],
      },
    });
    assert.ok(
      lintMissing.warnings.some((w) => w.includes('e2e/offer-audit.spec.ts') && w.includes('MENU_EFFECTS')),
      `expected missing coupled warning with MENU_EFFECTS, got: ${lintMissing.warnings.join(' | ')}`
    );

    const lintIncluded = planJson.lintPlan({
      projectRoot: dir,
      plan: {
        source: 'PLAN.json',
        tasks: [
          {
            id: 'T1',
            title: 'Editar menu',
            wave: 1,
            files: ['src/components/Navigation/appMenus.ts', 'e2e/offer-audit.spec.ts'],
            verifyCommand: 'npx vitest run tests/app-menus.test.ts',
          },
        ],
      },
    });
    assert.ok(
      lintIncluded.warnings.some((w) => w.includes('MENU_EFFECTS')),
      `expected MENU_EFFECTS reminder even when coupled file is present, got: ${lintIncluded.warnings.join(' | ')}`
    );
  });
});

describe('OXB-207: auto-inject `tests/design-lint.test.ts` and `tests/design-lint-target-size.test.ts` in `FE-*` tasks touching `src/**/*.{tsx,css}`', () => {
  it('injects design-lint suites on FE-* tasks creating/editing `.tsx` or `.css` in `src/`, and skips backend / non-UI `.ts` tasks', () => {
    const dir = makeOxespaceProject();
    const feFile = path.join(dir, 'f8-tasks-FRONTEND.json');
    const beFile = path.join(dir, 'f8-tasks-BACKEND.json');

    write(dir, 'f8-tasks-FRONTEND.json', {
      role: 'frontend',
      tasks: [
        {
          id: 'FE-HTTP-PANEL',
          rid: 'A50-PANEL',
          title: 'Criar HttpCallsPanel.tsx e HttpCallsPanel.css',
          kind: 'add',
          created: [
            'src/components/HttpCalls/HttpCallsPanel.tsx',
            'src/components/HttpCalls/HttpCallsPanel.css',
          ],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A50'],
        },
        {
          rid: 'FE-ACTIVITY',
          title: 'Editar AgentActivitySettings.tsx',
          edited: ['src/components/Settings/AgentActivitySettings.tsx'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A50'],
        },
        {
          rid: 'FE-UTIL',
          title: 'Editar formatador puro TS sem UI',
          edited: ['src/utils/formatHttp.ts'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A50'],
        },
      ],
    });

    write(dir, 'f8-tasks-BACKEND.json', {
      role: 'backend',
      tasks: [
        {
          rid: 'BE-HTTP',
          title: 'Serviço HTTP no main process',
          edited: ['electron/main/services/http/inspector.ts'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A51'],
        },
      ],
    });

    const cliRes = spawnSync(
      process.execPath,
      [CLI, 'plan', 'build', '--from', feFile, beFile, '--phase', 'F8', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true }
    );
    assert.equal(cliRes.status, 0, cliRes.stdout + cliRes.stderr);

    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const pack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));

    const tPanel = plan.tasks.find((t) => t.rid === 'A50-PANEL');
    const tActivity = plan.tasks.find((t) => t.rid === 'FE-ACTIVITY');
    const tUtil = plan.tasks.find((t) => t.rid === 'FE-UTIL');
    const tBe = plan.tasks.find((t) => t.rid === 'BE-HTTP');

    for (const uiTask of [tPanel, tActivity]) {
      const joined = uiTask.verify.commands.join(' && ');
      assert.ok(joined.includes('tests/design-lint.test.ts'), `${uiTask.rid} includes design-lint.test.ts`);
      assert.ok(joined.includes('tests/design-lint-target-size.test.ts'), `${uiTask.rid} includes design-lint-target-size.test.ts`);
      const pEntry = pack.tasks.find((p) => p.id === uiTask.id);
      assert.ok(pEntry.expected_checks.join(' && ').includes('tests/design-lint.test.ts'));
    }

    // AgentActivitySettings.tsx is NOT SettingsModal.tsx, so offer-audit is not needlessly coupled
    assert.ok(!tActivity.files.includes('e2e/offer-audit.spec.ts'));

    // Pure .ts utility and backend tasks do NOT get design-lint injected
    assert.ok(!tUtil.verify.commands.join(' && ').includes('design-lint'));
    assert.ok(!tBe.verify.commands.join(' && ').includes('design-lint'));
  });
});
