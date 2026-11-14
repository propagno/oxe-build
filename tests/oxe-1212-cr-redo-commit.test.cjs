'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const change = require('../bin/lib/oxe-change.cjs');
const conv = require('../bin/lib/oxe-commit-convention.cjs');

// 1.21.2 — OxeSpace 14/11 (Celular F2 CR-02): a CR redo verified green and stayed unstaged (checkpoint commits off),
// so it could not pass check-origin. runtime commit-task commits a task done without a commit, with OXE-Task, OXE-Run
// and the OXE-CR of the open CRs that reopened it.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content, 'utf8'); };

describe('a CR redo done without a commit gets its commit, naming the CR', () => {
  it('checkpointMessage carries OXE-CR for each open CR of the task', () => {
    const msg = conv.checkpointMessage({ id: 'T3', title: 'reinício preso no tamanho', phase: 'F2', run_id: 'oxe-run-1', crs: ['CR-02'] }, {});
    assert.match(msg, /\n\nOXE-Task: F2\/T3\nOXE-Run: oxe-run-1\nOXE-CR: CR-02$/);
  });

  it('commit-task commits a task marked done with no done_commit; refuses one already committed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-redo-'));
    dirs.push(dir);
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, checkpoint_commits: false }));
    write(dir, 'src/terminal.ts', 'a\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [
      { id: 'T3', title: 'reinício preso no tamanho', wave: 1, files: ['src/terminal.ts'], acceptance: ['A3'], verify: { commands: ['node -e 0'] }, done: true, status: 'done' },
      { id: 'T4', title: 'outro', wave: 1, files: ['src/other.ts'], acceptance: ['A4'], verify: { commands: ['node -e 0'] }, done: true, status: 'done', done_commit: '1234567' },
    ] }, null, 2));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@oxe.dev');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    change.appendNdjson(change.changesFile(path.join(dir, '.oxe', 'program')), { kind: 'cr', id: 'CR-02', class: 'defect', status: 'open', criteria: ['A3'], tasks: ['T3'], summary: 'terminal.service.ts passou de 1000 linhas', at: '2026-11-14T12:00:00Z' });
    write(dir, 'src/terminal.ts', 'a\nb\n');
    const res = op.runtimeCommitTask(dir, null, { task: 'T3', by: 'executor' });
    assert.equal(res.ok, true, JSON.stringify(res));
    const body = git(dir, 'log', '-1', '--format=%B').stdout;
    assert.match(body, /OXE-Task: F2\/T3/);
    assert.match(body, /OXE-CR: CR-02/);
    assert.equal(git(dir, 'status', '--porcelain', 'src/terminal.ts').stdout.trim(), '', 'the redo is committed');
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.ok(plan.tasks.find((t) => t.id === 'T3').done_commit, 'done_commit recorded');
    assert.throws(() => op.runtimeCommitTask(dir, null, { task: 'T4', by: 'executor' }), /já está concluída/);
  });

  it('P0: a task reopened by an open CR runs the CR frozen test in its own verify (compile), by task or by criterion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-crverify-'));
    dirs.push(dir);
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/config.json', JSON.stringify({ stub_check: false }));
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F2', tasks: [
      { id: 'T3', title: 'reinício', wave: 1, files: ['src/terminal.ts'], acceptance: ['A3'], verify: { commands: ['node -e 0'] } },
      { id: 'T5', title: 'outra', wave: 1, files: ['src/o.ts'], acceptance: ['A5'], verify: { commands: ['node -e 0'] } },
    ], acceptance_tests: [
      { criterion: 'A3', task: 'T3', files: ['tests/cr03.test.ts'], command: 'npx vitest run tests/cr03.test.ts', resolves: ['CR-03'] },
      { criterion: 'A3', files: ['tests/cr02.test.ts'], command: 'npx vitest run tests/cr02.test.ts', resolves: ['CR-02'] },
      { criterion: 'A5', files: ['tests/a5.test.ts'], command: 'npx vitest run tests/a5.test.ts' },
    ] }));
    const programDir = path.join(dir, '.oxe', 'program');
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-03', class: 'defect', status: 'open', criteria: ['A3'], tasks: ['T3'], summary: 'restart-size.ts como módulo próprio', at: '2026-11-14T13:00:00Z' });
    change.appendNdjson(change.changesFile(programDir), { kind: 'cr', id: 'CR-02', class: 'defect', status: 'open', criteria: ['A3'], tasks: ['T3'], summary: 'terminal.service.ts passou de 1000 linhas', at: '2026-11-14T12:00:00Z' });
    const graph = { nodes: { T3: { id: 'T3', verify: { command: 'node -e 0' } }, T5: { id: 'T5', verify: { command: 'node -e 0' } } } };
    op.applyTaskGatesToGraph(dir, { plan: path.join(dir, '.oxe', 'PLAN.md') }, graph);
    assert.match(graph.nodes.T3.verify.command, /cr03\.test\.ts/);
    assert.match(graph.nodes.T3.verify.command, /cr02\.test\.ts/, 'bound by criterion, no task');
    assert.doesNotMatch(graph.nodes.T5.verify.command, /cr0/);
    assert.doesNotMatch(graph.nodes.T5.verify.command, /a5\.test/, 'a test with no open CR is not added');
    assert.deepEqual(op.reopeningCrsOf(dir, 'T3').sort(), ['CR-02', 'CR-03']);
  });

  it('commit-task T11,T12 --together: one commit for tasks mixed in a shared file, one OXE-Task each, origin passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-together-'));
    dirs.push(dir);
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false }));
    write(dir, 'src/tool-handlers.ts', 'a\n');
    write(dir, 'src/registry.ts', 'r\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F3', tasks: [
      { id: 'T11', title: 'handler', wave: 1, files: ['src/tool-handlers.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] }, done: true, status: 'done' },
      { id: 'T12', title: 'handler e registro', wave: 1, files: ['src/tool-handlers.ts', 'src/registry.ts'], acceptance: ['A2'], verify: { commands: ['node -e 0'] }, done: true, status: 'done' },
    ] }, null, 2));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@oxe.dev');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    git(dir, 'branch', 'base');
    write(dir, 'src/tool-handlers.ts', 'a\nT11\nT12\n');
    write(dir, 'src/registry.ts', 'r\nT12\n');
    assert.throws(() => op.runtimeCommitTasksTogether(dir, null, { tasks: ['T11'] }), /duas tarefas ou mais/);
    write(dir, 'src/outside.ts', 'x\n');
    assert.throws(() => op.runtimeCommitTasksTogether(dir, null, { tasks: ['T11', 'T12'] }), /ScopeViolation.*outside\.ts/);
    fs.rmSync(path.join(dir, 'src', 'outside.ts'));
    const r = op.runtimeCommitTasksTogether(dir, null, { tasks: ['T11', 'T12'], by: 'executor' });
    assert.equal(r.ok, true);
    const body = git(dir, 'log', '-1', '--format=%B').stdout;
    assert.match(body, /^F3: T11, T12 — commit conjunto/);
    assert.match(body, /OXE-Task: F3\/T11\nOXE-Task: F3\/T12/);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(plan.tasks.map((t) => t.done_commit), [r.commit, r.commit]);
    assert.equal(op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' }).ok, true, 'several OXE-Task trailers pass check-origin');
  });
});
