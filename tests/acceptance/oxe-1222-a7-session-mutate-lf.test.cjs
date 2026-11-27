'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const op = require('../../bin/lib/oxe-operational.cjs');
const suiteImpact = require('../../bin/lib/oxe-suite-impact.cjs');
const mutateLib = require('../../bin/lib/oxe-plan-mutate.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkProject(prefix = 'oxe-1222-a7-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  return dir;
}

describe('A7 — OXB-222-07: Session prd lint, safe decision add, unrun_acceptance_ci, symbol-first mutate, and LF tsconfig', () => {
  it('OXB-222-07: prd lint --session resolves session PRD and decision add preserves existing root ADRs', () => {
    const dir = mkProject('oxe-1222-a7-sess-');
    const sessDir = path.join(dir, '.oxe', 'sessions', 's001-demo');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'SPEC.md'), '# SPEC\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ok | `node -e "0"` |\n');
    fs.writeFileSync(path.join(sessDir, 'ROADMAP.md'), '# ROADMAP\n## Fase 1 — Demo\n**Requisitos:** R1\n**Critérios de aceite:** A1\n');
    fs.writeFileSync(path.join(sessDir, 'PRD.md'), [
      '---',
      'version: 1',
      'status: approved',
      '---',
      '# PRD — Session Demo',
      '## Problema e objetivo',
      'Validar prd lint --session.',
      '## Objetivos e métricas',
      '| ID | Objetivo | Métrica | Meta | Como medir |',
      '|---|---|---|---|---|',
      '| M-1 | Cobertura | Pass | 100% | test |',
      '## Histórias de usuário',
      '| ID | Como | Quero | Para | Requisitos | Critérios |',
      '|---|---|---|---|---|---|',
      '| US-1 | dev | validar sessao | garantir rastreio | R1 | A1 |',
    ].join('\n'));

    // 1. prd lint --session s001-demo resolves session PRD (even with no root .oxe/PRD.md)
    const prdRes = spawnSync(
      process.execPath,
      [BIN, 'prd', 'lint', '--session', 'sessions/s001-demo', '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(prdRes.status, 0, prdRes.stderr || prdRes.stdout);
    const prdOut = JSON.parse(prdRes.stdout);
    assert.equal(prdOut.exists, true);
    assert.equal(prdOut.ok, true);
    assert.match(prdOut.file, /sessions\/s001-demo\/PRD\.md/);

    // 2. decision add in a session preserves pre-existing root docs/adr/D-1..D-2 and allocates D-3
    const adrDir = path.join(dir, 'docs', 'adr');
    fs.mkdirSync(adrDir, { recursive: true });
    const d1Content = '# D-1 — Original Root Decision 1\n\nCustom preserved ADR 1.\n';
    const d2Content = '# D-2 — Original Root Decision 2\n\nCustom preserved ADR 2.\n';
    fs.writeFileSync(path.join(adrDir, 'D-1-original-root-1.md'), d1Content);
    fs.writeFileSync(path.join(adrDir, 'D-2-original-root-2.md'), d2Content);
    fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxe', 'program', 'decisions.ndjson'),
      [
        JSON.stringify({ kind: 'decision', id: 'D-1', title: 'Original Root Decision 1', status: 'active', by: 'arch', at: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({ kind: 'decision', id: 'D-2', title: 'Original Root Decision 2', status: 'active', by: 'arch', at: '2026-01-02T00:00:00.000Z' }),
      ].join('\n') + '\n',
    );

    const added = op.runtimeDecision(dir, 'sessions/s001-demo', {
      action: 'add',
      title: 'Session-scoped architecture decision',
      by: 'architect',
    });
    assert.equal(added.decision.id, 'D-3', `must allocate D-3 past existing D-1/D-2, got ${added.decision.id}`);
    assert.ok(fs.existsSync(path.join(adrDir, 'D-1-original-root-1.md')), 'D-1 must still exist');
    assert.ok(fs.existsSync(path.join(adrDir, 'D-2-original-root-2.md')), 'D-2 must still exist');
    assert.match(fs.readFileSync(path.join(adrDir, 'D-1-original-root-1.md'), 'utf8'), /Custom preserved ADR 1/);
    const readmeAfter = fs.readFileSync(path.join(adrDir, 'README.md'), 'utf8');
    assert.match(readmeAfter, /D-1/);
    assert.match(readmeAfter, /D-2/);
    assert.match(readmeAfter, /D-3/);
  });

  it('OXB-222-07: plan lint suppresses false unrun_acceptance_ci when test runner covers tests/acceptance', () => {
    const dir = mkProject('oxe-1222-a7-ci-');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests', 'acceptance'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node scripts/quality-check.cjs test-root',
      },
    }, null, 2));
    fs.writeFileSync(
      path.join(dir, 'scripts', 'quality-check.cjs'),
      "const root = 'tests/acceptance'; // runs tests/*.test.cjs and tests/acceptance/*.test.cjs\n",
    );
    fs.writeFileSync(
      path.join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
    );
    fs.writeFileSync(path.join(dir, 'tests', 'acceptance', 'oxe-sample.test.cjs'), "const { it } = require('node:test'); it('ok', () => {});\n");

    const planDoc = {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'ok', wave: 1, files: ['scripts/quality-check.cjs'], acceptance: ['A1'], verify: { commands: ['node --test tests/acceptance/oxe-sample.test.cjs'] } }],
      acceptance_tests: [{ criterion: 'A1', files: ['tests/acceptance/oxe-sample.test.cjs'], command: 'node --test tests/acceptance/oxe-sample.test.cjs' }],
    };

    const unrun = suiteImpact.findUnrunFrozenAcceptanceCi(dir, planDoc, {
      files: ['package.json', 'scripts/quality-check.cjs', '.github/workflows/ci.yml', 'tests/acceptance/oxe-sample.test.cjs'],
    });
    assert.deepEqual(unrun, [], `tests/acceptance/*.cjs covered by quality-check.cjs test-root + npm test must not trigger false unrun_acceptance_ci: ${JSON.stringify(unrun)}`);
  });

  it('OXB-222-07: plan mutate prioritizes task symbols/changed lines and runtime tsconfigs enforce newLine lf', () => {
    // 1. packages/runtime/tsconfig.json and tsconfig.test.json enforce "newLine": "lf"
    const tsMain = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'runtime', 'tsconfig.json'), 'utf8'));
    const tsTest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'runtime', 'tsconfig.test.json'), 'utf8'));
    assert.equal(tsMain.compilerOptions.newLine, 'lf', 'packages/runtime/tsconfig.json must set compilerOptions.newLine = "lf"');
    assert.equal(tsTest.compilerOptions.newLine, 'lf', 'packages/runtime/tsconfig.test.json must set compilerOptions.newLine = "lf"');

    // 2. plan mutate exports prioritizeMutants and picks mutants inside task symbol / changed lines first
    assert.equal(typeof mutateLib.prioritizeMutants, 'function', 'oxe-plan-mutate must export prioritizeMutants');
    const sourceLines = [];
    for (let i = 0; i < 40; i += 1) {
      sourceLines.push(`function unrelated${i}(x) { return x > ${i} ? x + 1 : 0; }`);
    }
    sourceLines.push('function targetFeature(n) {');
    sourceLines.push('  if (n >= 10) return n * 2;');
    sourceLines.push('  return n + 1;');
    sourceLines.push('}');
    const src = sourceLines.join('\n');

    const { mutantsOf } = require('../../bin/lib/oxe-test-rigor.cjs');
    const allMutants = mutantsOf(src, Infinity);
    assert.ok(allMutants.length > 20);
    const picked = mutateLib.prioritizeMutants(allMutants, src, {
      limit: 4,
      symbols: ['targetFeature'],
      changedLines: [42, 43],
    });
    assert.ok(picked.length > 0 && picked.length <= 4);
    assert.ok(
      picked.some((m) => m.line >= 41 && m.line <= 44),
      `prioritizeMutants must select mutants inside targetFeature / changed lines first, got lines: ${picked.map((m) => m.line).join(', ')}`,
    );
  });
});
