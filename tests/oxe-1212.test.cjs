'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — handoff from the oxespace 1.5.0 TECH LEAD (docs/oxespace-1.5/HANDOFF-1.21.2.md). Each test reproduces the
// evidence of run oxe-run-mw28b0n9-3s0gda.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');

function project({ plan, files = {}, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, ...config }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const writer = (dir, byTask) => ({
  async execute(node) {
    const files = byTask[node.id] || {};
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return { success: true, failure_class: null, evidence: Object.keys(files), output: 'ok', completed_by: 'finish_task' };
  },
});

const fail = 'node -e "process.exit(1)"';
const ok = 'node -e "process.exit(0)"';

describe('OXB-067: o rollback da tentativa falha cobre as edições fora do escopo', () => {
  it('arquivo dentro e fora de files: os dois restaurados, os dois no patch, ScopeViolation emitido', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 0 }, tasks: [{ id: 'T13', title: 'threads', wave: 1, files: ['src/a.js'], verify: { commands: [fail] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/ThreadView.tsx': 'view0\n' } });
    const executor = writer(dir, { T13: { 'src/a.js': 'a1\n', 'src/ThreadView.tsx': 'view1 edited outside\n', 'src/new-outside.js': 'new\n' } });
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(read(dir, 'src/a.js'), 'a0\n');
    assert.equal(read(dir, 'src/ThreadView.tsx'), 'view0\n', 'a edição fora do escopo não fica na árvore');
    assert.equal(fs.existsSync(path.join(dir, 'src', 'new-outside.js')), false);
    const run = op.readRunState(dir, null).run_id;
    const saved = path.join(dir, '.oxe', 'runs', run, 'attempts', 'T13-failed');
    const patch = fs.readFileSync(path.join(saved, 'changes.patch'), 'utf8');
    assert.match(patch, /a1/);
    assert.match(patch, /view1 edited outside/);
    assert.equal(read(saved, 'new/src/new-outside.js'), 'new\n');
    const sv = op.readEvents(dir, null).filter((e) => e.type === 'ScopeViolation');
    assert.ok(sv.length >= 1);
    assert.deepEqual(sv[0].payload.paths, ['src/ThreadView.tsx', 'src/new-outside.js']);
    assert.equal(sv[0].payload.outcome, 'failed');
  });

  it('tentativa que passa: o checkpoint não leva o arquivo de fora e ele não é descartado; checkpoint_incomplete lista', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T7', title: 'lint', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/other.js': 'o0\n' } });
    const executor = writer(dir, { T7: { 'src/a.js': 'a1\n', 'src/other.js': 'o1\n' } });
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, checkpointCommits: true });
    assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/), ['src/a.js']);
    assert.equal(read(dir, 'src/other.js'), 'o1\n', 'não descartado em silêncio');
    const events = op.readEvents(dir, null);
    const sv = events.find((e) => e.type === 'ScopeViolation');
    assert.equal(sv.payload.outcome, 'passed');
    const warn = events.find((e) => e.type === 'PolicyWarning' && e.payload.reason === 'checkpoint_incomplete');
    assert.deepEqual(warn.payload.scope_violation, ['src/other.js']);
  });

  it('um arquivo de fora que já estava sujo antes da tarefa nunca é revertido (vai para dirty-before)', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 0 }, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], verify: { commands: [fail] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/mine.js': 'm0\n' } });
    fs.writeFileSync(path.join(dir, 'src', 'mine.js'), 'my work\n');
    const executor = writer(dir, { T1: { 'src/a.js': 'a1\n', 'src/mine.js': 'my work + agent edit\n' } });
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(read(dir, 'src/mine.js'), 'my work + agent edit\n', 'o trabalho prévio não é revertido');
  });
});

describe('OXB-068: tarefa verify_only tem escopo vazio obrigatório', () => {
  it('um verify_only que escreve arquivo gera ScopeViolation e o arquivo é removido; sem aviso empty_mutation_scope', async () => {
    const plan = {
      schema_version: 1,
      tasks: [{ id: 'T12', title: 'baselines (PR externo)', wave: 1, kind: 'verify_only', files: [], verify: { commands: ['node -e "require(\'fs\').writeFileSync(\'gen.txt\',\'x\')"'] } }],
    };
    const dir = project({ plan });
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}), skipPreflight: true });
    const events = op.readEvents(dir, null);
    const sv = events.find((e) => e.type === 'ScopeViolation');
    assert.ok(sv, 'ScopeViolation emitido');
    assert.deepEqual(sv.payload.paths, ['gen.txt']);
    assert.equal(sv.payload.verify_only, true);
    assert.equal(fs.existsSync(path.join(dir, 'gen.txt')), false, 'a escrita do verify_only é desfeita');
    assert.ok(!events.some((e) => e.type === 'PolicyWarning' && e.payload && e.payload.reason === 'empty_mutation_scope'));
  });
});

describe('OXB-063: dry-verify não roda o verify de tarefa externa pendente', () => {
  it('external_delivery com blocked_by aberto vira external_pending (aviso), e o lint não falha por ela', () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T1', title: 'pareamento (PR externo)', wave: 1, kind: 'external_delivery', files: [], blocked_by: ['propagno/oxespace#601'], verify: { commands: ['gh pr view 601 --json state'] } },
        { id: 'T12', title: 'baselines', wave: 1, kind: 'verify_only', files: [], blocked_by: ['propagno/oxespace#643'], verify: { commands: ['node -e "process.exit(1)"'] } },
      ],
    };
    const dir = project({ plan });
    const lint = op.runtimePlanLint(dir, null, { dryVerify: true });
    const verdicts = Object.fromEntries((lint.dry_verify || []).map((r) => [r.task, r.verdict]));
    assert.deepEqual(verdicts, { T1: 'external_pending', T12: 'external_pending' });
    assert.ok(!lint.errors.some((e) => /^T1:|^T12:/.test(e)), lint.errors.join('\n'));
    assert.match(lint.warnings.join('\n'), /T1: verify não rodado — aguardando propagno\/oxespace#601/);
  });

  it('com o PR mergeado, o verify volta a rodar como sempre', () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T3', title: 'tokens', wave: 1, kind: 'verify_only', files: [], blocked_by: ['o/r#604'], verify: { commands: ['node -e "process.exit(0)"'] } }] };
    const dir = project({ plan, config: { external_dependency_check: true } });
    const merged = () => ({ status: 0, stdout: 'MERGED\n' });
    const lint = op.runtimePlanLint(dir, null, { dryVerify: true, ghSpawn: merged });
    assert.equal((lint.dry_verify || []).find((r) => r.task === 'T3').verdict, 'already_green');
  });
});

describe('snapshot limitado ao projeto (projeto dentro de um repositório maior)', () => {
  it('só vê o que mudou sob o diretório do projeto, com caminhos relativos a ele', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-mono-'));
    dirs.push(repo);
    git(repo, 'init', '-q');
    fs.mkdirSync(path.join(repo, 'apps', 'web', 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'apps', 'web', 'src', 'a.js'), 'x');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'y');
    assert.deepEqual(op.projectStatusPaths(path.join(repo, 'apps', 'web')), ['src/a.js']);
  });
});
