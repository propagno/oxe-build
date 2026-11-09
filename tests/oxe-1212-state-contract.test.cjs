'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const stateLib = require('../bin/lib/oxe-state.cjs');

// 1.21.2 — OXB-121 (rest): state validate / state sync / .oxe/state.json.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, 'state', ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-st-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'a', wave: 1, files: ['a.js'], acceptance: ['A1'], done: true, done_commit: 'abc' },
    { id: 'T2', title: 'b', wave: 1, files: ['b.js'], acceptance: ['A1'], done: true, done_commit: 'def' },
    { id: 'T3', title: 'c', wave: 2, files: ['c.js'], acceptance: ['A1'] },
  ] }, null, 2));
  git(dir, 'init', '-q');
  // a run that failed, and an old STATE projection that contradicts it (the F2 shape)
  fs.mkdirSync(path.join(dir, '.oxe', 'runs'), { recursive: true });
  op.writeRunState ? null : null;
  write(dir, '.oxe/STATE.md', [
    '<!-- oxe:projected:begin -->',
    '- **Status da run:** completed',
    '- **runtime_status:** completed',
    '- **Concluídos (0):** —',
    '- **Falhos (2):** T1, T3',
    '<!-- oxe:projected:end -->',
    '',
  ].join('\n'));
  return dir;
}

describe('OXB-121: state validate / sync / state.json', () => {
  it('validate lists what STATE.md claims against the sources; --strict exits 1', () => {
    const dir = project();
    const truth = op.stateSnapshot(dir, null);
    const d = stateLib.validateStateMd(fs.readFileSync(path.join(dir, '.oxe', 'STATE.md'), 'utf8'), { ...truth, run: { id: 'r1', status: 'failed' } });
    assert.deepEqual(d.map((x) => x.field).sort(), ['Concluídos', 'Falhos', 'Status da run', 'runtime_status']);
    const r = cli(dir, 'validate', '--strict');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Concluídos: STATE diz "0", a fonte diz "2"/);
    assert.match(r.stdout, /Falhos: STATE diz "T1, T3", a fonte diz "T1 já done"/);
  });

  it('sync rewrites the projection from the sources: validate --strict is then clean', () => {
    const dir = project();
    const s = cli(dir, 'sync');
    assert.equal(s.status, 0, s.stdout + s.stderr);
    const v = cli(dir, 'validate', '--strict');
    assert.equal(v.status, 0, v.stdout);
    assert.match(v.stdout, /coerente com as fontes/);
  });

  it('state.json: the contract keeps every key; two writes with no source change are identical (updated_at aside)', () => {
    const dir = project();
    cli(dir, 'sync');
    const a = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'state.json'), 'utf8'));
    assert.equal(a.contract, '1.0.0');
    for (const k of ['contract', 'program', 'phase', 'run', 'tasks', 'open_crs', 'next', 'updated_at']) assert.ok(k in a, k);
    for (const k of ['total', 'done', 'failed', 'blocked', 'pending', 'external', 'checkpoint_failed']) assert.ok(k in a.tasks, k);
    assert.deepEqual(a.tasks.done, ['T1', 'T2']);
    assert.deepEqual(a.tasks.pending, ['T3']);
    const w = stateLib.writeStateJson(dir, op.stateSnapshot(dir, null));
    assert.equal(w.changed, false, 'same sources → same state');
  });
});
