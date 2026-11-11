'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const changeLib = require('../bin/lib/oxe-change.cjs');

// 1.21.2 — OXB-114: live UI verification after each wave with UI tasks (opt-in per phase); findings → signal CRs.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// the isolated verifier: writes one finding per UI task it was given, and logs each call
const VERIFIER = [
  "const fs = require('fs');",
  "fs.appendFileSync('ui-calls.log', process.env.OXE_UI_WAVE + ':' + process.env.OXE_UI_TASKS + '\\n');",
  "const findings = process.env.OXE_UI_TASKS.split(',').map((t, i) => ({ id: 'UIV-F1-' + (i + 1), class: 'defect', criteria: ['A1'], summary: 'botão sem foco visível em ' + t, files: process.env.OXE_UI_FILES.split(',') }));",
  "fs.writeFileSync(process.env.OXE_UI_REPORT, JSON.stringify({ phase: 'F1', findings }));",
].join('\n');

function project(uiVerify) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-uiv-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\nui-calls.log\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — UI\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', ...(uiVerify ? { ui_verify: uiVerify } : {}), tasks: [
    { id: 'T1', title: 'settings panel', wave: 1, files: ['src/Settings.tsx'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'store', wave: 2, depends_on: ['T1'], files: ['src/store.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
  ] }, null, 2));
  write(dir, 'verifier.js', VERIFIER);
  write(dir, 'src/Settings.tsx', 'export {};\n');
  write(dir, 'src/store.js', 'exports.s = 1;\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const executor = (dir) => ({ async execute(node) { const f = node.id === 'T1' ? 'src/Settings.tsx' : 'src/store.js'; fs.writeFileSync(path.join(dir, f), `// ${node.id}\nexport const x = 1;\n`); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } });

describe('OXB-114: live UI verification in the loop', () => {
  it('runs the verifier after the wave with a completed UI task only; each finding becomes a signal CR of the phase', async () => {
    const dir = project({ command: 'node verifier.js' });
    await op.runRuntimeExecute(dir, null, { executor: executor(dir), skipPreflight: true });
    assert.equal(fs.readFileSync(path.join(dir, 'ui-calls.log'), 'utf8'), '1:T1\n', 'wave 1 (UI) only; wave 2 has no UI task');
    const ev = op.readEvents(dir, null).find((e) => e.type === 'UiVerifyCompleted');
    assert.deepEqual(ev.payload.tasks, ['T1']);
    assert.equal(ev.payload.crs.length, 1, JSON.stringify(ev.payload));
    const crs = changeLib.listChanges(path.join(dir, '.oxe', 'program'));
    assert.equal(crs.length, 1);
    assert.equal(crs[0].phase, 'F1');
    assert.match(crs[0].summary, /botão sem foco visível em T1/);
    assert.match(String(crs[0].by), /^signal/);
  });

  it('off without ui_verify (opt-in per phase)', async () => {
    const dir = project(null);
    await op.runRuntimeExecute(dir, null, { executor: executor(dir), skipPreflight: true });
    assert.ok(!fs.existsSync(path.join(dir, 'ui-calls.log')));
    assert.ok(!op.readEvents(dir, null).some((e) => e.type === 'UiVerifyCompleted'));
  });
});
