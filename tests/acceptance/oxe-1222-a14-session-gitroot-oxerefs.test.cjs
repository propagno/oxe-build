'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gitRootLib = require('../../bin/lib/oxe-git-root.cjs');
const projectEnv = require('../../bin/lib/oxe-project-env.cjs');
const runtime = require('../../lib/runtime/index.js');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-a14-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A14 — Sessão unificada, resolveProjectGitRoot anti-$HOME/.git e verify.allow_oxe_refs (OXB-222-14)', () => {
  it('OXB-222-14: resolveProjectGitRoot rejects inherited $HOME/.git and non-git temp dirs, detects hazard in doctor --project', () => {
    const repo = mkGitRepo('oxe-a14-git-');
    const sub = path.join(repo, 'packages', 'sub');
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a14-nongit-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a14-home-'));
    try {
      fs.mkdirSync(sub, { recursive: true });
      fs.mkdirSync(path.join(fakeHome, '.git'), { recursive: true });

      const resolvedRepo = gitRootLib.resolveProjectGitRoot(repo);
      assert.ok(resolvedRepo, 'real git repo must resolve');
      assert.equal(path.resolve(resolvedRepo).toLowerCase(), fs.realpathSync(repo).toLowerCase());

      const resolvedSub = gitRootLib.resolveProjectGitRoot(sub);
      assert.ok(resolvedSub, 'subdirectory of real git repo must resolve');
      assert.equal(path.resolve(resolvedSub).toLowerCase(), fs.realpathSync(repo).toLowerCase());

      // Non-git temp dir must return null even if os.homedir() has an accidental .git
      assert.equal(gitRootLib.resolveProjectGitRoot(nonGit), null);

      // Home .git hazard detector + doctor --project non-blocking warning
      const hazard = gitRootLib.detectHomeGitHazard(repo, { homeDir: fakeHome });
      assert.equal(hazard.hazard, true);
      assert.ok(hazard.home_git);

      const envRes = projectEnv.checkProjectEnvironment(repo, { nativeCheck: false, homeDir: fakeHome });
      assert.equal(envRes.ok, true, 'home .git hazard warning must be non-blocking');
      assert.ok(
        envRes.warnings.some((w) => /\.git/i.test(w) && /home|usuário/i.test(w)),
        `expected home .git warning, got: ${JSON.stringify(envRes.warnings)}`,
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(nonGit, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('OXB-222-14: CLI spec check and program phase add resolve the active session from .oxe/SESSIONS.md automatically', () => {
    const dir = mkGitRepo('oxe-a14-sess-');
    try {
      const sessDir = path.join(dir, '.oxe', 'sessions', 's001-demo');
      fs.mkdirSync(path.join(sessDir, 'program'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));
      fs.writeFileSync(path.join(dir, '.oxe', 'SESSIONS.md'), '# Sessions\n\nSessão ativa: `sessions/s001-demo`\n');
      fs.writeFileSync(path.join(sessDir, 'SPEC.md'), [
        '# SPEC',
        '',
        '## Requisitos',
        '| R-ID | Requisito | Versão | Critérios |',
        '|---|---|---|---|',
        '| R1 | Req 1 | v1 | A1 |',
        '',
        '## Critérios de aceite',
        '| ID | Critério | Risco | Como verificar |',
        '|---|---|---|---|',
        '| A1 | Critério 1 | P2 | `node -e "process.exit(0)"` |',
        '',
        '## Bordas e proibições',
        '- Proibido falhar silenciosamente.',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(sessDir, 'ROADMAP.md'), [
        '# Roadmap',
        '',
        '## Fase 1 — Base',
        '**Requisitos:** R1',
        '**Critérios de aceite:** A1',
        '**Escopo:** Base',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(sessDir, 'program', 'PROGRAM.json'), JSON.stringify({
        schema_version: 1,
        roadmap_ref: '.oxe/sessions/s001-demo/ROADMAP.md',
        active_phase: null,
        phases: [
          { id: 'F1', title: 'Base', requirements: ['R1'], acceptance: ['A1'], scope: 'Base', status: 'closed' },
        ],
      }, null, 2));

      // Notice: NO root .oxe/SPEC.md and NO root .oxe/program/PROGRAM.json!
      assert.equal(fs.existsSync(path.join(dir, '.oxe', 'SPEC.md')), false);
      assert.equal(fs.existsSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json')), false);

      const specOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'spec', 'check', '--fast', '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(specOut.ok, true, `spec check failed: ${JSON.stringify(specOut)}`);
      assert.match(specOut.spec, /sessions\/s001-demo\/SPEC\.md$/);
      assert.equal(specOut.summary.criteria, 1);

      const addOut = JSON.parse(execFileSync(
        process.execPath,
        [
          BIN, 'program', 'phase', 'add',
          '--after', 'F1',
          '--title', 'Fase 2 Sessao',
          '--requirements', 'R2',
          '--acceptance', 'A2',
          '--scope', 'Escopo 2',
          '--by', 'tester',
          '--reason', 'validar sessao automatica',
          '--dir', dir,
          '--json',
        ],
        { encoding: 'utf8' },
      ));
      assert.equal(addOut.phase, 'F2');
      const updatedProg = JSON.parse(fs.readFileSync(path.join(sessDir, 'program', 'PROGRAM.json'), 'utf8'));
      assert.ok(updatedProg.phases.some((p) => p.id === 'F2' && p.title === 'Fase 2 Sessao'));

      // Also verify `oxe-cc prd lint` resolves active session PRD automatically without --session
      fs.writeFileSync(path.join(sessDir, 'PRD.md'), [
        '# PRD',
        '## Problema e objetivo',
        'Resolver sessao.',
        '## Histórias de usuário',
        '| ID | Como | Quero | Para | Requisitos | Critérios |',
        '|---|---|---|---|---|---|',
        '| US-1 | dev | sessao | evitar espelhamento | R1 | A1 |',
        '',
      ].join('\n'));
      const prdOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'prd', 'lint', '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(prdOut.ok, true);
      assert.match(prdOut.file, /sessions\/s001-demo\/PRD\.md$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-222-14: verification-compiler respects allowOxeRefs: true while blocking .oxe/ leaks by default', async () => {
    const dir = mkGitRepo('oxe-a14-oxerefs-');
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'oxe-helper.cjs'),
        "'use strict';\nconst precheck = '.oxe/precheck-ws';\nmodule.exports = { precheck };\n",
      );
      const suite = {
        checks: [
          {
            id: 'check-pack-t1',
            type: 'command',
            acceptance_ref: null,
            command: null,
            files_exist: ['src/oxe-helper.cjs'],
            exports_expected: [{ file: 'src/oxe-helper.cjs', name: 'precheck' }],
            evidence_type_expected: 'verification_summary',
            required: true,
          },
        ],
        compiled_at: new Date().toISOString(),
        spec_hash: 's1',
        plan_hash: 'p1',
      };

      // Default (strict): fails with oxe_internal_reference
      const strictRes = await runtime.executeSuite(suite, dir, { runId: 'r-strict', workItemId: 'T1' });
      assert.equal(strictRes.results[0].status, 'fail');
      assert.match(String(strictRes.results[0].error || ''), /oxe_internal_reference/);

      // With verify.allow_oxe_refs: true -> passes cleanly (also verify verify.allow_oxe_refs is wired in oxe-operational)
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ verify: { allow_oxe_refs: true } }, null, 2));
      const allowedRes = await runtime.executeSuite(suite, dir, { runId: 'r-allow', workItemId: 'T1', allowOxeRefs: true });
      assert.equal(allowedRes.results[0].status, 'pass', `expected pass with verify.allow_oxe_refs: true: ${JSON.stringify(allowedRes.results[0])}`);
      const opSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'bin', 'lib', 'oxe-operational.cjs'), 'utf8');
      assert.match(opSrc, /allow_oxe_refs/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
