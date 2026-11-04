'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const scorecard = require('../bin/lib/oxe-scorecard.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21.1 — P0 from the oxespace 1.5.0 audit (TECH LEAD, docs/oxespace-1.5/BACKLOG.md). Each test reproduces the
// evidence of run oxe-run-mw28b0n9-3s0gda (F1): stale graph (OXB-053/052), criterion check in intermediate tasks
// (OXB-053/046), external dependencies as gates (OXB-047), env leak (OXB-042), inplace contamination and --wave
// (OXB-051), and a scorecard that read 0.95 on a phase full of retries (OXB-054).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function project({ criteria = '| A1 | a | manual |', plan, files = {}, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1211-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), `# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n${criteria}\n`);
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

const writer = (dir, byTask, ran = []) => ({
  async execute(node) {
    ran.push(node.id);
    const files = byTask[node.id] || {};
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return { success: true, failure_class: null, evidence: Object.keys(files), output: 'ok', completed_by: 'finish_task' };
  },
});

const ok = 'node -e "process.exit(0)"';

describe('OXB-053/052: grafo velho', () => {
  it('um CR que muda os arquivos da tarefa depois do compile recompila e o checkpoint leva todos os arquivos', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T4', title: 'cor do workspace', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan });
    op.compileExecutionGraphFromArtifacts(dir, null);
    // CR-03 after the compile: T4 also owns b.js and c.js (oxespace 1.5.0 F1, run 3).
    plan.tasks[0].files = ['src/a.js', 'src/b.js', 'src/c.js'];
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
    const executor = writer(dir, { T4: { 'src/a.js': 'a', 'src/b.js': 'b', 'src/c.js': 'c' } });
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, checkpointCommits: true });
    const committed = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/).sort();
    assert.deepEqual(committed, ['src/a.js', 'src/b.js', 'src/c.js']);
    assert.equal(git(dir, 'status', '--porcelain', '--', 'src').stdout.trim(), '', 'nada do escopo ficou solto');
    assert.ok(op.readEvents(dir, null).some((e) => e.payload && e.payload.reason === 'plan_changed_since_compile'));
  });

  it('tarefas done não são refeitas por um execute com grafo antigo', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }, { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan });
    op.compileExecutionGraphFromArtifacts(dir, null);
    const marked = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    marked.tasks[0].done = true; // `oxe-cc plan done T1` after the compile
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(marked, null, 2));
    const ran = [];
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T2: { 'src/b.js': 'b' } }, ran), skipPreflight: true });
    assert.deepEqual(ran, ['T2']);
  });
});

describe('OXB-053/046: a verificação do critério só na tarefa que o completa', () => {
  it('o "Como verificar" do A4 entra só no verify da última tarefa do critério', () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T8', title: 'diálogos threads', wave: 1, files: ['src/t8.js'], acceptance: ['A4'], verify: { commands: ['node t8.test.js'] } },
        { id: 'T9', title: 'diálogos oxequery', wave: 1, files: ['src/t9.js'], acceptance: ['A4'], verify: { commands: ['node t9.test.js'] } },
        { id: 'T10', title: 'resto', wave: 2, depends_on: ['T8', 'T9'], files: ['src/t10.js'], acceptance: ['A4'], verify: { commands: ['node t10.test.js'] } },
      ],
    };
    const dir = project({ plan, criteria: '| A4 | todos os diálogos | `node a4-all-dialogs.test.js` |' });
    const { run } = op.compileExecutionGraphFromArtifacts(dir, null);
    const cmd = (id) => run.compiled_graph.nodes[id].verify.command;
    assert.doesNotMatch(cmd('T8'), /a4-all-dialogs/);
    assert.doesNotMatch(cmd('T9'), /a4-all-dialogs/);
    assert.match(cmd('T10'), /a4-all-dialogs/);
  });

  it('criterionClosers: um fechador único, ou nenhum quando o critério termina em paralelo', () => {
    const closers = planJson.criterionClosers([
      { id: 'T1', aceite: ['A1', 'A2'], dependsOn: [] },
      { id: 'T2', aceite: ['A1'], dependsOn: ['T1'] },
      { id: 'T3', aceite: ['A2'], dependsOn: [] },
    ]);
    assert.equal(closers.get('A1').closer, 'T2');
    assert.equal(closers.get('A2').closer, null);
    assert.deepEqual(closers.get('A2').sinks.sort(), ['T1', 'T3']);
  });

  it('o lint avisa quando o verify de uma tarefa intermediária roda o teste de aceite do critério', () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T8', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A4'], verify: { commands: ['node --test test/acceptance/a4.test.js'] } },
        { id: 'T10', title: 'b', wave: 2, depends_on: ['T8'], files: ['src/b.js'], acceptance: ['A4'], verify: { commands: ['node --test test/acceptance/a4.test.js'] } },
      ],
      acceptance_tests: [{ criterion: 'A4', files: ['test/acceptance/a4.test.js'], command: 'node --test test/acceptance/a4.test.js' }],
    };
    const dir = project({ plan, criteria: '| A4 | todos os diálogos | manual |', files: { 'test/acceptance/a4.test.js': '' } });
    const lint = op.runtimePlanLint(dir, null, {});
    assert.match(lint.warnings.join('\n'), /T8: o verify roda o teste de aceite de A4/);
    assert.match(lint.warnings.join('\n'), /A4: a verificação do critério roda só em T10/);
  });
});

describe('OXB-047: dependência externa não vira gate humano', () => {
  it('blocked_by trava só a tarefa, sem GateRequested; verify_only conclui sem agente', async () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T1', title: 'pareamento (PR externo)', wave: 1, files: [], blocked_by: ['propagno/oxespace#594'] },
        { id: 'T2', title: 'tokens C4 (entregue no PR #604)', wave: 1, kind: 'verify_only', files: [], verify: { commands: [ok] } },
        { id: 'T3', title: 'código', wave: 1, files: ['src/c.js'], verify: { commands: [ok] } },
      ],
    };
    const dir = project({ plan });
    const ran = [];
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T3: { 'src/c.js': 'c' } }, ran), skipPreflight: true });
    assert.deepEqual(ran, ['T3'], 'nenhum agente para T1 (externa) nem T2 (verify_only)');
    const events = op.readEvents(dir, null);
    assert.equal(events.filter((e) => e.type === 'GateRequested').length, 0);
    const t2 = events.find((e) => e.type === 'WorkItemCompleted' && e.work_item_id === 'T2');
    assert.equal(t2.payload.completed_by, 'verify_only');
    const t1 = events.find((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T1');
    assert.equal(t1.payload.reason, 'external_dependency');
    assert.deepEqual(res.result.completed.sort(), ['T2', 'T3']);
    const preflight = op.buildRuntimeExecutePreflight(dir, null, op.readRunState(dir, null));
    assert.ok(!preflight.blockers.some((b) => /^pending_gates/.test(b)), JSON.stringify(preflight.blockers));
  });

  it('um PR já mergeado sai do blocked_by no compile (gh pr view)', () => {
    const plan = { tasks: [{ id: 'T1', meta: { blocked_by: ['o/r#1', 'o/r#2', 'oxespace#B21'] } }] };
    const calls = [];
    const fakeGh = (cmd, args) => { calls.push(args[2]); return { status: 0, stdout: args[2] === '1' ? 'MERGED\n' : 'OPEN\n' }; };
    op.resolveMergedDependencies(plan, fakeGh);
    assert.deepEqual(plan.tasks[0].meta.blocked_by, ['o/r#2', 'oxespace#B21']);
    assert.deepEqual(plan.tasks[0].meta.external_resolved, ['o/r#1']);
    assert.deepEqual(calls.sort(), ['1', '2'], 'refs sem owner/repo#n não consultam o GitHub');
  });
});

describe('OXB-042: um só scrub de ambiente para os filhos', () => {
  it('remove tokens do app e segredos; o adapter mantém só as credenciais do provider', () => {
    const base = { PATH: '/bin', OXESPACE_MCP_TOKEN: 't', OXESPACE_AGENT_HOOK_PORT: '1', GITHUB_TOKEN: 'g', ANTHROPIC_API_KEY: 'k', AI_MEMORY_URL: 'm', NODE_TEST_CONTEXT: 'x' };
    assert.deepEqual(Object.keys(runtime.childProcessEnv(base)).sort(), ['AI_MEMORY_URL', 'PATH']);
    const forProvider = runtime.childProcessEnv(base, { allow: runtime.PROVIDER_CREDENTIAL_ENV });
    assert.equal(forProvider.ANTHROPIC_API_KEY, 'k');
    assert.equal(forProvider.OXESPACE_MCP_TOKEN, undefined);
    runtime.configureChildEnv({ scrub: ['^AI_MEMORY_'], allow: ['GITHUB_TOKEN'] });
    try {
      const env = runtime.childProcessEnv(base);
      assert.equal(env.AI_MEMORY_URL, undefined);
      assert.equal(env.GITHUB_TOKEN, 'g');
    } finally {
      runtime.configureChildEnv({});
    }
    assert.deepEqual(runtime.scrubbedEnvNames(base).sort(), ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'OXESPACE_AGENT_HOOK_PORT', 'OXESPACE_MCP_TOKEN']);
  });

  it('o verify da tarefa não vê OXESPACE_* do terminal', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e "process.exit(process.env.OXESPACE_EXECUTION_TOKEN ? 1 : 0)"'] } }] };
    const dir = project({ plan });
    process.env.OXESPACE_EXECUTION_TOKEN = 'live-app-token';
    try {
      const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T1: { 'src/a.js': 'a' } }), skipPreflight: true });
      assert.deepEqual(res.result.completed, ['T1']);
    } finally {
      delete process.env.OXESPACE_EXECUTION_TOKEN;
    }
  });
});

describe('OXB-051: isolamento inplace e --wave', () => {
  it('a tarefa que falha é guardada e revertida; a seguinte roda sobre a árvore limpa; o sujo prévio fica', async () => {
    const plan = {
      schema_version: 1,
      budget: { max_retries: 0 },
      tasks: [
        { id: 'T9', title: 'falha', wave: 1, files: ['src/t9.js', 'src/shared.js'], verify: { commands: ['node -e "process.exit(1)"'] } },
        // Same wave, as in the oxespace F1 (T8/T9, wave 2): mutation nodes run one after the other in one checkout.
        { id: 'T8', title: 'sensível ao estado', wave: 1, depends_on: [], files: ['src/t8.js'], verify: { commands: ['node -e "process.exit(require(\'fs\').existsSync(\'src/t9.js\')?1:0)"'] } },
      ],
    };
    const dir = project({ plan, files: { 'src/shared.js': 'original\n', 'src/mine.js': 'x\n' } });
    fs.writeFileSync(path.join(dir, 'src', 'mine.js'), 'dirty before execute\n');
    const executor = writer(dir, { T9: { 'src/t9.js': 'half', 'src/shared.js': 'changed by T9\n' }, T8: { 'src/t8.js': 'ok' } });
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(res.result.completed, ['T8'], 'T8 não herda os arquivos da T9');
    assert.equal(fs.existsSync(path.join(dir, 'src', 't9.js')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'shared.js'), 'utf8').replace(/\r\n/g, '\n'), 'original\n');
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'mine.js'), 'utf8'), 'dirty before execute\n', 'trabalho prévio intocado');
    const run = op.readRunState(dir, null).run_id;
    const saved = path.join(dir, '.oxe', 'runs', run, 'attempts', 'T9-failed');
    assert.match(fs.readFileSync(path.join(saved, 'changes.patch'), 'utf8'), /changed by T9/);
    assert.equal(fs.readFileSync(path.join(saved, 'new', 'src', 't9.js'), 'utf8'), 'half');
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'runs', run, 'attempts', 'T9-1.log')), 'log da tentativa');
  });

  it('--wave 1 roda só a onda 1', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }, { id: 'T2', title: 'b', wave: 2, files: ['src/b.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan });
    const ran = [];
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T1: { 'src/a.js': 'a' }, T2: { 'src/b.js': 'b' } }, ran), skipPreflight: true, wave: 1 });
    assert.deepEqual(ran, ['T1']);
  });
});

describe('OXB-054: 1ª tentativa por tarefa, em todas as execuções da run', () => {
  it('a tarefa que falhou 3x e depois passou (ou foi fechada à mão) não conta como 1ª tentativa', () => {
    const ev = (type, task, payload, ts) => ({ type, run_id: 'r', work_item_id: task, payload, timestamp: ts });
    const events = [
      ev('WorkItemCompleted', 'T4', { attempt_number: 1 }, '2026-11-04T01:00:00Z'),
      ev('ExecutorUsage', 'T8', { turns: 5, success: true }, '2026-11-04T01:01:00Z'),
      ev('RetryScheduled', 'T8', { next_attempt: 2 }, '2026-11-04T01:02:00Z'),
      ev('RetryScheduled', 'T8', { next_attempt: 3 }, '2026-11-04T01:03:00Z'),
      ev('WorkItemBlocked', 'T8', { failure_class: 'verify', max_attempts: 3 }, '2026-11-04T01:04:00Z'),
      ev('WorkItemCompleted', 'T8', { attempt_number: 1 }, '2026-11-04T02:00:00Z'), // next execute
      ev('WorkItemBlocked', 'T1', { reason: 'external_dependency' }, '2026-11-04T02:01:00Z'),
      ev('WorkItemCompleted', 'T2', { attempt_number: 1, completed_by: 'verify_only' }, '2026-11-04T02:02:00Z'),
    ];
    const card = scorecard.computeScorecard({ events, changeLines: [], ledgers: [] });
    const rate = card.metrics.find((m) => m.metric === 'first_attempt_rate');
    assert.equal(rate.value, 0.5, 'T4 de primeira; T8 falhou antes de passar; T1 e T2 externas fora da taxa');
    assert.equal(rate.ok, false);
    assert.equal(card.sample.external_deliveries, 1);
    assert.equal(card.sample.tasks_failed, 1);
  });
});

describe('retrabalho: reabrir tarefas done (o execute nunca refaz done por conta própria)', () => {
  it('um CR defect reabre as tarefas impactadas; plan reopen reabre à mão', () => {
    const plan = {
      schema_version: 1,
      tasks: [
        { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], done: true, done_commit: 'abc' },
        { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A2'], done: true },
      ],
    };
    const dir = project({ plan, criteria: '| A1 | a | manual |\n| A2 | b | manual |' });
    const out = op.runtimeFeedback(dir, null, { class: 'defect', summary: 'a interface de A1 está errada', criteria: 'A1', by: 'review' });
    assert.deepEqual(out.reopened_tasks, ['T1']);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(doc.tasks[0].done, false);
    assert.equal(doc.tasks[0].reopened[0].previous_commit, 'abc');
    assert.equal(doc.tasks[1].done, true);
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    assert.equal(op.runtimePlanReopen(dir, null, { task: 'T2' }).changed, true);
    assert.equal(op.runtimePlanReopen(dir, null, { task: 'T2' }).changed, false);
  });
});
