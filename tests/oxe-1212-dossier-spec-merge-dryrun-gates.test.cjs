'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dossier = require('../bin/lib/oxe-dossier.cjs');
const specCheck = require('../bin/lib/oxe-spec-check.cjs');
const criteriaIds = require('../bin/lib/oxe-criteria-ids.cjs');
const criterionCoverage = require('../bin/lib/oxe-criterion-coverage.cjs');
const planMerge = require('../bin/lib/oxe-plan-merge.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const dryrun = require('../bin/lib/oxe-verify-dryrun.cjs');
const phaseGates = require('../bin/lib/oxe-phase-gates.cjs');
const change = require('../bin/lib/oxe-change.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(prefix = 'oxe-1212-r9-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

describe('Round 9 — oxe-dossier: 4-column SPEC, subcriteria, Fora do escopo ###, and drift paths', () => {
  it('parses 4-column SPEC tables with escaped pipes, subcriteria A19.1, G1, and ### Fora do escopo', () => {
    const spec4Col = `# SPEC

## Objetivo

 Fluxo principal.

### Subobjetivo

 Detalhe interno do objetivo.

## Escopo

### Dentro do escopo
- item 1

### Fora do escopo (não objetivos)
- Sem integração legada.

## Critérios de aceite

| ID | Critério | Risco | Como verificar |
|---|---|---|---|
| **A19.1** | exibe modal \`a \\| b\` | P0 | \`npx playwright test modal.spec.ts\` |
| A19.2 | fecha no Escape | P1 | UAT manual |
| G1 | contraste AA | P2 | \`npx playwright test a11y.spec.ts\` |
`;
    const built = dossier.buildDossier({
      phase: { id: 'F1', title: 'UI', acceptance: ['A19'], requirements: ['R1'], status: 'verifying' },
      specText: spec4Col,
      plan: {
        tasks: [
          {
            id: 'T1',
            title: 'modal e limpeza',
            files: [{ path: 'src/Modal.tsx' }],
            edited_paths: ['src/App.tsx'],
            removed_paths: ['src/OldModal.tsx'],
            aceite: ['A19.1', 'G1'],
          },
        ],
        acceptanceTests: [
          { criterion: 'A19.1', command: 'npx playwright test modal.spec.ts', files: ['e2e/modal.spec.ts'], proves: ['abre modal'] },
          { criterion: 'G1', command: 'npx playwright test a11y.spec.ts', files: ['e2e/a11y.spec.ts'], proves: ['contraste ok'] },
        ],
      },
      pack: {
        tasks: [{ id: 'T1', exact_paths: ['src/Modal.tsx'], edited_paths: ['src/App.tsx'], removed_paths: ['src/OldModal.tsx'] }],
      },
      run: {
        run_id: 'r1',
        status: 'completed',
        verification_check_results: [
          { check_id: 'check-accept-a19.1', status: 'pass', tests_executed: 2 },
          { check_id: 'check-accept-g1', status: 'fail', error: 'proof_not_executed: contraste ok', tests_executed: 1 },
          { check_id: 'check-a19.2', status: 'skip', skip_reason: 'needs_structured_check' },
        ],
      },
      events: [
        { type: 'AttemptStarted', work_item_id: 'T1', timestamp: '2026-11-15T10:00:00Z' },
        { type: 'ExecutorUsage', work_item_id: 'T1', payload: { attempt: 1, turns: 4, cost_usd: 0.25, success: true, tools: {} } },
        { type: 'WorkItemCompleted', work_item_id: 'T1', timestamp: '2026-11-15T10:05:00Z' },
      ],
      changes: [
        { path: 'src/Modal.tsx', status: 'A' },
        { path: 'src/App.tsx', status: 'M' },
        { path: 'src/OldModal.tsx', status: 'D' },
      ],
    });

    assert.match(built.files['context.md'], /Detalhe interno do objetivo\./, '## Objetivo keeps ### subsection');
    assert.match(built.files['context.md'], /Sem integração legada\./, '### Fora do escopo is extracted');
    assert.match(built.files['techspec.md'], /\|\s*A19\.1\s*\|.*pass \(2 testes\)/);
    assert.match(built.files['techspec.md'], /\|\s*A19\.2\s*\|.*ADIADO — UAT\/sign-off pendente/);
    assert.match(built.files['plan.md'], /`src\/Modal\.tsx`/, '{ path } rendered cleanly, never [object Object]');
    assert.match(built.files['plan.md'], /3 testes de aceite executados/, 'subcriteria + G1 test counts summed');
    assert.ok(!built.issues.some((i) => /architecture_drift/.test(i)), `unexpected drift: ${built.issues.join('; ')}`);
    assert.ok(built.issues.some((i) => /proof_not_executed: G1/.test(i)), 'G1 proof_not_executed surfaced');
    assert.deepEqual(built.pending, ['signoff_pending: A19.2']);
  });
});

describe('Round 9 — oxe-spec-check: escaped pipes, non-bold/multiline requirements, ROADMAP subcriteria, glossary noise', () => {
  it('handles escaped \\| in cells, non-bold multiline bullets, ROADMAP subcriteria, and ignores code/comments in glossary', () => {
    const spec = `# SPEC

## Requisitos

- R1 (CODE-8): fluxo de login com fallback \`a | b\`
  cobrindo os cenários (A1, A2.1, A2.2)

<!-- R99 e termo_proibido em comentário não contam; nem A99 -->

\`\`\`ts
const termo_proibido = true;
\`\`\`

Uso em código inline \`termo_proibido\` também não dispara glossário.

## Critérios de aceite

| ID | Critério | Risco | Como verificar |
|---|---|---|---|
| A1 | aceita \`x \\| y\` no filtro | P1 | \`npm test\` |
| A2.1 | tela inicial | P2 | \`npm test\` |
| A2.2 | tela de erro | P2 | \`npm test\` |
`;
    const resMissingSub = specCheck.checkSpec({
      specText: spec,
      roadmapText: '# ROADMAP\n\n## Fase 1\n**Critérios de aceite:** A1, A2.1\n<!-- A2.2 comentado -->\n',
      glossary: [{ term: 'termo_canonico', synonyms: ['termo_proibido'] }],
      fast: true,
      rfcMode: 'advisory',
    });
    assert.equal(resMissingSub.ok, true, resMissingSub.errors.join('\n'));
    assert.ok(
      resMissingSub.warnings.some((w) => /fora de todas as fases do ROADMAP: A2\.2/.test(w)),
      `expected A2.2 uncovered in ROADMAP, got: ${resMissingSub.warnings.join(' | ')}`,
    );
    assert.ok(
      !resMissingSub.warnings.some((w) => /glossário/.test(w)),
      `glossary matched code/comment noise: ${resMissingSub.warnings.join(' | ')}`,
    );

    const resParentCovers = specCheck.checkSpec({
      specText: spec,
      roadmapText: '# ROADMAP\n\n## Fase 1\n**Critérios de aceite:** A1, A2\n',
      fast: true,
      rfcMode: 'never',
    });
    assert.ok(!resParentCovers.warnings.some((w) => /ROADMAP/.test(w)), 'parent A2 in ROADMAP covers A2.1 and A2.2');
  });
});

describe('Round 9 — oxe-criteria-ids & oxe-criterion-coverage', () => {
  it('isUiTask recognizes { path } entries and uncoveredCriterionTerms honors /.../i regexes while catching wrong case literals', () => {
    assert.equal(criteriaIds.isUiTask({ files: [{ path: 'src/components/Button.tsx' }] }), true);
    assert.equal(criteriaIds.isUiTask({ files: [{ path: 'src/server/db.ts' }] }), false);

    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'regex-ok.spec.ts'), "await expect(page.getByText(/mensagem enviada/i)).toBeVisible();\n");
    fs.writeFileSync(path.join(root, 'case-bad.spec.ts'), "await expect(page.getByText('mensagem enviada')).toBeVisible();\n");

    const okOut = criterionCoverage.uncoveredCriterionTerms({
      projectRoot: root,
      spec: { criteria: [{ id: 'A1', text: 'exibe "Mensagem enviada" após salvar' }] },
      plan: { acceptanceTests: [{ criterion: 'A1', files: ['regex-ok.spec.ts'] }] },
    });
    assert.deepEqual(okOut, []);

    const badOut = criterionCoverage.uncoveredCriterionTerms({
      projectRoot: root,
      spec: { criteria: [{ id: 'A1', text: 'exibe "Mensagem enviada" após salvar' }] },
      plan: { acceptanceTests: [{ criterion: 'A1', files: ['case-bad.spec.ts'] }] },
    });
    assert.equal(badOut.length, 1);
    assert.match(badOut[0], /"Mensagem enviada"/);
  });
});

describe('Round 9 — oxe-plan-merge: max complexity, kind precedence, preserved fields, and status: done', () => {
  it('picks max complexity, upgrades narrow kind to code, preserves decisions/removed_paths/edited_paths, and keeps status: done', () => {
    const qaRole = {
      role: 'qa',
      tasks: [
        {
          rid: 'R10',
          title: 'cobertura e implementação',
          files: [{ path: 'tests/r10.test.ts' }],
          kind: 'test-only',
          complexity: 'S',
          decisions: ['D-01'],
          model_hint: 'fast',
          max_turns: 12,
          verify: ['npx vitest run tests/r10.test.ts'],
          acceptance: ['A10'],
        },
      ],
      acceptance_tests: [{ criterion: 'A10', files: [{ path: 'tests/r10.test.ts' }], command: 'npx vitest run tests/r10.test.ts', proves: ['caso base'] }],
    };
    const beRole = {
      role: 'backend',
      tasks: [
        {
          rid: 'R10',
          title: 'implementação backend',
          files: ['src/r10.ts'],
          edited_paths: ['src/index.ts'],
          kind: 'code',
          complexity: 'XL',
          decisions: ['D-02'],
          model_hint: 'powerful',
          max_turns: 30,
          proves: { 'tests/r10.test.ts': ['caso backend'] },
          verify: ['npx vitest run tests/r10.test.ts'],
          acceptance: ['A10'],
        },
        {
          rid: 'R11',
          title: 'remoção pura',
          kind: 'remove',
          removed_paths: ['src/legacy.ts'],
          symbols_removed: ['legacyFn'],
          verify: ['npx vitest run tests/r10.test.ts'],
        },
      ],
    };
    const existing = {
      tasks: [{ id: 'T1', rid: 'R10', status: 'done', done_commit: 'deadbeef' }],
    };
    const merged = planMerge.mergeRolePlans(
      [
        { file: 'qa.json', doc: qaRole },
        { file: 'backend.json', doc: beRole },
      ],
      { existing },
    );
    assert.deepEqual(merged.errors, []);
    assert.deepEqual(planJson.validatePlanJson(merged.plan), []);
    const t10 = merged.plan.tasks.find((t) => t.rid === 'R10');
    const t11 = merged.plan.tasks.find((t) => t.rid === 'R11');
    assert.equal(t10.complexity, 'XL');
    assert.equal(t10.kind, 'code');
    assert.deepEqual(t10.decisions, ['D-01', 'D-02']);
    assert.deepEqual(t10.edited_paths, ['src/index.ts']);
    assert.equal(t10.max_turns, 30);
    assert.equal(t10.model_hint, 'powerful');
    assert.equal(t10.status, 'done');
    assert.equal(t10.done_commit, 'deadbeef');
    assert.deepEqual(t11.removed_paths, ['src/legacy.ts']);
    assert.deepEqual(t11.symbols_removed, ['legacyFn']);
    assert.ok(!merged.warnings.some((w) => /R11: nenhum papel declarou files/.test(w)), 'remove task with removed_paths does not warn');
  });
});

describe('Round 9 — oxe-verify-dryrun: UTF-8 treeHash, escaped quotes, Python missing_target, and --changed cache guard', () => {
  it('tracks content changes in untracked UTF-8 files with accents in treeHash', () => {
    const repo = tmpDir();
    spawnSync('git', ['init', '-q'], { cwd: repo, windowsHide: true });
    spawnSync('git', ['config', 'user.email', 't@oxe.test'], { cwd: repo, windowsHide: true });
    spawnSync('git', ['config', 'user.name', 'Oxe'], { cwd: repo, windowsHide: true });
    fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo, windowsHide: true });
    spawnSync('git', ['commit', '-qm', 'init'], { cwd: repo, windowsHide: true });

    const accented = path.join(repo, 'ação-configuração.ts');
    fs.writeFileSync(accented, 'export const v = 1;\n', 'utf8');
    const h1 = dryrun.treeHash(repo);
    fs.writeFileSync(accented, 'export const v = 2;\n', 'utf8');
    const h2 = dryrun.treeHash(repo);
    assert.ok(h1 && h2);
    assert.notEqual(h1, h2, 'modifying untracked UTF-8 accented file must change treeHash');
  });

  it('handles escaped quotes in splitSegments/hasSingleQuotedArgument, Python ModuleNotFoundError, and non-reusable --changed tasks', () => {
    const cmd = 'node -e "const x = \\"a && b\\"; const y = \'ok\';" && node -e "process.exit(0)"';
    assert.equal(dryrun.splitSegments(cmd).length, 2);
    assert.equal(dryrun.hasSingleQuotedArgument('node -e "const s = \\"\'inside\'\\";"'), false);
    assert.equal(dryrun.hasSingleQuotedArgument("gh run list --jq '.[0]'"), true);

    assert.equal(
      dryrun.classifyFailure("Traceback:\nModuleNotFoundError: No module named 'worker.queue_mgr'\n", ['worker/queue_mgr.py']),
      'missing_target',
    );

    const root = tmpDir();
    const cachePath = path.join(root, '.oxe', 'dryrun-cache.json');
    const plan = {
      tasks: [
        { id: 'T1', files: ['src/missing.js'], verifyCommand: 'node -e "throw new SyntaxError(\'bad flag\')"' },
      ],
    };
    const first = dryrun.dryRunVerifyCommands(root, plan, { cachePath, batch: false });
    assert.equal(first.ok, false);
    assert.equal(first.results[0].verdict, 'broken_command');

    const second = dryrun.dryRunVerifyCommands(root, plan, { cachePath, changed: true, batch: false });
    assert.equal(second.skipped.length, 0, 'broken_command task must NOT be skipped on subsequent --changed');
    assert.equal(second.results[0].verdict, 'broken_command');
  });
});

describe('Round 9 — oxe-phase-gates & oxe-change: Windows-safe script options, phase-scoped gate CRs, signoff, and mergeChanges spec_edit', () => {
  it('passes script gate options via --options-b64 safely through cmd.exe with shell metacharacters', () => {
    const root = tmpDir();
    const pdir = path.join(root, '.oxe', 'program');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'custom-gate.cjs'),
      "module.exports = async ({ gate }) => ({ ok: gate.options.expr === 'a & b | c < d > e \"quoted\"', message: gate.options.expr });\n",
    );
    const [gate] = phaseGates.readPhaseGates(
      { phase_gates: [{ id: 'meta', kind: 'script', module: 'custom-gate.cjs', options: { expr: 'a & b | c < d > e "quoted"' } }] },
      {},
    );
    const command = phaseGates.gateCommand(gate, { programDir: pdir, phase: 'F2' });
    assert.match(command, /--options-b64\s+[A-Za-z0-9+/=]+/);
    const isWin = process.platform === 'win32';
    const res = spawnSync(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: isWin,
    });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /a & b \| c < d > e "quoted"/);
  });

  it('scopes gate CR deduplication by phase, accepts global/case-insensitive signoffs & bidirectional CI SHAs, and renames spec_edit.cr in mergeChanges', () => {
    const pdir = tmpDir();
    const f1Program = { active_phase: 'F1', phases: [{ id: 'F1', status: 'verifying' }, { id: 'F2', status: 'verifying' }] };
    const failing = [{ check_id: 'gate-lint', status: 'fail', stdout: '1:1 error boom', stderr: '' }];
    const r1 = phaseGates.recordGateFailures({ programDir: pdir, program: f1Program, plan: { phase: 'F1', tasks: [] }, checkResults: failing });
    assert.equal(r1.created.length, 1);
    assert.equal(r1.created[0].phase, 'F1');

    const f2Program = { ...f1Program, active_phase: 'F2' };
    const r2 = phaseGates.recordGateFailures({ programDir: pdir, program: f2Program, plan: { phase: 'F2', tasks: [] }, checkResults: failing });
    assert.equal(r2.created.length, 1, 'F1 open gate CR must not suppress F2 gate failure');
    assert.equal(r2.created[0].phase, 'F2');

    fs.writeFileSync(path.join(pdir, 'signoffs.ndjson'), `${JSON.stringify({ phase: null, criteria: ['a70'], by: 'qa', evidence: 'ok.png' })}\n`);
    assert.equal(phaseGates.signoffGateStatus(pdir, 'F2', ['A70']).ok, true);

    const ciOk = phaseGates.ciRunStatus(
      { run: '99', head: 'AE6B79B9FF001122' },
      { spawn: () => ({ status: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'success', headSha: 'ae6b79b9' }), stderr: '' }) },
    );
    assert.equal(ciOk.ok, true);

    // mergeChanges renames spec_edit.cr so requiredVersions preserves per-criterion amended version
    const mainDir = tmpDir();
    const forkDir = tmpDir();
    change.recordChange({ programDir: mainDir, program: null, plan: null, class: 'constraint', summary: 'main cr colidindo no id CR-01', phase: 'F1' });
    change.recordChange({ programDir: forkDir, program: null, plan: null, class: 'spec_gap', summary: 'fork spec gap em A12', criteria: 'A12', phase: 'F4', amendTo: 2 });
    change.appendNdjson(change.changesFile(forkDir), { kind: 'spec_edit', action: 'amend_criterion', id: 'A12', cr: 'CR-01', version: 4, at: '2026-11-15T12:00:00Z' });

    const adopted = change.mergeChanges(mainDir, forkDir, { phase: 'F4', from: forkDir });
    assert.equal(adopted.renamed['CR-01'], 'CR-F4-1');
    assert.equal(change.requiredVersions(mainDir).get('A12'), 4, 'amended version 4 preserved after CR-01 -> CR-F4-1 rename');
  });
});
