'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const lib = require('../bin/lib/oxe-handoff.cjs');

// 1.21.2 — OXB-113: the orchestrator's context slack; a resumable handoff before compaction.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, 'runtime', ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ho-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], done: true, done_commit: 'abc' },
    { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A1'], checkpoint_failed: { kind: 'empty_checkpoint', reason: 'empty_checkpoint: nada mudou' } },
    { id: 'T3', title: 'c', wave: 2, files: ['src/c.js'], acceptance: ['A1'] },
  ] }, null, 2));
  write(dir, 'src/a.js', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  write(dir, 'src/b.js', 'wip\n');
  return dir;
}

describe('OXB-113: handoff and context slack', () => {
  it('runtime handoff writes a resumable snapshot: tasks, failed checkpoints, dirty files, next step', () => {
    const dir = project();
    const r = cli(dir, 'handoff', '--note', 'parei no meio da T2');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const md = fs.readFileSync(path.join(dir, '.oxe', 'HANDOFF.md'), 'utf8');
    assert.match(md, /> parei no meio da T2/);
    assert.match(md, /Tarefas: 1\/3 done · pendentes: T2, T3/);
    assert.match(md, /T2 \[empty_checkpoint\]/);
    assert.match(md, /`src\/b\.js`/);
    assert.match(md, /## Próximo passo/);
    const json = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'HANDOFF.json'), 'utf8'));
    assert.equal(json.reason, 'manual');
  });

  it('runtime context: ok / warn at 70% / critical at 85% writes the handoff by itself', () => {
    const dir = project();
    assert.match(cli(dir, 'context', '--used', '50000', '--limit', '200000').stdout, /contexto 25%/);
    assert.match(cli(dir, 'context', '--used', '150000', '--limit', '200000').stdout, /contexto 75%.*termine a tarefa atual/);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'HANDOFF.md')));
    const crit = cli(dir, 'context', '--used', '180000', '--limit', '200000');
    assert.match(crit.stdout, /contexto 90%.*handoff gravado/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'HANDOFF.json'), 'utf8')).reason, 'context_critical');
    assert.ok(op.readEvents(dir, null).filter((e) => e.type === 'ContextUsage').length === 3);
  });

  it('contextLevel validates its input; config context.warn/critical move the thresholds', () => {
    assert.throws(() => lib.contextLevel('x', 10), /--used/);
    assert.equal(lib.contextLevel(60, 100, { warn: 0.5, critical: 0.9 }).level, 'warn');
  });
});
