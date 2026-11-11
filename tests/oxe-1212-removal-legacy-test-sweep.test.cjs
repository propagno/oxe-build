'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const pb = require('../bin/lib/oxe-plan-build.cjs');
const ic = require('../bin/lib/oxe-integration-checks.cjs');
const op = require('../bin/lib/oxe-operational.cjs');
const guard = require('../bin/lib/oxe-guard.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const { validatePackTask } = require('../bin/lib/oxe-rationality.cjs');

// 1.21.2 — OXB-206:
//   (1) Automatic sweep of legacy `tests/**`, `e2e/**`, `appMenus.ts`, and `docs/security/threat-model-*.md`
//       on removal tasks in `oxe-plan-build.cjs`, attaching them to `edited_paths` and `gates`.
//   (2) Block Git-tracked `tests/acceptance/parked-*` directories in PR / pre-push gates.

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

function makeF2Project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sweep-'));
  dirs.push(dir);

  write(dir, '.oxe/STATE.md', '# S\n');
  write(
    dir,
    '.oxe/SPEC.md',
    '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A13 | sem work | t |\n| A15 | sem pod/team | t |\n| A20 | sem fs:write-file | t |\n'
  );
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 2 — Removals\n\n**Critérios de aceite:** A13, A15, A20\n');
  write(dir, '.oxe/config.json', '{}');

  // Production modules to be deleted or edited in F2
  write(
    dir,
    'electron/main/services/work/index.ts',
    "export function spawnAgentWork() { return 'ok'; }\nexport const WORK_CHANNEL = 'agent-work:spawn';\n"
  );
  write(dir, 'src/components/OxePod/PodPanel.tsx', 'export function PodPanel() { return null; }\n');
  write(dir, 'src/components/Team/TeamPanel.tsx', 'export function TeamPanel() { return null; }\n');
  write(
    dir,
    'electron/main/ipc/file-system.ipc.ts',
    "export function registerFsIpc(ipcMain: any) { ipcMain.handle('fs:read-file', () => {}); ipcMain.handle('fs:write-file', () => {}); }\n"
  );

  // Navigation menu registry still referencing `'tool-team'`
  write(
    dir,
    'src/components/Navigation/appMenus.ts',
    "export const APP_MENUS = [{ id: 'tool-code' }, { id: 'tool-team' }];\n"
  );

  // Security threat model doc referencing deleted service and removed IPC channel
  write(
    dir,
    'docs/security/threat-model-1.4.md',
    '# Threat Model 1.4\n\n- `electron/main/services/work` runs background jobs.\n- Channel `fs:write-file` writes arbitrary workspace files.\n'
  );
  write(dir, 'docs/security/threat-model-network.md', '# Network\n\n- HTTPS only.\n');

  // Frozen F2 acceptance test (MUST NOT be swept into edited_paths!)
  write(
    dir,
    'tests/acceptance/f2/r13-no-work.test.ts',
    "import { describe, it } from 'vitest';\ndescribe('R13', () => { it('work foi removido', () => {}); });\n"
  );

  // Legacy 1.4 unit / integration suites in `tests/**`
  write(
    dir,
    'tests/integration/agent-work.test.ts',
    "import { spawnAgentWork } from '../../electron/main/services/work';\nspawnAgentWork();\n"
  );
  write(
    dir,
    'tests/unit/file-system.service.test.ts',
    "import { describe, it } from 'vitest';\ndescribe('fs', () => { it('invokes fs:write-file', () => { const ch = 'fs:write-file'; return ch; }); });\n"
  );
  write(
    dir,
    'tests/unit/unrelated.test.ts',
    "import { describe, it } from 'vitest';\ndescribe('math', () => { it('adds', () => {}); });\n"
  );

  // Legacy E2E specs in `e2e/**`
  write(
    dir,
    'e2e/oxepod-lifecycle.spec.ts',
    "import { test } from '@playwright/test';\ntest('opens oxepod view', async () => {});\n"
  );
  write(
    dir,
    'e2e/ipc-sender-guard.spec.ts',
    "import { test } from '@playwright/test';\ntest('guards fs:write-file sender', async () => { const c = 'fs:write-file'; return c; });\n"
  );
  write(
    dir,
    'e2e/unrelated-smoke.spec.ts',
    "import { test } from '@playwright/test';\ntest('renders shell', async () => {});\n"
  );

  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base 1.4');
  return dir;
}

describe('OXB-206: automatic sweep of legacy tests, e2e, appMenus.ts and threat-model docs on removal tasks', () => {
  it('attaches impacted legacy tests, e2e specs, appMenus.ts, and threat-model-*.md to edited_paths and gates while keeping frozen acceptance tests untouched', () => {
    const dir = makeF2Project();
    const roleFile = 'roles/f2-removals.json';
    write(dir, roleFile, {
      role: 'fullstack',
      acceptance_tests: [
        {
          criterion: 'A13',
          files: ['tests/acceptance/f2/r13-no-work.test.ts'],
          command: 'npx vitest run tests/acceptance/f2/r13-no-work.test.ts',
          proves: ['work foi removido'],
        },
      ],
      tasks: [
        {
          rid: 'R13',
          title: 'Remover servico agent work',
          kind: 'remove',
          deleted: ['electron/main/services/work'],
          verify: { commands: ['npx vitest run tests/acceptance/f2/r13-no-work.test.ts'] },
          acceptance: ['A13'],
        },
        {
          rid: 'R15',
          title: "Remover modos OxePod e 'tool-team'",
          kind: 'remove',
          deleted: ['src/components/OxePod/PodPanel.tsx', 'src/components/Team/TeamPanel.tsx'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A15'],
        },
        {
          rid: 'FE-G5',
          title: "Remover canal IPC 'fs:write-file' legado",
          kind: 'remove',
          edited: ['electron/main/ipc/file-system.ipc.ts'],
          symbols_removed: [{ name: 'registerFsWriteFile', path: 'electron/main/ipc/file-system.ipc.ts' }],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A20'],
        },
      ],
    });

    const buildCli = spawnSync(
      process.execPath,
      [CLI, 'plan', 'build', '--from', roleFile, '--phase', 'F2', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true }
    );
    assert.equal(buildCli.status, 0, buildCli.stdout + buildCli.stderr);

    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const pack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.deepEqual(planJson.validatePlanJson(plan), []);

    const r13 = plan.tasks.find((t) => t.rid === 'R13');
    const r15 = plan.tasks.find((t) => t.rid === 'R15');
    const g5 = plan.tasks.find((t) => t.rid === 'FE-G5');

    // R13 swept legacy integration test + threat-model-1.4.md, NOT frozen acceptance test or unrelated test
    assert.ok(r13.edited_paths.includes('tests/integration/agent-work.test.ts'));
    assert.ok(r13.edited_paths.includes('docs/security/threat-model-1.4.md'));
    assert.ok(r13.files.includes('tests/integration/agent-work.test.ts'));
    assert.ok(!r13.files.includes('tests/acceptance/f2/r13-no-work.test.ts'), 'frozen test excluded from scope');
    assert.ok(!r13.files.includes('tests/unit/unrelated.test.ts'));
    assert.ok(!r13.files.includes('docs/security/threat-model-network.md'));
    assert.ok(r13.verify.commands.some((c) => c.includes('tests/integration/agent-work.test.ts')));
    assert.ok(r13.gates.some((g) => g.includes('tests/integration/agent-work.test.ts')));

    // R15 swept appMenus.ts (`'tool-team'`) and e2e/oxepod-lifecycle.spec.ts
    assert.ok(r15.edited_paths.includes('src/components/Navigation/appMenus.ts'));
    assert.ok(r15.edited_paths.includes('e2e/oxepod-lifecycle.spec.ts'));
    assert.ok(!r15.files.includes('e2e/unrelated-smoke.spec.ts'));
    assert.ok(r15.gates.some((g) => g.includes('e2e/oxepod-lifecycle.spec.ts')));

    // FE-G5 (channel removal without file deletion) swept file-system.service.test.ts, ipc-sender-guard.spec.ts, and threat-model-1.4.md
    assert.ok(g5.edited_paths.includes('tests/unit/file-system.service.test.ts'));
    assert.ok(g5.edited_paths.includes('e2e/ipc-sender-guard.spec.ts'));
    assert.ok(g5.edited_paths.includes('docs/security/threat-model-1.4.md'));
    assert.ok(g5.verify.commands.some((c) => c.includes('tests/unit/file-system.service.test.ts')));
    assert.ok(g5.gates.some((g) => g.includes('e2e/ipc-sender-guard.spec.ts')));

    // Phase gates include legacy-tests and legacy-e2e
    const gateIds = (plan.phase_gates || []).map((g) => g.id);
    assert.ok(gateIds.includes('legacy-tests'));
    assert.ok(gateIds.includes('legacy-e2e'));

    // Pack entries include swept files in exact_paths / edited_paths without triggering missing-symbol gaps
    for (const pt of pack.tasks) {
      const check = validatePackTask(pt);
      assert.deepEqual(check.gaps, [], `unexpected pack gaps for ${pt.id}: ${check.gaps.join('; ')}`);
    }
  });
});

describe('OXB-206: block Git-tracked `tests/acceptance/parked-*` in PR / promote / pre-push gates', () => {
  it('blocks integration checks, pre-push, guard git push, and runtime promote when parked-* is tracked by Git, and passes once untracked', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-parked-'));
    dirs.push(dir);

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'core.autocrlf', 'false');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');

    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'src/feature.ts', 'export const f = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base on main');

    git(dir, 'checkout', '-qb', 'oxe/f2-cockpit');
    write(dir, 'src/feature.ts', 'export const f = 2;\n');
    // Mistakenly commit a parked F3 suite into T1's commit on oxe/f2-cockpit
    write(dir, 'tests/acceptance/parked-f3/u31-future.test.ts', "it('future f3 test', () => {});\n");
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T1 cockpit cleanup', '-m', 'OXE-Task: F2/T1');
    const badSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/config.json', '{}');
    write(dir, '.oxe/program/program.json', { active_phase: 'F2', phases: [{ id: 'F2', status: 'executing' }] });
    write(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F2',
      tasks: [{ id: 'T1', title: 'cockpit cleanup', wave: 1, files: ['src/feature.ts'], done: true, done_commit: badSha }],
    });

    // 1. Integration checks catch tracked tests/acceptance/parked-f3
    const icRed = ic.runIntegrationChecks(dir);
    assert.equal(icRed.ok, false);
    assert.deepEqual(icRed.failed.parked_dirs, ['tests/acceptance/parked-f3']);

    // 2. CLI `oxe-cc runtime pre-push` blocks the push
    const mainSha = git(dir, 'rev-parse', 'main').stdout.trim();
    const prePushRed = spawnSync(
      process.execPath,
      [CLI, 'runtime', 'pre-push', '--dir', dir],
      {
        cwd: dir,
        input: `refs/heads/oxe/f2-cockpit ${badSha} refs/heads/oxe/f2-cockpit ${mainSha}\n`,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    assert.equal(prePushRed.status, 1);
    assert.match(prePushRed.stderr, /tests\/acceptance\/parked-f3/);

    // 3. Tool guard (`oxe-guard.cjs`) blocks `git push` when parked-* is tracked
    const guardDecision = guard.decide(
      { tool_name: 'Bash', tool_input: { command: 'git push -u origin oxe/f2-cockpit' }, cwd: dir },
      { root: dir, config: {} }
    );
    assert.equal(guardDecision.block, true);
    assert.equal(guardDecision.rule, 'parked_acceptance_tracked');

    // 4. `runtime promote T1 --base main` blocks the PR branch before push / PR creation
    const promRed = op.runtimePromote(dir, null, { task: 'T1', base: 'main' });
    assert.ok(promRed.error, 'runtimePromote must return an error when parked-* is tracked');
    assert.match(promRed.error, /tests\/acceptance\/parked-f3/);

    // 5. Once removed from Git tracking (left untracked on disk, ignored via .gitignore), all gates pass!
    write(dir, '.gitignore', '.oxe/\ntests/acceptance/parked-*/\n');
    git(dir, 'rm', '-r', '--cached', '-q', 'tests/acceptance/parked-f3');
    git(dir, 'add', '.gitignore');
    git(dir, 'commit', '--amend', '-qm', 'feat: T1 cockpit cleanup', '-m', 'OXE-Task: F2/T1');
    const cleanSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    write(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F2',
      tasks: [{ id: 'T1', title: 'cockpit cleanup', wave: 1, files: ['src/feature.ts'], done: true, done_commit: cleanSha }],
    });

    assert.equal(fs.existsSync(path.join(dir, 'tests/acceptance/parked-f3/u31-future.test.ts')), true, 'file still on disk locally, untracked');
    assert.equal(ic.runIntegrationChecks(dir).ok, true);
    assert.equal(ic.checkPrePush(dir).ok, true);
    const promGreen = op.runtimePromote(dir, null, { task: 'T1', base: 'main', branch: 'oxe/promote-t1-clean' });
    assert.equal(promGreen.error, undefined, promGreen.error);
  });
});
