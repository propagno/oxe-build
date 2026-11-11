'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const { classifyFailureOutput } = require('../lib/runtime/scheduler/scheduler');

// 1.21.2 — OXB-192: false positive of paused_environment by FileSystemFileChangedEvent after finish_task or exit 0.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

function project(tasks, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-wn-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, checkpoint_commits: true, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', budget: { max_retries: 2 }, tasks }, null, 2));
  write(dir, 'src/a.js', 'original\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-192: watcher noise (FileSystemFileChangedEvent)', () => {
  it('does not classify FileSystemFileChangedEvent as environment failure when exit code is 0', () => {
    const output = 'Watcher notification: FileSystemFileChangedEvent: src/a.js modified';
    assert.equal(classifyFailureOutput(output, 0), null);
  });

  it('does not false-positive match EMFILE inside SystemFile (e.g. FileSystemFileChangedEvent)', () => {
    const output = 'AssertionError: expected FileSystemFileChangedEvent to be dispatched\nimport type { FileSystemFileChangedEvent } from "../ipc"';
    assert.equal(classifyFailureOutput(output, 1), null, 'SystemFile must not match EMFILE');
  });

  it('completes task and commits checkpoint when finish_task is called and verify succeeds, even if watcher noise was logged', async () => {
    const dir = project([
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "console.log(\'FileSystemFileChangedEvent\'); process.exit(0)"'] } },
    ]);

    const executor = {
      async execute(node) {
        fs.writeFileSync(path.join(dir, 'src/a.js'), 'export function a() { return 1; }\n');
        return {
          success: true,
          failure_class: null,
          evidence: [],
          output: 'done with watcher log: FileSystemFileChangedEvent',
          completed_by: 'finish_task',
        };
      },
    };

    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(res.result.status, 'completed');
    assert.deepEqual(res.result.completed, ['T1']);

    const ev = op.readEvents(dir, null);
    assert.ok(!ev.some((e) => e.type === 'RunPaused'), 'must not pause run');
    assert.ok(ev.some((e) => e.type === 'WorkItemCompleted' && e.work_item_id === 'T1'));

    const log = git(dir, 'log', '-1', '--oneline').stdout;
    assert.match(log, /oxe\(T1\)/, 'checkpoint commit was made');
  });
});
