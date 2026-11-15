'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const repairLib = require('../bin/lib/oxe-plan-repair.cjs');
const reviewLib = require('../bin/lib/oxe-plan-review.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('1.21.2: unified deterministic plan repair engine (oxe-plan-repair)', () => {
  it('repairs frozen-in-files, barrel scopeGaps, wave collisions/gaps, G38 later-owned verify, G30 suite impact, and proves verbose in one idempotent pass', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-repair-'));
    dirs.push(dir);

    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(
      dir,
      '.oxe/SPEC.md',
      [
        '# SPEC',
        '',
        '## Objetivo',
        '',
        'Fluxo de pareamento confiável.',
        '',
        '## Critérios de aceite',
        '',
        '| ID | Critério | Como verificar |',
        '|---|---|---|',
        '| A1 | Serviço de pareamento valida código | vitest |',
        '| A2 | Modal de pareamento consome serviço e locale | vitest |',
        '| A3 | Versão extendida renderiza badge | vitest |',
        '',
      ].join('\n'),
    );
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, lint: { test_scope: 'error' } }));
    write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));

    // Product files + barrel
    write(dir, 'src/services/index.ts', "export { pairDevice } from './pairing';\n");
    write(dir, 'src/services/pairing.ts', "export const ALLOWED_MODES = ['qr'];\nexport function pairDevice() { return true; }\n");
    write(dir, 'src/ui/PairModal.tsx', 'export function PairModal() { return null; }\n');
    write(dir, 'src/ui/VersionBadge.tsx', 'export function VersionBadge() { return null; }\n');
    write(dir, 'src/locales/pt.json', '{"pair":"Parear"}\n');

    // Existing unit suite + G30b data baseline importing src/services/pairing.ts
    write(dir, 'tests/fixtures/modes.base.json', '["qr"]\n');
    write(
      dir,
      'tests/unit/pairing-modes.test.ts',
      [
        "import fs from 'node:fs';",
        "import { ALLOWED_MODES } from '../../src/services/pairing';",
        "const base = fs.readFileSync('tests/fixtures/modes.base.json', 'utf8');",
        'void ALLOWED_MODES; void base;',
      ].join('\n'),
    );

    // Frozen acceptance tests
    write(
      dir,
      'tests/acceptance/f4/pu03-app-version.test.ts',
      [
        "import { pairDevice } from '@/services/pairing';",
        "it('validates pairing code', () => { void pairDevice; });",
      ].join('\n'),
    );
    write(
      dir,
      'tests/acceptance/f4/pair-modal.test.ts',
      [
        "import fs from 'node:fs';",
        "import { pairDevice } from '@/services';",
        "import { PairModal } from '@/ui/PairModal';",
        "const loc = fs.readFileSync('src/locales/pt.json', 'utf8');",
        "it('renders modal with locale', () => { void pairDevice; void PairModal; void loc; });",
      ].join('\n'),
    );
    write(
      dir,
      'tests/acceptance/f4/pu03-app-version.test.tsx',
      [
        "import { VersionBadge } from '@/ui/VersionBadge';",
        "it('renders version badge', () => { void VersionBadge; });",
      ].join('\n'),
    );

    const brokenPlan = {
      schema_version: 1,
      tasks: [
        {
          id: 'T1',
          title: 'Implement ALLOWED_MODES and pairDevice service',
          wave: 1,
          // Defect 1: frozen acceptance test wrongly placed inside task.files!
          files: ['src/services/pairing.ts', 'tests/acceptance/f4/pu03-app-version.test.ts'],
          acceptance: ['A1'],
          // Defect 4: runs T3's later-owned frozen test AND unanchored substring pu03-app-version.test.ts!
          // Defect 5: misses tests/unit/pairing-modes.test.ts (G30) and tests/fixtures/modes.base.json (G30b)!
          verify: {
            commands: [
              'npx vitest run tests/acceptance/f4/pu03-app-version.test.ts tests/acceptance/f4/pu03-app-version.test.tsx && npm run typecheck',
            ],
          },
        },
        {
          id: 'T2',
          title: 'Build PairModal UI consuming pairing service',
          wave: 1,
          // Defect 2a: test imports pairDevice via '@/services' barrel -> owned by T1, missing depends_on: ['T1']!
          // Defect 2b: test reads unowned src/locales/pt.json, missing from T2.files!
          files: ['src/ui/PairModal.tsx'],
          acceptance: ['A2'],
          verify: { commands: ['npx vitest run tests/acceptance/f4/pair-modal.test.ts'] },
        },
        {
          id: 'T3',
          title: 'Update UI directory with VersionBadge',
          // Defect 3: empty wave gap (wave 5) AND overlaps with T2 (`src/ui` covers `src/ui/PairModal.tsx`) if same wave!
          wave: 2,
          files: ['src/ui'],
          acceptance: ['A3'],
          verify: { commands: ['npx vitest run tests/acceptance/f4/pu03-app-version.test.tsx'] },
        },
      ],
      acceptance_tests: [
        {
          id: 'AT-1',
          criterion: 'A1',
          task: 'T1',
          files: ['tests/acceptance/f4/pu03-app-version.test.ts'],
          // Defect 6: proves declared on vitest without --reporter=verbose!
          proves: ['validates pairing code'],
          command: 'npx vitest run tests/acceptance/f4/pu03-app-version.test.ts$',
        },
        {
          id: 'AT-2',
          criterion: 'A2',
          task: 'T2',
          files: ['tests/acceptance/f4/pair-modal.test.ts'],
          proves: ['renders modal with locale'],
          command: 'npx vitest run --reporter=verbose tests/acceptance/f4/pair-modal.test.ts',
        },
        {
          id: 'AT-3',
          criterion: 'A3',
          task: 'T3',
          files: ['tests/acceptance/f4/pu03-app-version.test.tsx'],
          proves: ['renders version badge'],
          command: 'npx vitest run tests/acceptance/f4/pu03-app-version.test.tsx',
        },
      ],
    };

    write(dir, '.oxe/PLAN.json', `${JSON.stringify(brokenPlan, null, 2)}\n`);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');

    // Confirm plan lint fails BEFORE repair
    const beforeLint = op.runtimePlanLint(dir, null, { precheck: false });
    assert.equal(beforeLint.ok, false, 'broken plan must fail lint before repair');

    // 1. Dry-run preview does not mutate disk
    const preview = repairLib.repairPlanFile(dir, '.oxe/PLAN.md');
    assert.equal(preview.dry_run, true);
    assert.equal(preview.changed, true);
    assert.ok(preview.counts.frozen_in_task_files >= 1);
    assert.ok(preview.counts.scope_gap_dependency >= 1);
    assert.ok(preview.counts.scope_gap_files >= 1);
    assert.ok(preview.counts.same_wave_overlap >= 1);
    assert.ok(preview.counts.verify_later_owned >= 1);
    assert.ok(preview.counts.suite_impact_verify >= 1);
    assert.ok(preview.counts.proves_verbose_reporter >= 2);
    const onDiskUnchanged = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.ok(onDiskUnchanged.tasks[0].files.includes('tests/acceptance/f4/pu03-app-version.test.ts'));

    // Validation requires --by and --reason on apply
    assert.throws(() => repairLib.repairPlanFile(dir, '.oxe/PLAN.md', { apply: true }), /--by/);

    // 2. Apply repairs with audit metadata
    const applied = repairLib.repairPlanFile(dir, '.oxe/PLAN.md', {
      apply: true,
      by: 'tech-lead',
      reason: 'reparo determinístico completo antes do execute',
    });
    assert.equal(applied.dry_run, false);
    assert.equal(applied.changed, true);

    const fixed = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const [t1, t2, t3] = fixed.tasks;

    // Verify all 6 repairs on the resulting PLAN.json:
    assert.ok(!t1.files.includes('tests/acceptance/f4/pu03-app-version.test.ts'), 'frozen test removed from T1.files');
    assert.ok(t1.files.includes('tests/fixtures/modes.base.json'), 'G30b baseline fixture added to T1.files');
    assert.equal(
      t1.verify.commands[0],
      'npx vitest run tests/acceptance/f4/pu03-app-version.test.ts$ && npm run typecheck',
      'later-owned .test.tsx dropped, .test.ts$ anchored, typecheck preserved',
    );
    assert.ok(t1.verify.commands.includes('npx vitest run tests/unit/pairing-modes.test.ts'), 'G30 impacted suite added');

    assert.deepEqual(t2.depends_on, ['T1'], 'barrel scopeGap wired T2 -> T1');
    assert.ok(t2.files.includes('src/locales/pt.json'), 'unowned read file added to T2.files');
    assert.equal(t2.wave, 2);

    assert.ok(t3.depends_on.includes('T2'), 'same-wave overlap serialized T3 after T2');
    assert.equal(t3.wave, 3, 'waves strictly ordered 1, 2, 3 with no empty gaps');

    assert.match(fixed.acceptance_tests[0].command, /vitest run --reporter=verbose/);
    assert.match(fixed.acceptance_tests[2].command, /vitest run --reporter=verbose/);

    // Audit trail recorded in task.edits[] and .oxe/program/changes.ndjson
    assert.ok(Array.isArray(t1.edits) && t1.edits[0].kind === 'plan_repair');
    const changesLog = fs
      .readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(changesLog.some((c) => c.kind === 'plan_repair' && c.by === 'tech-lead'));

    // 3. Post-repair lint and semantic review are 100% clean (ignoring unrelated preflight pack files and T3's bare-dir advisory warnings)!
    assert.ok(
      t3.verify.commands.some((c) => c.includes('tests/acceptance/f4/pair-modal.test.ts')),
      'bare-dir scope src/ui on T3 automatically receives impacted suite pair-modal.test.ts in verify',
    );
    const afterLint = op.runtimePlanLint(dir, null, { preflight: false, noPrecheck: true });
    const structuralLintErrors = (afterLint.errors || []).filter((e) => !e.startsWith('preflight:'));
    const structuralLintWarnings = (afterLint.warnings || []).filter(
      (w) =>
        !w.startsWith('preflight:') &&
        !w.includes('diretório não expandido em files') &&
        // T2 already owns src/locales/pt.json, so repair conservatively keeps it out of T3's write scope while G30b emits an advisory warning
        !(w.startsWith('T3:') && w.includes('[G30b]')),
    );
    assert.deepEqual(structuralLintErrors, [], `expected 0 lint errors, got: ${structuralLintErrors.join(' | ')}`);
    assert.deepEqual(structuralLintWarnings, [], `expected 0 lint warnings, got: ${structuralLintWarnings.join(' | ')}`);

    const afterReview = reviewLib.review(dir, fixed, { phaseCriteria: ['A1', 'A2', 'A3'] });
    assert.equal(afterReview.dimensions.coupling.verdict, 'PASS', JSON.stringify(afterReview.dimensions.coupling.findings));
    assert.equal(afterReview.dimensions.verification.verdict, 'PASS', JSON.stringify(afterReview.dimensions.verification.findings));
    assert.equal(afterReview.dimensions.coverage.verdict, 'PASS');

    // 4. Second run is strictly idempotent
    const second = repairLib.repairPlanFile(dir, '.oxe/PLAN.md', {
      apply: true,
      by: 'tech-lead',
      reason: 'segunda passada deve ser no-op',
    });
    assert.equal(second.changed, false);
    assert.deepEqual(second.repairs, []);
  });

  it('fixes G30b readFileSync(..., utf8) data detection and G38 direct+substring dual emission in oxe-suite-impact', () => {
    const si = require('../bin/lib/oxe-suite-impact.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-si-'));
    dirs.push(dir);
    write(dir, 'src/cfg.ts', 'export const CFG = 1;\n');
    write(dir, 'tests/fixtures/cfg.snap.json', '{"v":1}\n');
    write(
      dir,
      'tests/unit/cfg.test.ts',
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import { CFG } from '../../src/cfg';",
        "const snap = fs.readFileSync('tests/fixtures/cfg.snap.json', 'utf8');",
        "const joined = fs.readFileSync(path.join('tests/fixtures', 'cfg.snap.json'), 'utf8');",
        'void CFG; void snap; void joined;',
      ].join('\n'),
    );
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');

    const doc = {
      tasks: [
        {
          id: 'T1',
          wave: 1,
          files: ['src/cfg.ts'],
          verify: { commands: ['npx vitest run tests/a.test.ts tests/a.test.tsx'] },
        },
        {
          id: 'T2',
          wave: 2,
          files: ['src/other.ts'],
          acceptance: ['A2'],
        },
      ],
      acceptance_tests: [
        { criterion: 'A1', task: 'T1', files: ['tests/a.test.ts'], command: 'npx vitest run tests/a.test.ts' },
        { criterion: 'A2', task: 'T2', files: ['tests/a.test.tsx'], command: 'npx vitest run tests/a.test.tsx' },
      ],
    };

    const impact = si.suiteImpact(dir, doc);
    assert.equal(impact.length, 1);
    assert.deepEqual(impact[0].data.map((d) => d.file), ['tests/fixtures/cfg.snap.json']);

    const later = si.laterOwnedTests(doc);
    assert.equal(later.some((f) => f.test === 'tests/a.test.tsx' && !f.via), true, 'must emit direct later-owned match');
    assert.equal(later.some((f) => f.test === 'tests/a.test.tsx' && f.via === 'tests/a.test.ts'), true, 'must also emit substring via match');
  });
});
