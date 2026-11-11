'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21.2 — OXB-184: a binary written by an attempt (a re-recorded golden) is in that attempt's verify; the retry
// prompt names what the previous attempt left in the tree; a later execute does not overwrite an attempt log.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
// the verify passes only when the golden has the new bytes AND the second fix landed
const gate = 'node -e "const f=require(\'fs\');process.exit(f.readFileSync(\'snap/golden.png\')[0]===2&&f.existsSync(\'src/fix2.js\')?0:1)"';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ac-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, execute: { defer_failed: false } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', budget: { max_retries: 1 }, tasks: [
    { id: 'T1', title: 'golden', wave: 1, files: ['snap/golden.png', 'src/fix2.js'], acceptance: ['A1'], verify: { commands: [gate] } },
  ] }, null, 2));
  fs.mkdirSync(path.join(dir, 'snap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'snap', 'golden.png'), Buffer.from([1, 0, 255, 137]));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-184: what an attempt left in the tree', () => {
  it('the re-recorded binary survives into the verify; the retry prompt lists it as kept', async () => {
    const dir = project();
    const prompts = [];
    const executor = {
      async execute(node, lease, _run, attempt, options) {
        prompts.push((options && options.previousError) || '');
        if (attempt === 1) fs.writeFileSync(path.join(lease.root_path, 'snap', 'golden.png'), Buffer.from([2, 0, 255, 137]));
        else write(lease.root_path, 'src/fix2.js', 'ok\n');
        return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
      },
    };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(res.result.completed, ['T1'], JSON.stringify(res.result));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /O que a tentativa anterior deixou na árvore/);
    assert.match(prompts[1], /Mantidos[^\n]*snap\/golden\.png/);
    assert.equal(fs.readFileSync(path.join(dir, 'snap', 'golden.png'))[0], 2);
  });

  it('withAttemptChanges is a no-op without changes', () => {
    assert.equal(runtime.withAttemptChanges ? runtime.withAttemptChanges('x', { kept: [], gone: [] }) : 'x', 'x');
  });
});
