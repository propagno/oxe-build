'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

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

function initRepo(prefix, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  git(root, ['init', '-q', '--bare', origin]);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@oxe.local']);
  git(dir, ['config', 'user.name', 'OXE Test']);
  writeFiles(dir, {
    '.gitignore': '.oxe/\nnode_modules/\n',
    'package.json': JSON.stringify({ name: 'c6-p1-repo', version: '1.0.0' }, null, 2),
    ...files,
  });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['remote', 'add', 'origin', origin]);
  git(dir, ['push', '-q', 'origin', 'main']);
  return { root, origin, dir };
}

describe('OXB-C6 P1 #1: extended G45 across all active repo tests, executor prompt, and --preview-ci', () => {
  it('catches ARIA role, selector, and locale catalog conflicts in active unit/integration/e2e specs, guides executor in-scope, and runs via --preview-ci', () => {
    const { dir } = initRepo('oxe-c6-g45-', {
      'src/SidebarNav.tsx': 'export function SidebarNav() { return "<nav role=\\"tablist\\" data-testid=\\"legacy-nav\\">Branches</nav>"; }\n',
      'shared/locales/pt-BR.json': '{"nav":{"branches":"Branches"}}\n',
      'tests/unit/sidebar-in-scope.test.ts': [
        "import assert from 'node:assert/strict';",
        "// in-scope unit spec asserting old role",
        "const html = getByRole('tablist');",
        'assert.ok(html);',
      ].join('\n') + '\n',
      'tests/integration/sidebar-a11y.test.mjs': [
        "const { test } = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const fs = require('fs');",
        "test('legacy selector absent after refactor breaks if old', () => {",
        "  const el = getByTestId('legacy-nav');",
        "  assert.ok(el || expect(page.locator('[data-testid=\"legacy-nav\"]')).toBeVisible());",
        '});',
      ].join('\n') + '\n',
      'tests/integration/clean-ci-runner.test.mjs': [
        "const { test } = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const fs = require('fs');",
        "const path = require('path');",
        "test('checks SidebarNav runtime without legacy-nav', () => {",
        "  const src = fs.readFileSync(path.join(process.cwd(), 'src/SidebarNav.tsx'), 'utf8');",
        "  if (src.includes('legacy-nav')) assert.fail('legacy-nav still present on main!');",
        '});',
      ].join('\n') + '\n',
      'tests/unit/catalog-strings.test.ts': [
        "const label = 'Branches';",
        "expect(screen.getByText('Branches')).toBeVisible();",
      ].join('\n') + '\n',
      'tests/acceptance/parked-f9/future.test.ts': [
        "const role = getByRole('tablist');",
        'expect(role).toBeVisible();',
      ].join('\n') + '\n',
      '.oxe/SPEC.md': '# SPEC\n\n| ID | Critério | Verificação |\n|---|---|---|\n| A1 | Troca role="tablist" por role="navigation", remove `data-testid="legacy-nav"` e renomeia `"Branches"` -> `"Worktrees"` | node |\n',
      '.oxe/STATE.md': '# STATE\n',
      '.oxe/PLAN.md': '# PLAN\n\n### T10 — IA e navegação\n',
    });

    git(dir, ['checkout', '-q', '-b', 'oxe/program-f6']);
    writeFiles(dir, {
      'src/SidebarNav.tsx': 'export function SidebarNav() { return "<nav role=\\"navigation\\" data-testid=\\"worktree-nav\\">Worktrees</nav>"; }\n',
      'shared/locales/pt-BR.json': '{"nav":{"branches":"Worktrees"}}\n',
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'feat: T10 refactor nav IA\n\nOXE-Task: F6/T10']);
    const t10Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/config.json': JSON.stringify({
        external_dependency_check: false,
        lint: {
          suite_impact: 'off',
        },
        promote: {
          preview_ci_command: 'node --test',
        },
      }, null, 2),
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [
          {
            id: 'T10',
            title: 'Troca role="tablist" para role="navigation" e remove data-testid="legacy-nav"',
            wave: 1,
            acceptance: ['A1'],
            files: ['src/SidebarNav.tsx', 'shared/locales/pt-BR.json', 'tests/unit/sidebar-in-scope.test.ts'],
            notes: 'Troca de "Branches" -> "Worktrees" na navegação principal.',
            verify: { commands: ['node -e "process.exit(0)"'] },
            done: false,
            done_commit: t10Sha,
          },
        ],
      }, null, 2),
    });

    const lint = op.runtimePlanLint(dir, null, { precheckTests: false });
    const g45 = lint.warnings.filter((w) => w.includes('[G45]'));
    assert.ok(g45.some((w) => /tests\/unit\/sidebar-in-scope\.test\.ts:\d+ →/.test(w)), `expected in-scope unit ARIA conflict: ${g45.join('\n')}`);
    assert.ok(g45.some((w) => /tests\/integration\/sidebar-a11y\.test\.mjs:\d+ →/.test(w)), `expected integration selector conflict: ${g45.join('\n')}`);
    assert.ok(g45.some((w) => /tests\/unit\/catalog-strings\.test\.ts:\d+ →/.test(w)), `expected locale string conflict: ${g45.join('\n')}`);
    assert.ok(!g45.some((w) => w.includes('parked-f9')), 'parked tests must remain excluded');

    // Executor context tells the executor to adjust in-scope specs during the run
    const provider = op.buildNodeContextProvider(dir, null);
    const nodeCtx = provider({ id: 'T10', mutation_scope: ['src/SidebarNav.tsx', 'tests/unit/sidebar-in-scope.test.ts'], depends_on: [], verify: { acceptance_refs: ['A1'] } }, { root_path: dir });
    assert.ok(nodeCtx.lessons.some((l) => l.includes('Spec no escopo afetado') && l.includes('sidebar-in-scope.test.ts')), `expected executor prompt guidance, got: ${nodeCtx.lessons.join('\n')}`);

    // Mark T10 done and check promote --preview-ci includes discovered active G45 tests
    const planDone = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDone.tasks[0].done = true;
    // Also remove `legacy-nav` token assert conflict from clean-ci-runner by pointing T10 notes to also affect sidebar-a11y
    writeFiles(dir, { '.oxe/PLAN.json': JSON.stringify(planDone, null, 2) });

    const promo = op.runtimePromote(dir, null, { task: 'T10', base: 'main', prReady: false, previewCi: true });
    assert.ok(promo.preview_ci, 'preview_ci must run when --preview-ci is set');
    assert.ok(promo.preview_ci.suites.includes('tests/integration/sidebar-a11y.test.mjs'), `expected G45-discovered spec in preview-ci suites: ${promo.preview_ci.suites.join(', ')}`);
    assert.equal(promo.preview_ci.ok, false, 'G45-discovered red spec in promote worktree must fail preview-ci');
    assert.match(promo.error || '', /preview-ci vermelho/);
  });
});

describe('OXB-C6 P1 #2: empty_checkpoint resolved by last commit touching scope after verify passes', () => {
  it('marks Tn done with the prior commit touching task.files and emits delivered-by event, while keeping empty_checkpoint on CR reopen or dirty leftovers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c6-emptycp-'));
    dirs.push(dir);
    writeFiles(dir, {
      '.gitignore': '.oxe/\n',
      '.oxe/STATE.md': '# S\n',
      '.oxe/SPEC.md': '# SPEC\n\n| ID | Critério | Verificação |\n|---|---|---|\n| A1 | x | manual |\n',
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/config.json': JSON.stringify({ external_dependency_check: false, stub_check: false }, null, 2),
      'src/shared.ts': 'export const v = 0;\n',
      'src/follow.ts': 'export const f = 0;\n',
    });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'init']);

    // Prior commit (e.g. T36) already delivered the fix inside `src/shared.ts`
    writeFiles(dir, { 'src/shared.ts': 'export const v = 42;\n' });
    git(dir, ['add', 'src/shared.ts']);
    git(dir, ['commit', '-qm', 'feat: T36 updates shared value\n\nOXE-Task: F6/T36']);
    const t36Sha = git(dir, ['rev-parse', 'HEAD']);

    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [
          { id: 'T38', title: 'confirm shared value', wave: 1, files: ['src/shared.ts'], verify: { commands: ['node -e "process.exit(0)"'] } },
          { id: 'T39', title: 'follow-up task', wave: 2, depends_on: ['T38'], files: ['src/follow.ts'], verify: { commands: ['node -e "process.exit(0)"'] } },
        ],
      }, null, 2),
    });

    const noopThenFollowExecutor = {
      async execute(node) {
        if (node.id === 'T39') writeFiles(dir, { 'src/follow.ts': 'export const f = 1;\n' });
        return { success: true, failure_class: null, evidence: node.files || [], output: 'ok', completed_by: 'finish_task' };
      },
    };

    const res = await op.runRuntimeExecute(dir, null, {
      executor: noopThenFollowExecutor,
      skipPreflight: true,
      checkpointCommits: true,
    });
    assert.equal(res.result.status, 'completed', `expected execute to continue and complete, got: ${JSON.stringify(res.result)}`);
    const planAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t38 = planAfter.tasks.find((t) => t.id === 'T38');
    const t39 = planAfter.tasks.find((t) => t.id === 'T39');
    assert.equal(t38.done, true);
    assert.equal(t38.done_commit, t36Sha);
    assert.equal(t39.done, true);
    const gateEv = op.readEvents(dir, null).find((e) => e.type === 'GateResolved' && e.work_item_id === 'T38' && e.payload && e.payload.already_delivered);
    assert.ok(gateEv, 'expected GateResolved event recording prior delivery commit');
    assert.match(gateEv.payload.note, new RegExp(`entregue por ${t36Sha.slice(0, 8)} \\(T36\\)`));

    // Reopened by open CR with no diff still blocks as empty_checkpoint
    const progDir = path.join(dir, '.oxe', 'program');
    fs.mkdirSync(progDir, { recursive: true });
    require('../bin/lib/oxe-change.cjs').appendNdjson(require('../bin/lib/oxe-change.cjs').changesFile(progDir), {
      kind: 'cr',
      id: 'CR-99',
      status: 'open',
      phase: 'F6',
      tasks: ['T40'],
      summary: 'reopened task must change code',
    });
    writeFiles(dir, {
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        tasks: [
          { id: 'T40', title: 'cr task', wave: 1, files: ['src/shared.ts'], verify: { commands: ['node -e "process.exit(0)"'] } },
        ],
      }, null, 2),
    });
    const resCr = await op.runRuntimeExecute(dir, null, {
      executor: noopThenFollowExecutor,
      skipPreflight: true,
      checkpointCommits: true,
    });
    assert.equal(resCr.result.checkpoint_failed[0].kind, 'empty_checkpoint');
  });
});

describe('OXB-C6 P1 #3: runtime promote --tests-only', () => {
  it('promotes only frozen acceptance tests + local fixtures without cherry-picking code commits, preserving Fecha <KEY>', () => {
    const { dir } = initRepo('oxe-c6-testsonly-', {
      'src/feature.ts': 'export const ready = true;\n', // code already merged on main by another PR (#855)
      'package.json': JSON.stringify({ name: 'c6-testsonly', version: '1.0.0' }, null, 2),
    });

    git(dir, ['checkout', '-q', '-b', 'oxe/program-f6']);
    writeFiles(dir, {
      'src/other.ts': 'export const other = 1;\n',
      'tests/acceptance/fixtures/seed.json': '{"ok":true}\n',
      'tests/acceptance/t50-feature.test.ts': [
        "import seed from './fixtures/seed.json';",
        'export const check = () => seed.ok;',
      ].join('\n') + '\n',
    });
    git(dir, ['add', 'src/other.ts', 'tests/acceptance/fixtures/seed.json', 'tests/acceptance/t50-feature.test.ts']);
    git(dir, ['commit', '-qm', 'feat: program branch tests + other code\n\nOXE-Task: F6/T50']);

    const progDir = path.join(dir, '.oxe', 'program');
    fs.mkdirSync(progDir, { recursive: true });
    writeFiles(dir, {
      '.oxe/STATE.md': '# STATE\n',
      '.oxe/PLAN.md': '# PLAN\n',
      '.oxe/config.json': JSON.stringify({
        external_dependency_check: false,
        alm: { provider: 'jira', project: 'OXE' },
      }, null, 2),
      '.oxe/program/PROGRAM.json': JSON.stringify({ schema_version: 1, active_phase: 'F6', phases: [{ id: 'F6', title: 'F6', status: 'executing', acceptance: ['A50'] }] }, null, 2),
      '.oxe/program/alm-links.ndjson': [
        JSON.stringify({ ref: 'F6-T50', key: 'OXE-250' }),
        JSON.stringify({ ref: 'F6-T51', key: 'OXE-250' }),
      ].join('\n') + '\n',
      '.oxe/PLAN.json': JSON.stringify({
        schema_version: 1,
        phase: 'F6',
        acceptance_tests: [
          { criterion: 'A50', task: 'T50', files: ['tests/acceptance/t50-feature.test.ts'], command: 'node -e "process.exit(0)"' },
        ],
        tasks: [
          { id: 'T50', title: 't50', wave: 1, acceptance: ['A50'], files: ['src/feature.ts', 'src/other.ts'], done: true },
          { id: 'T51', title: 't51', wave: 1, acceptance: ['A50'], files: ['src/feature.ts'], done: true },
        ],
      }, null, 2),
    });

    const out = op.runtimePromote(dir, null, { tasks: 'T50,T51', base: 'main', testsOnly: true, prReady: false });
    assert.equal(out.tests_only, true);
    assert.deepEqual(out.commits, [], 'code commits must be skipped under --tests-only');
    assert.deepEqual(out.frozen_tests.sort(), ['tests/acceptance/fixtures/seed.json', 'tests/acceptance/t50-feature.test.ts']);
    const filesOnPromoteBranch = git(dir, ['ls-tree', '-r', '--name-only', out.branch]).split(/\r?\n/);
    assert.ok(!filesOnPromoteBranch.includes('src/other.ts'), 'code commits must not leak onto --tests-only branch');
    assert.ok(filesOnPromoteBranch.includes('tests/acceptance/t50-feature.test.ts'));
    assert.ok(filesOnPromoteBranch.includes('tests/acceptance/fixtures/seed.json'));
    const body = fs.readFileSync(path.join(dir, out.body_file), 'utf8');
    assert.match(body, /^Fecha OXE-250$/m, `expected Fecha OXE-250 in PR body:\n${body}`);

    // When no frozen tests differ from base, --tests-only fails explicitly
    git(dir, ['checkout', '-q', 'main']);
    writeFiles(dir, {
      'tests/acceptance/fixtures/seed.json': '{"ok":true}\n',
      'tests/acceptance/t50-feature.test.ts': [
        "import seed from './fixtures/seed.json';",
        'export const check = () => seed.ok;',
      ].join('\n') + '\n',
    });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'main already has frozen test']);
    git(dir, ['push', '-q', 'origin', 'main']);
    git(dir, ['checkout', '-q', 'oxe/program-f6']);
    assert.throws(() => op.runtimePromote(dir, null, { task: 'T50', base: 'main', testsOnly: true, prReady: false }), /nenhum teste congelado.*--tests-only/);
  });
});
