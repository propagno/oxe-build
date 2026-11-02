'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const convention = require('../bin/lib/oxe-commit-convention.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21 · OXB-025: tarefa concluída fica `done` no PLAN.json; OXB-021: checkpoint na convenção de commit do projeto.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-done-')); dirs.push(d); return d; }
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function repo(planDoc) {
  const dir = tmpDir();
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(planDoc, null, 2));
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'Consentimento no diálogo', wave: 1, files: ['src/a.js'] }, { id: 'T2', title: 'b', wave: 1 }] };

describe('done no PLAN.json (OXB-025)', () => {
  it('markPlanTaskDone grava done/done_at/done_commit, preserva o resto e é idempotente', () => {
    const dir = repo(plan);
    const md = path.join(dir, '.oxe', 'PLAN.md');
    assert.equal(planJson.markPlanTaskDone(md, 'T1', { commit: 'abc123', at: '2026-11-02T00:00:00.000Z' }), true);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual([doc.tasks[0].done, doc.tasks[0].done_at, doc.tasks[0].done_commit], [true, '2026-11-02T00:00:00.000Z', 'abc123']);
    assert.equal(doc.tasks[1].done, undefined);
    assert.deepEqual(planJson.validatePlanJson(doc), []);
    assert.equal(planJson.markPlanTaskDone(md, 'T1', { commit: 'abc123' }), false);
    assert.equal(planJson.markPlanTaskDone(md, 'T9', {}), false);
  });

  it('plan done acha o checkpoint pelo trailer OXE-Task (ou pelo legado oxe(Tn):)', () => {
    const dir = repo(plan);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1\n');
    git(dir, 'add', 'src/a.js');
    git(dir, 'commit', '-q', '-m', 'fix(voice): x', '-m', 'OXE-Task: T1');
    const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(op.findTaskCheckpoint(dir, 'T1'), sha);
    assert.equal(op.findTaskCheckpoint(dir, 'T2'), null);
    const out = op.runtimePlanDone(dir, null, { task: 'T1' });
    assert.deepEqual([out.task, out.commit, out.changed], ['T1', sha, true]);
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '2\n');
    git(dir, 'commit', '-qam', 'oxe(T2): legado');
    assert.equal(op.findTaskCheckpoint(dir, 'T2'), git(dir, 'rev-parse', 'HEAD').stdout.trim());
  });
});

describe('convenção de commit do checkpoint (OXB-021)', () => {
  const config = {
    commit_convention: {
      template: '{type}({scope}): {title}', type: 'feat', scope: 'voice',
      pattern: '^(feat|fix|test|docs|chore|refactor)(\\([^)]+\\))?: .+',
      trailers: ['Co-Authored-By: Claude <noreply@anthropic.com>'],
    },
  };

  it('sem convenção mantém o legado; com convenção usa o template, a mensagem própria e os trailers', () => {
    assert.equal(convention.checkpointSubject({ id: 'T3', title: 'Algo' }, {}), 'oxe(T3): Algo');
    assert.equal(convention.checkpointSubject({ id: 'T3', title: 'consent file' }, config), 'feat(voice): consent file');
    const msg = convention.checkpointMessage({ id: 'T15', title: 'x', commit: 'fix(voice): consent dialog on the dialog primitive (CR-13)\n\nFocus starts on Not now.' }, config);
    assert.equal(msg, 'fix(voice): consent dialog on the dialog primitive (CR-13)\n\nFocus starts on Not now.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nOXE-Task: T15');
  });

  it('o lint cobra a mensagem própria quando exigida e o pattern', () => {
    const tasks = [{ id: 'T1', title: 'Consentimento', meta: {} }, { id: 'T2', title: 'x', meta: { commit: 'Atualiza coisa' } }, { id: 'T3', title: 'y', done: true, meta: {} }];
    const strict = { commit_convention: { ...config.commit_convention, require_task_message: true } };
    const errors = convention.lintCommitConvention({ tasks }, strict).join('\n');
    assert.match(errors, /T1: sem "commit"/);
    assert.match(errors, /T2: mensagem do checkpoint "Atualiza coisa" não segue/);
    assert.doesNotMatch(errors, /T3/, 'tarefas done não são cobradas');
    assert.match(convention.lintCommitConvention({ tasks: [] }, { commit_convention: { pattern: '(' } }).join(''), /pattern inválido/);
  });

  it('commitTaskCheckpoint grava a mensagem da convenção com o trailer OXE-Task', () => {
    const dir = repo(plan);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'feito\n');
    const runState = { compiled_graph: { nodes: { T1: { id: 'T1', title: 'Consentimento', mutation_scope: ['src/a.js'] } } } };
    const cp = op.commitTaskCheckpoint(dir, runState, 'T1', { task: { id: 'T1', title: 'x', meta: { commit: 'fix(voice): consent file' } }, config });
    assert.equal(cp.committed, true, JSON.stringify(cp));
    const body = git(dir, 'log', '-1', '--format=%B').stdout.trim();
    assert.equal(body, 'fix(voice): consent file\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nOXE-Task: T1');
    assert.equal(op.findTaskCheckpoint(dir, 'T1'), cp.commit);
  });
});
