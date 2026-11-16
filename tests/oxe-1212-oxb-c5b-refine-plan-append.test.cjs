'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const refine = require('../bin/lib/oxe-alm-refine.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function makePlannedRepo({ phaseStatus = 'planning' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c5b-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'refine'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'base.ts'), 'export const base = 1;\n');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'a1.test.ts'), 'import { base } from "../src/base";\nif (!base) throw new Error("fail");\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), '# ROADMAP\n\n## Fase 1: Fase 1\n- **Objetivo:** F1\n- **Aceite:** A1\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), [
    '# SPEC — Approvals',
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    '| A1 | Dado painel, quando carrega, então mede 32 px | P1 | node -e "process.exit(0)" |',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n## Onda 1\n\n### T1 — base\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, phase: 'F1' }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    tasks: [
      { id: 'T1', title: 'base', wave: 1, files: ['src/base.ts'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } },
    ],
    acceptance_tests: [
      { criterion: 'A1', task: 'T1', files: ['tests/a1.test.ts'], command: 'node -e "process.exit(0)"' },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    tasks: [
      {
        id: 'T1',
        mode: 'mutating',
        write_set: 'closed',
        exact_paths: ['src/base.ts'],
        symbols: [{ kind: 'export', name: 'base', path: 'src/base.ts' }],
        contracts: ['base exportado de src/base.ts'],
        expected_checks: ['node -e "process.exit(0)"'],
        phase: 'F1',
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({
    schema_version: 1,
    active_phase: 'F1',
    phases: [{ id: 'F1', title: 'Fase 1', status: phaseStatus, acceptance: ['A1'] }],
  }, null, 2));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test User');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

describe('OXB-C5b (8e 17:00Z): refine round trip, middle-dot Teste, plan append pack, scope add pack sync, import phase, task edit --add-paths', () => {
  it('#1 & #2: adfToText keeps bold CA-n on round trip, parseCriteria accepts plain CA-n and middle dots inside Teste/text, import reports 0 criteria', () => {
    const mdOrig = [
      '# OXE-181 — OxeQuery card',
      '',
      '## Critérios de aceite',
      '',
      '1. **CA-9** — Dado um item `{project} · OxeQuery`, quando renderiza, então mede 32 px · Teste: e2e/entry.spec.ts › an OxeQuery entry says "{project} · OxeQuery" shows icon · Risco: P1',
      '',
    ].join('\n');

    // ADF round trip preserves **CA-9** and `{project} · OxeQuery`
    const adfDoc = refine.mdToAdf(mdOrig);
    const recoveredText = refine.adfToText(adfDoc);
    assert.match(recoveredText, /\*\*CA-9\*\*/);
    assert.match(recoveredText, /`\{project\} · OxeQuery`/);

    // Even when Jira / caller produces unbolded `- CA-9 — ...`, parseCriteria parses it and keeps the middle dot inside Teste!
    const unboldedMd = [
      '# OXE-181 — OxeQuery card',
      '',
      '## Critérios de aceite',
      '',
      '- CA-9 — Dado um item {project} · OxeQuery, quando renderiza, então mede 32 px · Teste: e2e/entry.spec.ts › an OxeQuery entry says "{project} · OxeQuery" shows icon · Risco: P1',
      '',
    ].join('\n');
    const parsed = refine.parseCriteria(unboldedMd);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'CA-9');
    assert.equal(parsed[0].text, 'Dado um item {project} · OxeQuery, quando renderiza, então mede 32 px');
    assert.equal(parsed[0].test, 'e2e/entry.spec.ts › an OxeQuery entry says "{project} · OxeQuery" shows icon');
    assert.equal(parsed[0].risk, 'P1');

    // 0 criteria in markdown yields explicit diagnostic instead of silent empty output
    const dir = makePlannedRepo();
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-182.json'), JSON.stringify({ key: 'OXE-182', kind: 'story' }));
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-182.md'), '# OXE-182\n\n## Critérios de aceite\n\n- texto solto sem CA\n');
    const emptyImp = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-182'], by: 'po', dryRun: true });
    assert.equal(emptyImp.results[0].criteria_count, 0);
    assert.ok(emptyImp.results[0].problems.some((p) => /0 critérios lidos/.test(p)));
  });

  it('#5: refine import defaults to active planning phase (adds A2 to F1), updates unbolded CA-9 bold tag, and preserves middle-dot Teste in SPEC', () => {
    const dir = makePlannedRepo({ phaseStatus: 'planning' });
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-181.json'), JSON.stringify({ key: 'OXE-181', kind: 'story' }));
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-181.md'), [
      '# OXE-181 — Approvals card',
      '',
      '## Critérios de aceite',
      '',
      '- CA-9 — Dado um pedido, quando abre, então exibe badge 24 px · Teste: e2e/entry.spec.ts › an OxeQuery entry says "{project} · OxeQuery" · Risco: P1',
      '',
    ].join('\n'));

    const imp = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-181'], by: 'po' });
    assert.equal(imp.phase, 'F1');
    assert.deepEqual(imp.results[0].added.map((x) => [x.ca, x.a]), [['CA-9', 'A2']]);
    const specText = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
    assert.match(specText, /\| A2 \| Dado um pedido, quando abre, então exibe badge 24 px \(OXE-181\) \| P1 \| e2e\/entry\.spec\.ts › an OxeQuery entry says "\{project\} · OxeQuery" \|/);
    const prog = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8'));
    assert.ok(prog.phases[0].acceptance.includes('A2'), 'A2 automatically attached to active planning phase F1');
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-181.md'), 'utf8'), /\*\*CA-9 \(A2\)\*\*/);

    // When the active phase is already executing, import does not mutate the frozen phase silently and reports phase_warning
    const execDir = makePlannedRepo({ phaseStatus: 'executing' });
    fs.writeFileSync(path.join(execDir, '.oxe', 'alm', 'refine', 'OXE-181.json'), JSON.stringify({ key: 'OXE-181', kind: 'story' }));
    fs.writeFileSync(path.join(execDir, '.oxe', 'alm', 'specs', 'OXE-181.md'), '# OXE-181\n\n## Critérios de aceite\n\n- CA-9 — Dado x, quando y, então 24 px · Teste: tests/a1.test.ts · Risco: P1\n');
    const execImp = op.runtimeAlmRefineImport(execDir, null, { keys: ['OXE-181'], by: 'po' });
    assert.equal(execImp.phase, undefined);
    assert.match(execImp.phase_warning, /sem fase \("fase -"\).*F1 está executing/);
  });

  it('#3 & #4: plan append builds IMPLEMENTATION-PACK entries (passes plan lint + rolls back on error) and plan scope add updates exact_paths', () => {
    const dir = makePlannedRepo({ phaseStatus: 'executing' });
    // First link A2 to active executing phase & SPEC so lint allows appending a task for A2
    const specFile = path.join(dir, '.oxe', 'SPEC.md');
    fs.writeFileSync(specFile, `${fs.readFileSync(specFile, 'utf8')}| A2 | novo critério | P1 | node -e "process.exit(0)" |\n`);
    const progPath = path.join(dir, '.oxe', 'program', 'PROGRAM.json');
    const prog = JSON.parse(fs.readFileSync(progPath, 'utf8'));
    prog.phases[0].acceptance.push('A2');
    fs.writeFileSync(progPath, JSON.stringify(prog, null, 2));

    fs.writeFileSync(path.join(dir, 'src', 'approval-banner.tsx'), 'export const ApprovalBanner = () => null;\n');
    fs.writeFileSync(path.join(dir, 'tests', 'a2.test.ts'), 'import { ApprovalBanner } from "../src/approval-banner";\nexport default ApprovalBanner;\n');
    const extraPath = path.join(dir, 'batch-extra.json');
    fs.writeFileSync(extraPath, JSON.stringify({
      tasks: [
        {
          id: 'G1',
          title: 'approval banner',
          wave: 1,
          files: ['src/approval-banner.tsx'],
          acceptance: ['A2'],
          pack_symbols: [{ kind: 'export', name: 'ApprovalBanner', path: 'src/approval-banner.tsx' }],
          verify: { commands: ['node -e "process.exit(0)"'] },
        },
      ],
      acceptance_tests: [
        { criterion: 'A2', task: 'G1', files: ['tests/a2.test.ts'], command: 'node -e "process.exit(0)"' },
      ],
    }, null, 2));

    // Failing append (unknown criterion A99) rolls back BOTH PLAN.json and IMPLEMENTATION-PACK.json
    const planBefore = fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8');
    const packBefore = fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8');
    const badExtraPath = path.join(dir, 'bad-extra.json');
    fs.writeFileSync(badExtraPath, JSON.stringify({
      tasks: [{ id: 'B1', title: 'bad', wave: 1, files: ['src/approval-banner.tsx'], acceptance: ['A99'], pack_symbols: [{ name: 'ApprovalBanner', path: 'src/approval-banner.tsx' }], verify: { commands: ['node -e "process.exit(0)"'] } }],
    }));
    assert.throws(() => op.runtimePlanAppend(dir, null, { from: badExtraPath, by: 'tl', reason: 'teste rollback' }), /plan lint reprovou/);
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'), planBefore);
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'), packBefore);

    // Valid append succeeds, writes T2 entry into IMPLEMENTATION-PACK.json, and remaps acceptance_tests.task G1 -> T2
    const out = op.runtimePlanAppend(dir, null, { from: extraPath, by: 'tl', reason: 'adiciona tarefa para CA-9' });
    assert.equal(out.pack_updated, true);
    assert.equal(out.tasks[0].id, 'T2');
    const planAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(planAfter.acceptance_tests.find((a) => a.criterion === 'A2').task, 'T2');
    const packAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    const t2Pack = packAfter.tasks.find((p) => p.id === 'T2');
    assert.ok(t2Pack, 'T2 entry added to IMPLEMENTATION-PACK.json');
    assert.deepEqual(t2Pack.exact_paths, ['src/approval-banner.tsx']);
    assert.deepEqual(t2Pack.symbols, [{ kind: 'export', name: 'ApprovalBanner', path: 'src/approval-banner.tsx' }]);
    assert.deepEqual(t2Pack.expected_checks, ['node -e "process.exit(0)"']);
    assert.equal(t2Pack.write_set, 'closed');

    // Now open a CR for T2 and run plan scope add -> updates BOTH PLAN.json and IMPLEMENTATION-PACK.json exact_paths
    const fb = op.runtimeFeedback(dir, null, { class: 'spec_gap', criteria: ['A2'], summary: 'precisa do estilo banner.css', tasks: ['T2'], by: 'dev' });
    const scoped = op.runtimePlanScopeAdd(dir, null, { task: 'T2', paths: ['src/banner.css'], cr: fb.id, by: 'tl', reason: 'inclui CSS necessario' });
    assert.equal(scoped.pack_updated, true);
    const packScoped = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.deepEqual(packScoped.tasks.find((p) => p.id === 'T2').exact_paths, ['src/approval-banner.tsx', 'src/banner.css']);
  });

  it('#6: plan task edit T<n> --add-paths works without CR when task has never started, syncs pack, rejects frozen tests & started tasks without CR', () => {
    const dir = makePlannedRepo({ phaseStatus: 'executing' });
    // Add T2 (not started) cleanly via PLAN + PACK
    const planDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    planDoc.tasks.push({ id: 'T2', title: 'never started', wave: 2, files: ['src/base.ts'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(planDoc, null, 2));
    const packDoc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    packDoc.tasks.push({ id: 'T2', mode: 'mutating', write_set: 'closed', exact_paths: ['src/base.ts'], symbols: [{ kind: 'export', name: 'base', path: 'src/base.ts' }], contracts: ['base'], expected_checks: ['node -e "process.exit(0)"'], phase: 'F1' });
    fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify(packDoc, null, 2));

    // CLI plan task edit T2 --add-paths works directly without --cr when T2 never started
    const cli = spawnSync(process.execPath, [CLI, 'plan', 'task', 'edit', 'T2', '--add-paths', 'src/extra.ts,src/extra.css', '--by', 'planner', '--reason', 'inclui arquivo antes de iniciar', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_PROMPT: '1' },
    });
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    assert.match(cli.stdout, /T2: escopo \+src\/extra\.ts, src\/extra\.css/);
    assert.match(cli.stdout, /\+IMPLEMENTATION-PACK\.json/);

    const updatedPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(updatedPlan.tasks.find((t) => t.id === 'T2').files, ['src/base.ts', 'src/extra.ts', 'src/extra.css']);
    const updatedPack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.deepEqual(updatedPack.tasks.find((t) => t.id === 'T2').exact_paths, ['src/base.ts', 'src/extra.ts', 'src/extra.css']);

    // Frozen tests still refused
    assert.throws(
      () => op.runtimePlanTaskEdit(dir, null, { task: 'T2', addPaths: 'tests/a1.test.ts', by: 'planner', reason: 'nao deve permitir congelado' }),
      /teste congelado NUNCA entra/,
    );

    // Mark T1 as started -> refuses --add-paths without an open CR
    op.appendEvent(dir, null, { type: 'TaskStarted', work_item_id: 'T1', payload: { task: 'T1' } });
    assert.throws(
      () => op.runtimePlanTaskEdit(dir, null, { task: 'T1', addPaths: 'src/other.ts', by: 'planner', reason: 'tentativa sem CR apos inicio' }),
      /T1 já iniciou execução — para ampliar escopo de tarefa iniciada, use `oxe-cc plan scope add/,
    );
  });
});
