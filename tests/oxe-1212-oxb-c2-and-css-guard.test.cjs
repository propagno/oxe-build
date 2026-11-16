'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const change = require('../bin/lib/oxe-change.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');
const recovery = require('../bin/lib/oxe-recovery.cjs');
const domHooks = require('../bin/lib/oxe-dom-hooks.cjs');

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function writeRel(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

describe('OXB-C2 (active F6 blocker) & Adendo 2 CSS classes guard (G14 / G48)', () => {
  it('OXB-C2 #1: spec freeze --cr stamps amended SPEC versions (v2 / v3) even for newly frozen files, and constraint CRs do not bump SPEC version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-c2-1-'));
    tmpDirs.push(dir);

    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    writeRel(dir, '.oxe/config.json', { external_dependency_check: false, plan_lint_preflight: false, lint: { suite_impact: 'off', cross_card_conflicts: 'off' } });
    writeRel(dir, '.oxe/SPEC.md', [
      '# SPEC',
      '',
      '## Objetivo',
      'F6 UI polish.',
      '',
      '## Critérios de aceite',
      '| ID | Critério | Como verificar |',
      '|---|---|---|',
      '| A30 | Session location esconde chip main | `npx playwright test e2e/session-location.spec.ts` |',
      '| A33 | Settings 9 seções sem plain | `npx vitest run tests/oxe152/oxe-130.test.tsx` |',
      '',
    ].join('\n'));
    writeRel(dir, '.oxe/program/PROGRAM.json', {
      schema_version: 1,
      active_phase: 'F6',
      phases: [{ id: 'F6', title: 'F6', status: 'executing', acceptance: ['A30', 'A33'] }],
    });
    const programDir = path.join(dir, '.oxe', 'program');
    // Simulate A30 bumped to v3 and A33 bumped to v2 by earlier CRs
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-F6-21', class: 'spec_gap', status: 'open', phase: 'F6', criteria: ['A30'], amend_to: 2, summary: 'first amend', at: '2026-11-16T01:00:00Z' });
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-F6-24', class: 'spec_gap', status: 'open', phase: 'F6', criteria: ['A30'], amend_to: 3, summary: 'second amend', at: '2026-11-16T02:00:00Z' });
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-F6-22', class: 'spec_gap', status: 'open', phase: 'F6', criteria: ['A33'], amend_to: 2, summary: 'plain removed', at: '2026-11-16T02:10:00Z' });
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-F6-25', class: 'constraint', status: 'open', phase: 'F6', criteria: ['A33'], summary: 'release brd-06', at: '2026-11-16T02:20:00Z' });

    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T33', title: 'Session chip', wave: 1, files: ['src/SessionChip.tsx'], acceptance: ['A30'], verify: { commands: ['node -e 0'] } },
        { id: 'T36', title: 'Settings BRD-23', wave: 1, files: ['src/Settings.tsx'], acceptance: ['A33'], verify: { commands: ['node -e 0'] } },
      ],
      acceptance_tests: [],
    });
    writeRel(dir, 'src/SessionChip.tsx', 'export const chip = 1;\n');
    writeRel(dir, 'src/Settings.tsx', 'export const settings = 1;\n');
    writeRel(dir, 'e2e/session-location.spec.ts', "import { test } from 'vitest';\ntest('A30 hides main chip', () => {});\n");
    writeRel(dir, 'tests/oxe152/oxe-130.test.tsx', "import { it } from 'vitest';\nit('A33 settings without plain', () => {});\n");

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'freeze targets');
    const headSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    const frA30 = op.runtimeSpecFreeze(dir, null, { from: headSha, paths: 'e2e/**', cr: 'CR-F6-24' });
    assert.equal(frA30.frozen[0].version, 3);
    const frA33 = op.runtimeSpecFreeze(dir, null, { from: headSha, paths: 'tests/oxe152/**', cr: 'CR-F6-22' });
    assert.equal(frA33.frozen[0].version, 2);

    // Amending SPEC under a `constraint` CR does NOT bump A33 from v2 to v3!
    const amendConstraint = op.runtimeSpecAmend(dir, null, {
      id: 'A33',
      cr: 'CR-F6-25',
      append: ' (9 seções)',
      by: 'coordenacao',
      reason: 'nota de liberação do teste congelado',
    });
    assert.equal(amendConstraint.version, 2);
    assert.equal(change.amendmentRequirements(programDir).get('A33').required, 2);

    const lint = op.runtimePlanLint(dir, null, { noPrecheck: true, preflight: false });
    assert.equal(lint.ok, true, `expected 0 stale errors, got: ${JSON.stringify(lint.errors)}`);
  });

  it('OXB-C2 #2: spec freeze leaves git stage clean (CRLF-safe), and quick commit <paths> commits ONLY given paths while preserving & reporting other staged files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-c2-2-'));
    tmpDirs.push(dir);

    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 't', wave: 1, files: ['src/a.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }],
    });
    writeRel(dir, 'src/a.ts', 'export const a = 1;\n');
    writeRel(dir, 'src/other.ts', 'export const keepMe = 1;\n');
    writeRel(dir, 'tests/acceptance/a1.test.ts', "import { it } from 'vitest';\nit('A1 works', () => {});\n");

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'config', 'core.autocrlf', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    // Rewrite working copy to CRLF (Windows checkout simulation)
    fs.writeFileSync(path.join(dir, 'tests', 'acceptance', 'a1.test.ts'), "import { it } from 'vitest';\r\nit('A1 works', () => {});\r\n");
    op.runtimeSpecFreeze(dir, null, { from: sha });
    // Working copy still CRLF, and git index has 0 staged files
    assert.ok(fs.readFileSync(path.join(dir, 'tests', 'acceptance', 'a1.test.ts'), 'utf8').includes('\r\n'));
    assert.equal(git(dir, 'diff', '--cached', '--name-only').stdout.trim(), '');

    // Stage an unrelated change in `src/other.ts`, then run `quick commit` for ONLY `src/a.ts`
    fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'export const keepMe = 999;\n');
    git(dir, 'add', 'src/other.ts');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 2;\n');

    quick.start(dir, { key: 'OXE-300', objective: 'ajustar apenas src/a.ts com segurança' });
    const qc = quick.commit(dir, { message: 'fix: update a.ts only', paths: ['src/a.ts'] });
    assert.deepEqual(qc.files, ['src/a.ts']);
    assert.deepEqual(qc.other_staged, ['src/other.ts']);

    const committedFiles = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/);
    assert.deepEqual(committedFiles, ['src/a.ts']);
    // `src/other.ts` is STILL staged in the index, untouched!
    assert.equal(git(dir, 'diff', '--cached', '--name-only').stdout.trim(), 'src/other.ts');
  });

  it('OXB-C2 #3: refuses frozen tests in plan scope add with CR release guidance, directs recoveryStep to plan amend-test, and unlocks removal from T36.files via task edit or spec freeze', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-c2-3-'));
    tmpDirs.push(dir);

    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    writeRel(dir, '.oxe/PLAN.md', '# PLAN\n');
    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        {
          id: 'T36',
          title: 'Settings BRD-23',
          wave: 1,
          files: ['src/Settings.tsx', 'tests/oxe152/brand/brd-06-settings.test.tsx'],
          acceptance: ['A33'],
          verify: { commands: ['node -e 0'] },
        },
      ],
      acceptance_tests: [
        {
          criterion: 'A33',
          files: ['tests/oxe152/brand/brd-06-settings.test.tsx'],
          command: 'npx vitest run tests/oxe152/brand/brd-06-settings.test.tsx',
        },
      ],
    });
    const programDir = path.join(dir, '.oxe', 'program');
    change.appendNdjson(change.changesFile(programDir), {
      kind: 'cr',
      id: 'CR-F6-25',
      class: 'constraint',
      status: 'open',
      criteria: ['A33'],
      tasks: ['T36'],
      summary: 'release brd-06',
      at: '2026-11-16T03:00:00Z',
    });

    // 1. plan scope add rejects frozen test with actionable plan amend-test / spec freeze guidance
    assert.throws(
      () => op.runtimePlanScopeAdd(dir, null, {
        task: 'T36',
        paths: ['tests/oxe152/brand/brd-06-settings.test.tsx'],
        cr: 'CR-F6-25',
        by: 'coordenacao',
        reason: 'tentativa errada de incluir teste congelado',
      }),
      /plan amend-test tests\/oxe152\/brand\/brd-06-settings\.test\.tsx --reason CR-F6-25/,
    );

    // 2. recoveryStep on scope_insufficient for a frozen test suggests plan amend-test, NOT plan scope add
    const rec = recovery.recoveryStep(dir, null, {
      run: null,
      doc: {
        tasks: [
          {
            id: 'T36',
            files: ['src/Settings.tsx'],
            checkpoint_failed: { kind: 'scope_insufficient', related_red: ['tests/oxe152/brand/brd-06-settings.test.tsx'], reason: 'red' },
          },
        ],
        acceptance_tests: [{ criterion: 'A33', files: ['tests/oxe152/brand/brd-06-settings.test.tsx'] }],
      },
      programDir,
      phase: { id: 'F6' },
    });
    assert.equal(rec.step, 'plan-amend-test');
    assert.match(rec.cursorCmd, /^oxe-cc plan amend-test tests\/oxe152\/brand\/brd-06-settings\.test\.tsx/);

    // 3. plan task edit --remove-paths unlocks T36 by removing the mistakenly-added frozen test from T36.files!
    op.runtimePlanTaskEdit(dir, null, {
      task: 'T36',
      removePaths: 'tests/oxe152/brand/brd-06-settings.test.tsx',
      by: 'coordenacao',
      reason: 'remover teste congelado inserido indevidamente em T36.files',
    });
    const cleaned = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(cleaned.tasks[0].files, ['src/Settings.tsx']);
    assert.deepEqual(cleaned.acceptance_tests[0].files, ['tests/oxe152/brand/brd-06-settings.test.tsx']);
  });

  it('Adendo 2 (G14 / G48): catches removed CSS rule .oq-primary still used in TableEditor.tsx & WorkbenchPanels.tsx in plan lint, commit-task, and checkpoint, and wires css-classes-guard test', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-css-guard-'));
    tmpDirs.push(dir);

    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    writeRel(dir, '.oxe/config.json', { external_dependency_check: false, plan_lint_preflight: false, stub_check: false, lint: { suite_impact: 'off' } });
    writeRel(dir, 'src/styles/OxeQuery.css', '.oq-primary {\n  color: #2563eb;\n}\n.oq-secondary {\n  color: #64748b;\n}\n');
    writeRel(
      dir,
      'src/TableEditor.tsx',
      'export const TableEditor = () => (\n  <div>\n    <button className="oq-primary">Save</button>\n    <button className="btn oq-primary">Run</button>\n    <span className={`oq-primary active`} />\n  </div>\n);\n',
    );
    writeRel(
      dir,
      'src/WorkbenchPanels.tsx',
      'export const WorkbenchPanels = () => (\n  <section className="oq-primary">\n    <footer className="oq-primary" />\n  </section>\n);\n',
    );
    writeRel(dir, 'tests/unit/css-classes-guard.test.ts', "import { it } from 'vitest';\nit('guards css classes', () => {});\n");
    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F1',
      tasks: [
        {
          id: 'T13',
          title: 'OXE-223: remover regra .oq-primary legada do OxeQuery.css',
          wave: 1,
          files: ['src/styles/OxeQuery.css'],
          acceptance: ['A1'],
          verify: { commands: [`"${process.execPath}" -e "process.exit(0)"`] },
        },
      ],
    });

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base css');
    const baseSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();

    // 1. plan lint emits [G48] warning naming TableEditor.tsx & WorkbenchPanels.tsx
    const lint = op.runtimePlanLint(dir, null, { noPrecheck: true, preflight: false });
    assert.ok(
      lint.warnings.some((w) => w.includes('[G48]') && w.includes('.oq-primary') && w.includes('TableEditor.tsx')),
      `expected [G48] warning, got: ${JSON.stringify(lint.warnings)}`,
    );

    // 2. applyTaskGatesToGraph wires tests/unit/css-classes-guard.test.ts into T13's verify command
    const graph = { nodes: [{ id: 'T13', verify: { command: 'node -e 0' } }] };
    op.applyTaskGatesToGraph(dir, { plan: path.join(dir, '.oxe', 'PLAN.md') }, graph);
    assert.match(graph.nodes[0].verify.command, /tests\/unit\/css-classes-guard\.test\.ts/);

    // 3. Removing .oq-primary fails runtimeCommitTask immediately before running slow verify commands
    writeRel(dir, 'src/styles/OxeQuery.css', '.oq-secondary {\n  color: #64748b;\n}\n');
    assert.throws(
      () => op.runtimeCommitTask(dir, null, { task: 'T13' }),
      /guarda de classes CSS: \.oq-primary \(removido de src\/styles\/OxeQuery\.css\) ainda é lido por 5 linha\(s\)/,
    );

    // 4. Commit-diff check (orphanCssClasses) also catches .oq-primary across all 5 uses
    git(dir, 'add', 'src/styles/OxeQuery.css');
    git(dir, 'commit', '-qm', 'drop oq-primary');
    const headSha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const orphans = domHooks.orphanCssClasses(dir, baseSha, headSha);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].hook, '.oq-primary');
    assert.equal(orphans[0].readers_total, 5);
  });
});
