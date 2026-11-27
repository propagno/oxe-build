'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gates = require('../../bin/lib/oxe-phase-gates.cjs');
const op = require('../../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkGitRepo(prefix = 'oxe-1222-a1-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A1 — OXB-222-01: Path-aware phase_gates, preflight.triggers in verify, and suggestPathGates', () => {
  it('OXB-222-01: phase_gates supports paths/globs filtering with safe fallback', () => {
    const declared = gates.readPhaseGates(
      {},
      {
        phase_gates: [
          { id: 'css-guard', command: 'node -e "process.exit(0)"', paths: ['src/**/*.css', 'src/styles/**'] },
          { id: 'db-guard', command: 'node -e "process.exit(0)"', globs: ['db/migrations/**'] },
          { id: 'always-on', command: 'node -e "process.exit(0)"' },
        ],
      },
    );

    assert.deepEqual(declared[0].paths, ['src/**/*.css', 'src/styles/**']);
    assert.deepEqual(declared[1].paths, ['db/migrations/**']);
    assert.deepEqual(declared[2].paths, []);

    // Only unrelated file changed -> only always-on runs
    const onlyCli = gates.gateChecks(declared, 'phase_verify', { changedFiles: ['bin/cli.js'] });
    assert.deepEqual(onlyCli.map((c) => c.phase_gate), ['always-on']);

    // CSS file changed (including Windows separator normalization) -> css-guard + always-on
    const withCss = gates.gateChecks(declared, 'phase_verify', { changedFiles: ['src\\components\\Button.css'] });
    assert.deepEqual(withCss.map((c) => c.phase_gate), ['css-guard', 'always-on']);

    // Safe fallback: when changedFiles is null/undefined, all gates run (never false green)
    const fallback = gates.gateChecks(declared, 'phase_verify', {});
    assert.deepEqual(fallback.map((c) => c.phase_gate), ['css-guard', 'db-guard', 'always-on']);
  });

  it('OXB-222-01: runtime verify runs matched preflight.triggers automatically', async () => {
    const dir = mkGitRepo('oxe-1222-a1-verify-');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'ui', 'App.css'), '.btn { color: red; }\n');

    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      profile: 'lean',
      preflight: {
        triggers: [
          {
            name: 'css-contract-trigger',
            globs: ['src/ui/**/*.css'],
            command: 'node -e "console.error(\'css contract violated\'); process.exit(1)"',
          },
          {
            name: 'unmatched-trigger',
            globs: ['mobile/**'],
            command: 'node -e "console.error(\'should not run\'); process.exit(1)"',
          },
        ],
      },
    }, null, 2));

    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), [
      '---',
      'oxe_doc: spec',
      'status: approved',
      '---',
      '# SPEC',
      '## Critérios de aceite',
      '| ID | Critério | Risco | Como verificar |',
      '|---|---|---|---|',
      '| A1 | smoke | P1 | `node -e "process.exit(0)"` |',
    ].join('\n'));

    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
      schema_version: 1,
      tasks: [
        {
          id: 'T1',
          title: 'edit css',
          wave: 1,
          files: ['src/ui/App.css'],
          acceptance: ['A1'],
          verify: { commands: ['node -e "process.exit(0)"'] },
        },
      ],
      acceptance_tests: [
        { criterion: 'A1', command: 'node -e "process.exit(0)"', files: [] },
      ],
    }, null, 2));

    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n## Onda 1\n### T1 — edit css\n- **Verificar:**\n  - Comando: `node -e "process.exit(0)"`\n- **Aceite vinculado:** A1\n');

    op.compileRuntimeGraph(dir, null);
    const verified = await op.runRuntimeVerify(dir, null, {
      changedFiles: ['src/ui/App.css'],
    });

    const triggerResult = (verified.report.check_results || []).find(
      (r) => String(r.check_id || '').includes('css-contract-trigger'),
    );
    assert.ok(triggerResult, 'matched preflight.trigger must execute inside runtime verify');
    assert.equal(triggerResult.status, 'fail');
    assert.equal(verified.report.status, 'failed');

    const unmatched = (verified.report.check_results || []).find(
      (r) => String(r.check_id || '').includes('unmatched-trigger'),
    );
    assert.equal(unmatched, undefined, 'unmatched preflight.trigger must not execute');
  });

  it('OXB-222-01: detectGateCandidates and suggestPathGates discover generic contract guards', () => {
    const dir = mkGitRepo('oxe-1222-a1-detect-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      scripts: {
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
      },
    }));
    fs.mkdirSync(path.join(dir, 'tests', 'contracts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests', 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'contracts', 'ui-copy.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'contracts', 'css-tokens.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'contracts', 'policy-change-guard.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'contracts', 'messages-contract.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'db', 'schema-pin.test.ts'), '');
    fs.writeFileSync(path.join(dir, 'tests', 'db', 'migration-numbering.test.ts'), '');

    const candidates = gates.detectGateCandidates(dir);
    const gov = candidates.find((c) => c.id === 'governance');
    assert.ok(gov, 'governance candidate must exist');
    for (const expected of [
      'tests/contracts/ui-copy.test.ts',
      'tests/contracts/css-tokens.test.ts',
      'tests/contracts/policy-change-guard.test.ts',
      'tests/contracts/messages-contract.test.ts',
      'tests/db/schema-pin.test.ts',
      'tests/db/migration-numbering.test.ts',
    ]) {
      assert.ok(gov.files.includes(expected), `detectGateCandidates must find ${expected}`);
    }

    assert.equal(typeof gates.suggestPathGates, 'function', 'suggestPathGates must be exported');
    const suggested = gates.suggestPathGates(dir);
    assert.ok(Array.isArray(suggested) && suggested.length >= 2, 'suggestPathGates must return declarative phase_gates suggestions');
    assert.ok(suggested.some((g) => Array.isArray(g.paths) && g.paths.length > 0 && g.id && g.command), 'suggestions must include id, command and paths');
  });
});
