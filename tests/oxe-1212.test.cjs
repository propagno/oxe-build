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

describe('OXB-064: o resultado separa o que bloqueou de verdade do que não era desta execução', () => {
  it('--wave 2 com tarefas externas na onda 5: nada em blocked; external fica fora da onda (out_of_scope)', async () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T7', title: 'lint', wave: 2, files: ['src/a.js'], verify: { commands: [ok] } },
        { id: 'T1', title: 'pareamento', wave: 5, kind: 'external_delivery', files: [], blocked_by: ['propagno/oxespace#601'], verify: { commands: [ok] } },
      ],
    };
    const dir = project({ plan });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T7: { 'src/a.js': 'a' } }), skipPreflight: true, wave: 2 });
    assert.deepEqual(res.result.completed, ['T7']);
    assert.deepEqual(res.result.blocked, []);
    assert.deepEqual(res.result.failed, []);
  });

  it('sem --wave: a tarefa externa pendente vai para external_pending, e o status não é blocked', async () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T7', title: 'lint', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } },
        // The PR is not merged yet: its verify (e.g. `gh pr view … --jq .state` = MERGED) is still red.
        { id: 'T12', title: 'baselines', wave: 1, kind: 'external_delivery', files: [], blocked_by: ['propagno/oxespace#643'], verify: { commands: [fail] } },
      ],
    };
    const dir = project({ plan });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T7: { 'src/a.js': 'a' } }), skipPreflight: true });
    assert.deepEqual(res.result.blocked, []);
    assert.deepEqual(res.result.external_pending, ['T12']);
    assert.equal(res.result.status, 'completed_with_external_pending');
  });

  it('uma tarefa comum que falhou continua bloqueando', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 0 }, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: [fail] } }, { id: 'T2', title: 'b', wave: 2, depends_on: ['T1'], files: ['src/b.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}), skipPreflight: true });
    assert.ok(res.result.failed.includes('T1') || res.result.blocked.length > 0);
  });
});

describe('OXB-065: plain output when stdout is not a TTY; NDJSON task events', () => {
  const out = require('../bin/lib/oxe-cli-output.cjs');
  const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

  it('glyphs become ASCII words, box drawing becomes ASCII, accents stay UTF-8', () => {
    const text = out.toPlain('  → T3 [verify] ✓\n  → T4 ✗\n ↺ retry 2\n ⛔ orçamento esgotado\n━━━━\n✅ ok — feito…');
    assert.match(text, /-> T3 \[verify\] OK/);
    assert.match(text, /-> T4 FAIL/);
    assert.match(text, /RETRY retry 2/);
    assert.match(text, /BLOCKED orçamento esgotado/);
    assert.match(text, /^----$/m);
    assert.match(text, / ok - feito\.\.\./);
    assert.ok(/^[\x00-\x7F]*$/.test(text.replace(/[çãéíóõúâêô]/gi, '')), text);
  });

  it('plain unless stdout is a TTY; OXE_PLAIN and --plain override', () => {
    assert.equal(out.isPlainMode({ env: {}, argv: [], isTTY: false }), true);
    assert.equal(out.isPlainMode({ env: {}, argv: [], isTTY: true }), false);
    assert.equal(out.isPlainMode({ env: {}, argv: ['--plain'], isTTY: true }), true);
    assert.equal(out.isPlainMode({ env: { OXE_PLAIN: '0' }, argv: [], isTTY: false }), false);
  });

  it('the CLI piped to a file prints no banner and no box drawing, and keeps the accents', () => {
    const dir = project({ plan: { schema_version: 1, tasks: [] } });
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'scorecard', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_PLAIN: '' } });
    assert.ok(!/[━─═│]/.test(r.stdout), r.stdout);
    assert.ok(!/multi-IDE/.test(r.stdout), 'no banner');
    assert.match(r.stdout, /concluídas/);
    assert.ok(!/[✓✗]/.test(r.stdout), r.stdout);
  });

  it('--plain is accepted by any command (removed before the parsers)', () => {
    const r = spawnSync(process.execPath, [CLI, '--version', '--plain'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  it('execute --json emits one NDJSON line per task event', () => {
    const lines = [];
    const emit = out.createTaskNdjsonEmitter((l) => lines.push(JSON.parse(l)));
    emit({ type: 'AttemptStarted', work_item_id: 'T1', payload: { attempt_number: 1 } });
    emit({ type: 'executor_usage', nodeId: 'T1', detail: { cost_usd: 0.25 } });
    emit({ type: 'VerificationCompleted', work_item_id: 'T1', payload: { failed_segment: { index: 2, total: 2, command: 'npx tsc', exit_code: 2 } } });
    emit({ type: 'RetryScheduled', work_item_id: 'T1', payload: { next_attempt: 2, reason: 'verify' } });
    emit({ type: 'AttemptStarted', work_item_id: 'T1', payload: { attempt_number: 2 } });
    emit({ type: 'executor_usage', nodeId: 'T1', detail: { cost_usd: 0.1 } });
    emit({ type: 'WorkItemCompleted', work_item_id: 'T1', payload: { attempt_number: 2 } });
    emit({ type: 'WorkItemBlocked', work_item_id: 'T2', payload: { reason: 'human_gate' } });
    emit({ type: 'turn_start', nodeId: 'T1', detail: { turn: 0 } });
    assert.deepEqual(lines.map((l) => [l.task, l.attempt, l.status]), [['T1', 1, 'running'], ['T1', 1, 'retry'], ['T1', 2, 'running'], ['T1', 2, 'completed'], ['T2', 0, 'blocked']]);
    assert.deepEqual(lines[1].failed_segment, { index: 2, total: 2, command: 'npx tsc', exit_code: 2 });
    assert.equal(lines[1].cost_usd, 0.25);
    assert.equal(lines[3].cost_usd, 0.1);
    assert.equal(lines[3].total_cost_usd, 0.35);
    assert.equal(lines[3].failed_segment, undefined);
  });
});
