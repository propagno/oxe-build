'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
};

const writeRel = (dir, rel, content) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
};

describe('OXB-C16 (UX/CLI dogfooding close/seams/ci/dossier/shell)', () => {
  it('1+4) program close --by-ci skips behavior_missing seam block and 1/1 program skips next-phase handoff requirement', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c16-close-'));
    dirs.push(dir);
    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, 'src/flow.js', 'module.exports = () => "ok";\n');
    writeRel(
      dir,
      '.oxe/SPEC.md',
      [
        '# SPEC',
        '',
        '## Critérios de aceite',
        '',
        '| ID | Critério | Como verificar |',
        '|---|---|---|',
        '| A1 | Fluxo completo | rodar o fluxo ponta a ponta (e2e) |',
        '',
      ].join('\n'),
    );
    writeRel(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Única\n\n**Critérios de aceite:** A1\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    const okCmd = `${process.execPath.replace(/\\/g, '/')} -e "process.exit(0)"`;
    writeRel(dir, '.oxe/PLAN.md', '# PLAN\n\n### T1 — Flow\n- **Verificar:** `' + okCmd + '`\n- **Aceite vinculado:** A1\n');
    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F1',
      tasks: [{ id: 'T1', title: 'Flow', wave: 1, files: ['src/flow.js'], acceptance: ['A1'], verify: { commands: [okCmd] }, done: true }],
    });
    writeRel(dir, '.oxe/IMPLEMENTATION-PACK.json', {
      schema_version: 1,
      ready: true,
      tasks: [{ id: 'T1', exact_paths: ['src/flow.js'], symbols: [], contracts: [], write_set: 'closed', expected_checks: [okCmd], mode: 'mutating' }],
    });

    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    op.runtimeProgramInit(dir, null, {});
    op.runtimeProgramStart(dir, null, 'F1');
    const head = git(dir, 'rev-parse', 'HEAD');
    op.writeRunState(dir, null, {
      run_id: 'oxe-run-c16-1',
      status: 'completed',
      verification_status: 'completed',
      verification_evidence_head: head,
      verification_check_results: [{ check_id: 'check-a1', status: 'pass', acceptance_ref: 'A1' }],
      canonical_state: { completedWorkItems: ['T1'] },
    });

    const d = op.runtimeDossier(dir, null, { byCi: true });
    assert.equal(d.handoff_required, false);

    // Without --by-ci: seams blocks on A1 behavior_missing, NOT on handoff vazio (1/1 phase)
    const noCi = op.runtimeProgramClose(dir, null, { commit: false });
    assert.equal(noCi.closed, false);
    assert.ok(noCi.gate.reasons.some((r) => /costura:.*A1/.test(r)), JSON.stringify(noCi.gate.reasons));
    assert.equal(noCi.gate.reasons.some((r) => /handoff vazio/.test(r)), false, JSON.stringify(noCi.gate.reasons));

    // With --by-ci (pre-verified CI attached on HEAD): closes cleanly without manual seams --behavior-ran or handoff
    op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A1', by: 'coordenacao', evidence: 'ci-run-12345' });
    op.runtimeCiAttach(dir, null, { run: '12345', repo: 'acme/app', head });
    const withCi = op.runtimeProgramClose(dir, null, {
      commit: false,
      byCi: true,
      by: 'coordenacao',
      reason: 'CI 6/6 shards verdes na main',
      ghSpawn: () => ({
        status: 0,
        stdout: JSON.stringify({ status: 'completed', conclusion: 'success', headSha: head, workflowName: 'CI' }),
        stderr: '',
      }),
    });
    assert.equal(withCi.closed, true, JSON.stringify(withCi.gate.reasons));
  });

  it('2) findUnpromotedDoneTasks returns no unpromoted false positive when HEAD is already on origin/main after squash/cherry-pick', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c16-unpromoted-'));
    dirs.push(dir);
    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, 'src/a.txt', 'v1\n');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    // Program branch commit that was later squashed/edited onto main
    git(dir, 'checkout', '-qb', 'oxe/program-f1');
    writeRel(dir, 'src/a.txt', 'v2-from-t1\n');
    git(dir, 'add', 'src/a.txt');
    git(dir, 'commit', '-qm', 'feat: t1\n\nOXE-Task: T1');
    const preSquashSha = git(dir, 'rev-parse', 'HEAD');

    // Main receives squashed T1 + later T2 edit on same file; program branch merges/resets onto main
    git(dir, 'checkout', '-q', 'main');
    writeRel(dir, 'src/a.txt', 'v3-after-t1-and-t2-squash\n');
    git(dir, 'add', 'src/a.txt');
    git(dir, 'commit', '-qm', 'feat: squashed T1 + T2 (#99)');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);

    writeRel(dir, '.oxe/PLAN.json', {
      schema_version: 1,
      phase: 'F1',
      tasks: [{ id: 'T1', title: 'A', wave: 1, files: ['src/a.txt'], acceptance: ['A1'], done: true, done_commit: preSquashSha }],
    });

    const check = op.findUnpromotedDoneTasks(dir, null, { id: 'F1' }, { base: 'origin/main' });
    assert.deepEqual(check.unpromoted, []);
  });

  it('3) runtimeCiAttach and runtimeDossier emit explicit warning when PROGRAM.json has active_phase: null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c16-active-null-'));
    dirs.push(dir);
    writeRel(dir, '.gitignore', '.oxe/\n');
    writeRel(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ok | pass |\n');
    writeRel(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
    writeRel(dir, '.oxe/STATE.md', '# STATE\n');
    writeRel(dir, '.oxe/PLAN.md', '# PLAN\n');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@oxe.test');
    git(dir, 'config', 'user.name', 'OXE Test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');

    op.runtimeProgramInit(dir, null, {}); // active_phase is null until program start!
    const ci = op.runtimeCiAttach(dir, null, { run: '999', head: git(dir, 'rev-parse', 'HEAD') });
    assert.match(ci.warning || '', /active_phase: null/);
    const dos = op.runtimeDossier(dir, null, {});
    assert.match(dos.warning || '', /active_phase: null/);
  });
});
