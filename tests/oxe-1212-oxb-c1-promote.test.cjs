'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-C1 P1 (#1–#4): single-task promote hardening:
//   #1 task/card OXE-Quick commits included in order (unless touching another task's file -> warns);
//   #2 lint.ratchets cap reconciled against base + task, and enforced.lock.json checked against main conformance scene;
//   #3 unpromoted task dependencies (shared files + imported symbols) listed with suggested order (--strict refuses);
//   #4 main CI risk suites (axe/a11y-surfaces, conformance, e2e) listed in PR body and executed with --preview-ci.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c1-p1-'));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  fs.mkdirSync(dir);
  git(root, 'init', '-q', '--bare', origin);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  git(dir, 'remote', 'add', 'origin', origin);
  return { dir, origin };
}

describe('OXB-C1 P1: runtime promote hardening (#1 quicks, #2 ratchets & enforced.lock, #3 unpromoted deps, #4 preview-ci & risk)', () => {
  it('#1 carries OXE-Quick commits of the task card / trailer in history order, and warns instead of carrying a quick touching another task file', () => {
    const { dir } = makeRepo();
    write(dir, 'src/ChangesPanel.tsx', 'export const ChangesPanel = () => "base";\n');
    write(dir, 'src/Skeleton.tsx', 'export const Skeleton = () => null;\n');
    write(dir, 'src/PaneHeader.tsx', 'export const PaneHeader = () => "h";\n');
    write(dir, 'shared/mcp-coverage.ts', 'export const MCP = ["a"];\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', '-b', 'oxe/f6');

    // Quick 1 before T34 checkpoint on card OXE-84 (safe: Skeleton.tsx not owned by other tasks)
    write(dir, 'src/Skeleton.tsx', 'export const Skeleton = () => "<div class=\\"sk\\"/>";\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'fix(skeleton): ChangesPanel Skeleton\n\nOXE-Quick: Q-20261115-a001\nOXE-Card: OXE-84');
    const q1 = git(dir, 'rev-parse', 'HEAD');

    // T34 checkpoint
    write(dir, 'src/ChangesPanel.tsx', 'import { Skeleton } from "./Skeleton";\nexport const ChangesPanel = () => Skeleton();\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat(f6): T34 ChangesPanel\n\nOXE-Task: F6/T34');
    const t34 = git(dir, 'rev-parse', 'HEAD');

    // Quick 2 after T34 checkpoint naming T34 (like #885 mcp-coverage)
    write(dir, 'shared/mcp-coverage.ts', 'export const MCP = ["a", "git.changedCount"];\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'fix(mcp): T34 register git.changedCount\n\nOXE-Quick: Q-20261115-a002\nOXE-Card: OXE-84');
    const q2 = git(dir, 'rev-parse', 'HEAD');

    // Quick 3 on OXE-84 that touches T33's PaneHeader.tsx -> MUST warn and NOT be carried!
    write(dir, 'src/PaneHeader.tsx', 'export const PaneHeader = () => "touched-by-foreign-quick";\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'fix(header): quick touching T33 file\n\nOXE-Quick: Q-20261115-a003\nOXE-Card: OXE-84');

    // Quick 4 on unrelated card OXE-99 -> ignored silently
    write(dir, 'src/unrelated.ts', 'export const u = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'fix: other card\n\nOXE-Quick: Q-20261115-a004\nOXE-Card: OXE-99');

    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# P\n');
    write(dir, '.oxe/config.json', '{}');
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T33', title: 'PaneHeader', wave: 1, card: 'OXE-83', files: ['src/PaneHeader.tsx'], done: false },
        { id: 'T34', title: 'ChangesPanel', wave: 2, card: 'OXE-84', files: ['src/ChangesPanel.tsx'], done: true, done_commit: t34 },
      ],
    }, null, 2));

    const out = op.runtimePromote(dir, null, { task: 'T34', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.commits, [q1, t34, q2], 'includes q1, t34, q2 in exact history order');
    assert.equal(out.skipped_quicks.length, 1);
    assert.equal(out.skipped_quicks[0].quick, 'Q-20261115-a003');
    assert.ok(out.warnings.some((w) => /Q-20261115-a003.*toca arquivo\(s\) de outra tarefa.*src\/PaneHeader\.tsx \(T33\)/.test(w)), out.warnings.join('\n'));
    assert.match(git(dir, 'show', `${out.branch}:shared/mcp-coverage.ts`), /git\.changedCount/);
    assert.equal(git(dir, 'show', `${out.branch}:src/PaneHeader.tsx`), 'export const PaneHeader = () => "h";', 'T33 file untouched');
  });

  it('#2 recalculates lint.ratchets cap against main + task (450 -> real count on main+task) and warns on enforced.lock.json scene gaps', () => {
    const { dir } = makeRepo();
    // main has 4 raw <button>s across two files (cap = 4)
    write(dir, 'src/OtherPanel.tsx', 'export const A = () => "<div><button>1</button><button>2</button></div>";\n');
    write(dir, 'src/ChangesPanel.tsx', 'export const B = () => "<div><button>3</button><button>4</button></div>";\n');
    write(dir, 'tests/design-lint.test.ts', 'const RAW_BUTTON_CAP = 4;\n');
    write(dir, 'tests/brand-conformance.scene.tsx', '<div data-surface="panel" />\n');
    write(dir, 'tests/enforced.lock.json', JSON.stringify({
      targets: {
        'BRD-13.panel.bg': { status: 'enforced', selector: '[data-surface="panel"]' },
        'BRD-13.branch.font-family': { status: 'pending', selector: '[data-testid="git-branch"]' },
      },
    }, null, 2));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', '-b', 'oxe/f6');

    // Unpromoted T31 removes 2 buttons in OtherPanel -> program count drops to 2
    write(dir, 'src/OtherPanel.tsx', 'export const A = () => "<div/>";\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T31 remove buttons\n\nOXE-Task: F6/T31');
    const t31 = git(dir, 'rev-parse', 'HEAD');

    // T34 removes 1 button in ChangesPanel (leaving 1 there; program total = 1, but main + T34 has 2 + 1 = 3!)
    // and promotes BRD-13.branch.font-family to enforced even though main's conformance scene has no git-branch
    write(dir, 'src/ChangesPanel.tsx', 'export const B = () => "<div><button>4</button></div>";\n');
    write(dir, 'tests/design-lint.test.ts', 'const RAW_BUTTON_CAP = 1;\n');
    write(dir, 'tests/enforced.lock.json', JSON.stringify({
      targets: {
        'BRD-13.panel.bg': { status: 'enforced', selector: '[data-surface="panel"]' },
        'BRD-13.branch.font-family': { status: 'enforced', selector: '[data-testid="git-branch"]' },
      },
    }, null, 2));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T34 buttons & lock\n\nOXE-Task: F6/T34');
    const t34 = git(dir, 'rev-parse', 'HEAD');

    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# P\n');
    write(dir, '.oxe/config.json', JSON.stringify({
      lint: {
        ratchets: [{
          file: 'tests/design-lint.test.ts',
          pattern: 'RAW_BUTTON_CAP = (\\d+)',
          counts: '<button\\b',
          paths: ['src/**/*.tsx'],
          direction: 'down',
        }],
      },
    }, null, 2));
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T31', title: 'other', wave: 1, files: ['src/OtherPanel.tsx'], done: true, done_commit: t31 },
        { id: 'T34', title: 'changes', wave: 2, files: ['src/ChangesPanel.tsx', 'tests/design-lint.test.ts', 'tests/enforced.lock.json'], done: true, done_commit: t34 },
      ],
    }, null, 2));

    const out = op.runtimePromote(dir, null, { task: 'T34', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.ratchets_adjusted.length, 1);
    assert.equal(out.ratchets_adjusted[0].program_cap, 1);
    assert.equal(out.ratchets_adjusted[0].promoted_cap, 3, 'main (2 in OtherPanel) + T34 (1 in ChangesPanel) = 3');
    assert.equal(git(dir, 'show', `${out.branch}:tests/design-lint.test.ts`), 'const RAW_BUTTON_CAP = 3;');

    assert.equal(out.enforced_scene_gaps.length, 1);
    assert.equal(out.enforced_scene_gaps[0].id, 'BRD-13.branch.font-family');
    assert.equal(out.enforced_scene_gaps[0].proposed_status, 'pending');
    assert.ok(out.warnings.some((w) => /BRD-13\.branch\.font-family.*measured no element.*pending/.test(w)), out.warnings.join('\n'));
  });

  it('#3 & #4 detects unpromoted imported symbol dependencies (T33 -> T34, --strict refuses) and runs/lists main CI risk suites (--preview-ci)', () => {
    const { dir } = makeRepo();
    write(dir, 'src/PaneHeader.tsx', 'export function PaneHeader() { return "old"; }\n');
    write(dir, 'src/ChangesPanel.tsx', 'export function ChangesPanel() { return "old"; }\n');
    write(dir, 'tests/a11y-surfaces.test.ts', '// axe check for Changes panel section\nprocess.exit(0);\n');
    write(dir, 'e2e/changes-panel.spec.ts', '// opens ChangesPanel in electron\nprocess.exit(0);\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-q', '-b', 'oxe/f6');

    // T33 adds compact prop/helper to PaneHeader
    write(dir, 'src/PaneHeader.tsx', 'export function PaneHeader() { return "new"; }\nexport const PANE_HEADER_COMPACT = true;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T33 PaneHeader\n\nOXE-Task: F6/T33');
    const t33 = git(dir, 'rev-parse', 'HEAD');

    // T34 imports PANE_HEADER_COMPACT from PaneHeader (without declaring depends_on: ['T33'])
    write(dir, 'src/ChangesPanel.tsx', 'import { PaneHeader, PANE_HEADER_COMPACT } from "./PaneHeader";\nexport function ChangesPanel() { return PANE_HEADER_COMPACT ? PaneHeader() : ""; }\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: T34 ChangesPanel\n\nOXE-Task: F6/T34');
    const t34 = git(dir, 'rev-parse', 'HEAD');

    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# P\n');
    write(dir, '.oxe/config.json', JSON.stringify({
      promote: {
        preview_ci_command: 'node -e "process.exit(0)" --',
      },
    }, null, 2));
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T33', title: 'PaneHeader', wave: 1, files: ['src/PaneHeader.tsx'], done: true, done_commit: t33 },
        { id: 'T34', title: 'ChangesPanel', wave: 2, files: ['src/ChangesPanel.tsx'], done: true, done_commit: t34 },
      ],
    }, null, 2));

    // --strict refuses when T33 is unpromoted
    const strictCli = spawnSync(process.execPath, [CLI, 'runtime', 'promote', 'T34', '--base', 'main', '--strict', '--no-pr-ready', '--dir', dir], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(strictCli.status, 0);
    assert.match(strictCli.stderr + strictCli.stdout, /T33.*PANE_HEADER_COMPACT.*ordem sugerida: T33 (?:→|->) T34/);

    // Without --strict: warns with suggested order, lists CI risk suites in PR body, and --preview-ci executes them
    const out = op.runtimePromote(dir, null, { task: 'T34', base: 'main', prReady: false, previewCi: true });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.suggested_promote_order, ['T33', 'T34']);
    assert.ok(out.ci_risk_suites.some((s) => s.suite === 'tests/a11y-surfaces.test.ts' && s.kind === 'a11y'));
    assert.ok(out.ci_risk_suites.some((s) => s.suite === 'e2e/changes-panel.spec.ts' && s.kind === 'e2e'));
    assert.equal(out.preview_ci.ok, true);
    const body = fs.readFileSync(path.join(dir, out.body_file), 'utf8');
    assert.match(body, /Ordem sugerida de promoção: T33 → T34/);
    assert.match(body, /tests\/a11y-surfaces\.test\.ts/);
    assert.match(body, /e2e\/changes-panel\.spec\.ts/);
  });
});
