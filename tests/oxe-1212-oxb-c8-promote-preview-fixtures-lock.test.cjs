'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const promoteHelpers = require('../bin/lib/oxe-promote-helpers.cjs');

const CLI = path.resolve(__dirname, '../bin/oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function initBaseRepo(prefix, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  writeFiles(dir, {
    '.gitignore': '.oxe/\n',
    '.oxe/STATE.md': '# S\n',
    '.oxe/PLAN.md': '# PLAN\n',
    ...files,
  });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@oxe.local']);
  git(dir, ['config', 'user.name', 'OXE Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

describe('OXB-C8 #1: runtime promote --preview-ci e2e grouping, remote-verify wrapper, clean failure reporting & always-on risk output', () => {
  it('groups Playwright risk suites per --config, prefers PLAN.json remote-verify wrapper (including external relative paths), and extracts real failing spec without NO_COLOR noise', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c8-ws-'));
    dirs.push(parent);
    const work = path.join(parent, 'repo');
    const depsScripts = path.join(parent, 'shared-tools', 'scripts');
    fs.mkdirSync(depsScripts, { recursive: true });
    // External wrapper referenced via relative path `../shared-tools/scripts/remote-verify.mjs` in PLAN.json
    const wrapperLog = path.join(parent, 'wrapper-calls.log');
    writeFiles(depsScripts, {
      'remote-verify.mjs': [
        "import fs from 'node:fs';",
        "const idx = process.argv.indexOf('--');",
        "const inner = idx >= 0 ? process.argv.slice(idx + 1).join(' ') : '';",
        `fs.appendFileSync(${JSON.stringify(wrapperLog)}, inner + '\\n');`,
        "console.log('verify\\tRun e2e\\t2026-11-16T22:30:01Z   1) [acceptance] › e2e/acceptance/settings-migration.spec.ts:14:5 › migrates settings link');",
        "console.log('verify\\tRun e2e\\t2026-11-16T22:30:02Z     Error: expect(locator).toBeVisible() failed — expected [href=\"/settings/tools\"]');",
        "console.log('verify\\tRun e2e\\t2026-11-16T22:30:03Z   1 failed');",
        "for (let i = 0; i < 12; i += 1) console.error(\"Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\");",
        'process.exit(1);',
      ].join('\n'),
    });

    writeFiles(work, {
      '.gitignore': '.oxe/\n',
      '.oxe/STATE.md': '# S\n',
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/config.json': JSON.stringify({ lint: { cross_card_conflicts: 'off' } }, null, 2),
      'playwright.config.ts': "export default { testDir: './e2e' };\n",
      'playwright.acceptance.config.ts': "export default { testDir: './e2e/acceptance' };\n",
      'playwright.brand.config.ts': "import path from 'node:path';\nexport default { testDir: path.join(__dirname, 'e2e', 'brand') };\n",
      'src/SettingsNav.tsx': 'export const SettingsNav = () => "<nav>old</nav>";\n',
      'e2e/acceptance/settings-migration.spec.ts': "import { test } from '@playwright/test';\n// SettingsNav\ntest('acc', () => {});\n",
      'e2e/brand/settings-brand.spec.ts': "import { test } from '@playwright/test';\n// SettingsNav\ntest('brand', () => {});\n",
      'e2e/workspace/settings-nav.spec.ts': "import { test } from '@playwright/test';\n// SettingsNav\ntest('core', () => {});\n",
    });
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['config', 'user.email', 'test@oxe.local']);
    git(work, ['config', 'user.name', 'OXE Test']);
    git(work, ['add', '-A']);
    git(work, ['commit', '-qm', 'init']);

    git(work, ['checkout', '-qb', 'program']);
    writeFiles(work, { 'src/SettingsNav.tsx': 'export const SettingsNav = () => "<nav>new</nav>";\n' });
    git(work, ['add', 'src/SettingsNav.tsx']);
    git(work, ['commit', '-qm', 'feat: update SettingsNav', '-m', 'OXE-Task: F6/T54']);
    const sha = git(work, ['rev-parse', 'HEAD']);

    const planDoc = {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        {
          id: 'T54',
          title: 'Settings nav',
          wave: 1,
          files: ['src/SettingsNav.tsx'],
          acceptance: ['A54'],
          verify: {
            commands: [
              'node ../shared-tools/scripts/remote-verify.mjs --workflow ci.yml -- npx playwright test --config playwright.acceptance.config.ts e2e/acceptance/other.spec.ts',
            ],
          },
          done: true,
          done_commit: sha,
        },
      ],
    };
    writeFiles(work, { '.oxe/PLAN.json': JSON.stringify(planDoc, null, 2) });

    // Unit check: buildPreviewCiCommands groups by Playwright config and resolves external relative remote-verify wrapper
    const riskSuites = promoteHelpers.discoverMainCiRiskSuites(work, ['src/SettingsNav.tsx']);
    assert.equal(riskSuites.length, 3);
    const cmds = promoteHelpers.buildPreviewCiCommands(work, riskSuites, {}, { projectRoot: work, planTasks: planDoc.tasks, planDoc });
    assert.equal(cmds.length, 3, `expected 3 Playwright config groups, got: ${JSON.stringify(cmds)}`);
    const resolvedWrapper = path.resolve(work, '../shared-tools/scripts/remote-verify.mjs').replace(/\\/g, '/');
    for (const c of cmds) {
      assert.ok(c.startsWith(`node ${resolvedWrapper} --workflow ci.yml -- npx playwright test --config `), `expected remote-verify wrapper prefix, got: ${c}`);
    }
    assert.ok(cmds.some((c) => c.includes('--config playwright.acceptance.config.ts e2e/acceptance/settings-migration.spec.ts')));
    assert.ok(cmds.some((c) => c.includes('--config playwright.brand.config.ts e2e/brand/settings-brand.spec.ts')));
    assert.ok(cmds.some((c) => c.includes('--config playwright.config.ts e2e/workspace/settings-nav.spec.ts')));

    // Output check with --preview-ci OFF: PR body AND CLI stdout still show specs to watch (G45 / CI risks)
    const cliNoPreview = spawnSync(process.execPath, [CLI, 'runtime', 'promote', 'T54', '--base', 'main', '--no-pr-ready', '--dir', work], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, OXE_NO_PROMPT: '1' },
    });
    assert.equal(cliNoPreview.status, 0, cliNoPreview.stderr + cliNoPreview.stdout);
    assert.match(cliNoPreview.stdout, /specs a vigiar/i);
    assert.match(cliNoPreview.stdout, /e2e\/acceptance\/settings-migration\.spec\.ts/);
    assert.match(cliNoPreview.stdout, /e2e\/brand\/settings-brand\.spec\.ts/);
    const prBody = fs.readFileSync(path.join(work, '.oxe', 'promote', 'T54.md'), 'utf8');
    assert.match(prBody, /### Riscos de CI na main/);
    assert.match(prBody, /e2e\/acceptance\/settings-migration\.spec\.ts/);

    // Dry-run also exposes ci_risk_suites and grouped preview_ci_commands
    const dry = op.runtimePromote(work, null, { task: 'T54', base: 'main', dryRun: true, previewCi: true });
    assert.equal(dry.ci_risk_suites.length, 3);
    assert.equal(dry.preview_ci_commands.length, 3);

    // End-to-end --preview-ci FAILURE: invokes external wrapper from worktree, surfaces failing spec & Error, NEVER NO_COLOR warnings
    const promoRed = op.runtimePromote(work, null, { task: 'T54', base: 'main', prReady: false, previewCi: true });
    assert.ok(promoRed.preview_ci);
    assert.equal(promoRed.preview_ci.ok, false);
    assert.deepEqual(promoRed.preview_ci.runs[0].failing_specs, ['e2e/acceptance/settings-migration.spec.ts']);
    assert.match(promoRed.error, /spec\(s\) falhando: e2e\/acceptance\/settings-migration\.spec\.ts/);
    assert.match(promoRed.error, /expect\(locator\)\.toBeVisible\(\) failed/);
    assert.doesNotMatch(promoRed.error, /NO_COLOR/);
    assert.ok(fs.existsSync(wrapperLog), 'remote-verify wrapper script was invoked inside worktree');
    const calls = fs.readFileSync(wrapperLog, 'utf8').trim().split(/\r?\n/);
    assert.match(calls[0], /^npx playwright test --config playwright\./);
  });

  it('extractPreviewCiFailure isolates real failures from trailing Node deprecation and NO_COLOR noise', () => {
    const raw = [
      "verify\tTest\t2026-11-16T22:31:00Z \x1b[31mFAIL\x1b[39m e2e/brand/tokens.spec.ts > card contrast",
      'Error: AssertionError: expected "#000" to equal "#fff"',
      "Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.",
      '(node:4210) DeprecationWarning: foo is deprecated',
      '(Use `node --trace-deprecation ...` to show where the warning was created)',
      "Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.",
    ].join('\n');
    const parsed = promoteHelpers.extractPreviewCiFailure(raw);
    assert.deepEqual(parsed.failing_specs, ['e2e/brand/tokens.spec.ts']);
    assert.match(parsed.summary, /e2e\/brand\/tokens\.spec\.ts/);
    assert.match(parsed.summary, /AssertionError/);
    assert.doesNotMatch(parsed.summary, /NO_COLOR|DeprecationWarning|trace-deprecation/);
  });
});

describe('OXB-C8 #2a (T59 / #917): promote keeps base fixtures unless changed by the task, and warns on older fixtures', () => {
  it('never overwrites main newer e2e/helpers/settings.ts when T59 did not edit it (keeps openSettingsPage from #908)', () => {
    const dir = initBaseRepo('oxe-c8-fixt-', {
      'e2e/helpers/settings.ts': 'export function openSettings() { return 1; }\n',
      'src/panel.ts': 'export const panel = 1;\n',
    });
    const forkSha = git(dir, ['rev-parse', 'HEAD']);

    // `main` advances (#908): adds `openSettingsPage` in shared e2e helper
    writeFiles(dir, {
      'e2e/helpers/settings.ts': 'export function openSettings() { return 1; }\nexport function openSettingsPage() { return 2; }\n',
    });
    git(dir, ['add', 'e2e/helpers/settings.ts']);
    git(dir, ['commit', '-qm', 'feat(#908): add openSettingsPage helper']);

    // Meanwhile program branch `code-f6` stayed at forkSha (older e2e/helpers/settings.ts without openSettingsPage)
    git(dir, ['checkout', '-qb', 'code-f6', forkSha]);
    writeFiles(dir, {
      'e2e/acceptance/t59.spec.ts': "import { openSettings } from '../helpers/settings';\nimport { panel } from '../../src/panel';\nexport const run = () => [openSettings(), panel];\n",
    });
    git(dir, ['add', 'e2e/acceptance/t59.spec.ts']);
    git(dir, ['commit', '-qm', 'test(acceptance): freeze T59']);

    writeFiles(dir, { 'src/panel.ts': 'export const panel = 59;\n' });
    git(dir, ['add', 'src/panel.ts']);
    git(dir, ['commit', '-qm', 'feat: T59 panel', '-m', 'OXE-Task: F6/T59']);
    const t59Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [{ id: 'T59', title: 'panel', wave: 1, files: ['src/panel.ts'], acceptance: ['A59'], done: true, done_commit: t59Sha }],
        acceptance_tests: [{ criterion: 'A59', task: 'T59', files: ['e2e/acceptance/t59.spec.ts'], command: 'npx playwright test e2e/acceptance/t59.spec.ts' }],
      }, null, 2),
    });

    const out = op.runtimePromote(dir, null, { task: 'T59', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.frozen_tests, ['e2e/acceptance/t59.spec.ts']);
    assert.ok(out.skipped_fixtures && out.skipped_fixtures.some((x) => x.file === 'e2e/helpers/settings.ts' && x.reason === 'older_than_base'));
    assert.ok(out.warnings.some((w) => w.includes('e2e/helpers/settings.ts') && /mantida a versão de main/.test(w)), out.warnings.join(' | '));
    const promotedHelper = git(dir, ['show', `${out.branch}:e2e/helpers/settings.ts`]);
    assert.match(promotedHelper, /openSettingsPage/, 'main newer openSettingsPage export must stay intact');
  });

  it('preserves cherry-pick 3-way merge (and warns) when BOTH the task commit and main changed the same fixture cleanly', () => {
    const dir = initBaseRepo('oxe-c8-fixt-merge-', {
      'e2e/helpers/settings.ts': [
        '// top section',
        'export function openSettings() { return 1; }',
        '',
        '// mid',
        'export function midHelper() { return 0; }',
        '',
        '// bottom section',
        'export function closeSettings() { return 0; }',
        '',
      ].join('\n'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const forkSha = git(dir, ['rev-parse', 'HEAD']);

    // `main` adds openSettingsPage in top section
    writeFiles(dir, {
      'e2e/helpers/settings.ts': [
        '// top section',
        'export function openSettings() { return 1; }',
        'export function openSettingsPage() { return 908; }',
        '',
        '// mid',
        'export function midHelper() { return 0; }',
        '',
        '// bottom section',
        'export function closeSettings() { return 0; }',
        '',
      ].join('\n'),
    });
    git(dir, ['add', 'e2e/helpers/settings.ts']);
    git(dir, ['commit', '-qm', 'feat(#908): add openSettingsPage at top']);

    // Task T60 adds waitForSettingsTab in bottom section + frozen test importing helper
    git(dir, ['checkout', '-qb', 'code-f6', forkSha]);
    writeFiles(dir, {
      'e2e/acceptance/t60.spec.ts': "import { waitForSettingsTab } from '../helpers/settings';\nexport const x = waitForSettingsTab();\n",
      'e2e/helpers/settings.ts': [
        '// top section',
        'export function openSettings() { return 1; }',
        '',
        '// mid',
        'export function midHelper() { return 0; }',
        '',
        '// bottom section',
        'export function closeSettings() { return 0; }',
        'export function waitForSettingsTab() { return 60; }',
        '',
      ].join('\n'),
      'src/a.ts': 'export const a = 60;\n',
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'feat: T60 helper + spec', '-m', 'OXE-Task: F6/T60']);
    const t60Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [{ id: 'T60', title: 't60', wave: 1, files: ['src/a.ts', 'e2e/helpers/settings.ts'], acceptance: ['A60'], done: true, done_commit: t60Sha }],
        acceptance_tests: [{ criterion: 'A60', task: 'T60', files: ['e2e/acceptance/t60.spec.ts'], command: 'npx playwright test e2e/acceptance/t60.spec.ts' }],
      }, null, 2),
    });

    const out = op.runtimePromote(dir, null, { task: 'T60', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    const mergedHelper = git(dir, ['show', `${out.branch}:e2e/helpers/settings.ts`]);
    assert.match(mergedHelper, /openSettingsPage/, 'main addition preserved');
    assert.match(mergedHelper, /waitForSettingsTab/, 'task addition preserved');
    assert.ok(out.warnings.some((w) => w.includes('e2e/helpers/settings.ts') && /mescla do cherry-pick/.test(w)), out.warnings.join(' | '));
  });
});

describe('OXB-C8 #2b (T56 / #914): PR enforced.lock.json = base entries + only IDs enforced by the task itself', () => {
  it('never reintroduces enforced.lock.json entries removed on main during cherry-pick conflict resolution', () => {
    const baseLock = {
      enforced: ['BRD-01.base', 'BRD-13.branch.font-family'],
      targets: {
        'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' },
        'BRD-13.branch.font-family': { status: 'enforced', selector: '[data-testid="git-branch"]' },
      },
    };
    const dir = initBaseRepo('oxe-c8-lock-conflict-', {
      'src/design/targets/enforced.lock.json': `${JSON.stringify(baseLock, null, 2)}\n`,
      'src/chip.ts': 'export const chip = 0;\n',
    });
    const forkSha = git(dir, ['rev-parse', 'HEAD']);

    // `main` removes BRD-13.branch.font-family (commit 63c517b5d equivalent)
    const mainLock = {
      enforced: ['BRD-01.base'],
      targets: {
        'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' },
      },
    };
    writeFiles(dir, { 'src/design/targets/enforced.lock.json': `${JSON.stringify(mainLock, null, 2)}\n` });
    git(dir, ['add', 'src/design/targets/enforced.lock.json']);
    git(dir, ['commit', '-qm', 'chore: temporarily drop BRD-13.branch.font-family on main']);

    // Program branch still has BRD-13 from fork; T56 adds BRD-56.chip
    git(dir, ['checkout', '-qb', 'code-f6', forkSha]);
    const t56Lock = {
      enforced: ['BRD-01.base', 'BRD-13.branch.font-family', 'BRD-56.chip'],
      targets: {
        'BRD-01.base': { status: 'enforced', selector: '[data-surface="base"]' },
        'BRD-13.branch.font-family': { status: 'enforced', selector: '[data-testid="git-branch"]' },
        'BRD-56.chip': { status: 'enforced', selector: '[data-surface="chip"]' },
      },
    };
    writeFiles(dir, {
      'src/design/targets/enforced.lock.json': `${JSON.stringify(t56Lock, null, 2)}\n`,
      'src/chip.ts': 'export const chip = 56;\n',
    });
    git(dir, ['add', 'src/design/targets/enforced.lock.json', 'src/chip.ts']);
    git(dir, ['commit', '-qm', 'feat: T56 chip enforced', '-m', 'OXE-Task: F6/T56']);
    const t56Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [{ id: 'T56', title: 'chip', wave: 1, files: ['src/chip.ts', 'src/design/targets/enforced.lock.json'], acceptance: ['A56'], done: true, done_commit: t56Sha }],
      }, null, 2),
    });

    const out = op.runtimePromote(dir, null, { task: 'T56', base: 'main', prReady: false });
    assert.equal(out.conflict, null, out.error);
    assert.equal(out.error, undefined, out.error);
    const promotedLock = JSON.parse(git(dir, ['show', `${out.branch}:src/design/targets/enforced.lock.json`]));
    assert.deepEqual(promotedLock.enforced, ['BRD-01.base', 'BRD-56.chip']);
    assert.equal(promotedLock.targets['BRD-13.branch.font-family'], undefined, 'removed entry must NOT be carried back');
    assert.ok(promotedLock.targets['BRD-01.base'] && promotedLock.targets['BRD-56.chip']);
  });

  it('reconciles enforced.lock.json even after a clean cherry-pick (replaces carried base-removed IDs with base + task-enforced only)', () => {
    const dir = initBaseRepo('oxe-c8-lock-clean-', {
      'src/design/targets/enforced.lock.json': JSON.stringify({
        enforced: ['BRD-01.base', 'BRD-02.top', 'BRD-13.branch.font-family'],
        targets: {
          'BRD-01.base': { status: 'enforced' },
          'BRD-02.top': { status: 'enforced' },
          'BRD-13.branch.font-family': { status: 'enforced' },
          'BRD-99.tail': { status: 'enforced' },
        },
      }, null, 2) + '\n',
      'src/t57.ts': 'export const t57 = 0;\n',
    });
    const forkSha = git(dir, ['rev-parse', 'HEAD']);

    // `main` removes BRD-13 at its own section without touching top/bottom lines
    writeFiles(dir, {
      'src/design/targets/enforced.lock.json': JSON.stringify({
        enforced: ['BRD-01.base', 'BRD-02.top'],
        targets: {
          'BRD-01.base': { status: 'enforced' },
          'BRD-02.top': { status: 'enforced' },
          'BRD-99.tail': { status: 'enforced' },
        },
      }, null, 2) + '\n',
    });
    git(dir, ['add', 'src/design/targets/enforced.lock.json']);
    git(dir, ['commit', '-qm', 'chore: remove BRD-13 on main']);

    // Suppose program branch still had BRD-13, and a cherry-pick or script touch puts BRD-13 + BRD-57 in the worktree cleanly:
    git(dir, ['checkout', '-qb', 'code-f6', forkSha]);
    // Pre-task commit already touched enforced.lock.json on program; T57 promotes cleanly in a separate non-conflicting key range (targets tail)
    // plus suppose an earlier quick/program entry left BRD-13 present on base+T57 via non-overlapping edit or re-add
    writeFiles(dir, {
      'src/design/targets/enforced.lock.json': JSON.stringify({
        enforced: ['BRD-01.base', 'BRD-02.top', 'BRD-13.branch.font-family', 'BRD-57.badge'],
        targets: {
          'BRD-01.base': { status: 'enforced' },
          'BRD-02.top': { status: 'enforced' },
          'BRD-13.branch.font-family': { status: 'enforced' },
          'BRD-99.tail': { status: 'enforced' },
          'BRD-57.badge': { status: 'enforced', selector: '[data-surface="badge"]' },
        },
      }, null, 2) + '\n',
      'src/t57.ts': 'export const t57 = 57;\n',
    });
    git(dir, ['add', 'src/design/targets/enforced.lock.json', 'src/t57.ts']);
    git(dir, ['commit', '-qm', 'feat: T57 badge enforced', '-m', 'OXE-Task: F6/T57']);
    const t57Sha = git(dir, ['rev-parse', 'HEAD']);

    // Simulate clean cherry-pick re-carrying stale BRD-13 directly via reconcilePromotedEnforcedLocks unit check too
    const workCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c8-wt-'));
    dirs.push(workCopy);
    git(dir, ['worktree', 'add', '-q', '--detach', workCopy, 'main']);
    const workLockPath = path.join(workCopy, 'src/design/targets/enforced.lock.json');
    fs.writeFileSync(workLockPath, JSON.stringify({
      enforced: ['BRD-01.base', 'BRD-02.top', 'BRD-13.branch.font-family', 'BRD-57.badge'],
      targets: {
        'BRD-01.base': { status: 'enforced' },
        'BRD-02.top': { status: 'enforced' },
        'BRD-13.branch.font-family': { status: 'enforced' },
        'BRD-99.tail': { status: 'enforced' },
        'BRD-57.badge': { status: 'enforced', selector: '[data-surface="badge"]' },
      },
    }, null, 2) + '\n');
    git(workCopy, ['add', 'src/design/targets/enforced.lock.json']);
    git(workCopy, ['commit', '-qm', 'simulated clean cherry-pick carrying BRD-13']);
    const mainSha = git(dir, ['rev-parse', 'main']);
    const adj = promoteHelpers.reconcilePromotedEnforcedLocks(dir, workCopy, mainSha, [t57Sha]);
    assert.equal(adj.adjusted.length, 1);
    assert.ok(adj.adjusted[0].removed_ids.includes('BRD-13.branch.font-family'));
    const reconciled = JSON.parse(fs.readFileSync(workLockPath, 'utf8'));
    assert.deepEqual(reconciled.enforced, ['BRD-01.base', 'BRD-02.top', 'BRD-57.badge']);
    assert.equal(reconciled.targets['BRD-13.branch.font-family'], undefined);
    assert.ok(reconciled.targets['BRD-57.badge']);

    // Unlink worktree cleanly before tmpdir cleanup
    git(dir, ['worktree', 'remove', '--force', workCopy]);

    // And full runtimePromote T57 check too
    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [{ id: 'T57', title: 'badge', wave: 1, files: ['src/t57.ts', 'src/design/targets/enforced.lock.json'], acceptance: ['A57'], done: true, done_commit: t57Sha }],
      }, null, 2),
    });
    const out = op.runtimePromote(dir, null, { task: 'T57', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    const prLock = JSON.parse(git(dir, ['show', `${out.branch}:src/design/targets/enforced.lock.json`]));
    assert.deepEqual(prLock.enforced, ['BRD-01.base', 'BRD-02.top', 'BRD-57.badge']);
    assert.equal(prLock.targets['BRD-13.branch.font-family'], undefined);
  });
});
