'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fsg = require('../bin/lib/oxe-file-size-guard.cjs');
const pb = require('../bin/lib/oxe-plan-build.cjs');
const op = require('../bin/lib/oxe-operational.cjs');
const runtime = require('../lib/runtime/index.js');

const tmpDirs = [];
after(() => {
  runtime.setFinishTaskGuard(null);
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function writeRel(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

function makeLines(count, prefix = 'const pad_') {
  return `${Array.from({ length: count }, (_, i) => `${prefix}${i + 1} = ${i + 1};`).join('\n')}\n`;
}

const CHECK_FILE_SIZE_SCRIPT = [
  "import fs from 'fs';",
  "import path from 'path';",
  'const MAX_LINES = 1000;',
  "const targets = ['electron/main/index.ts', 'electron/main/ipc/agent-activity.ts', 'src/LegacyBig.tsx', 'src/Small.ts'];",
  'const bad = [];',
  'for (const rel of targets) {',
  '  const full = path.join(process.cwd(), rel);',
  '  if (!fs.existsSync(full)) continue;',
  "  const lines = fs.readFileSync(full, 'utf8').replace(/\\r?\\n$/, '').split(/\\r?\\n/).length;",
  '  if (lines > MAX_LINES) bad.push(`${rel}: ${lines} > ${MAX_LINES} linhas`);',
  '}',
  'if (bad.length) {',
  "  console.error(bad.join('\\n'));",
  '  process.exit(1);',
  '}',
  '',
].join('\n');

function createOqRepo({ indexLines = 998, includeIpcInScope = true, extraFiles = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-adendo2-'));
  tmpDirs.push(dir);

  const header = [
    "import { registerWindowIpc } from './ipc/window';",
    "import { registerAgentActivityIpc } from './ipc/agent-activity';",
    "import { registerTerminalIpc } from './ipc/terminal';",
    'export function bootMain() {',
    '  registerWindowIpc();',
    '  registerAgentActivityIpc();',
    '  registerTerminalIpc();',
    '}',
  ];
  const fillerCount = Math.max(0, indexLines - header.length);
  const indexBody = `${header.join('\n')}\n${makeLines(fillerCount)}`;

  writeRel(dir, '.gitignore', '.oxe/\n');
  writeRel(dir, 'package.json', { name: 'oq-fixture', version: '1.0.0' });
  writeRel(dir, 'scripts/check-file-size.mjs', CHECK_FILE_SIZE_SCRIPT);
  writeRel(dir, 'electron/main/ipc/window.ts', 'export function registerWindowIpc() { return true; }\n');
  writeRel(dir, 'electron/main/ipc/terminal.ts', 'export function registerTerminalIpc() { return true; }\n');
  writeRel(
    dir,
    'electron/main/ipc/agent-activity.ts',
    'export function registerAgentActivityIpc() {\n  return { channels: ["agentActivity:list"] };\n}\n',
  );
  writeRel(dir, 'electron/main/index.ts', indexBody);
  for (const [rel, body] of Object.entries(extraFiles)) {
    writeRel(dir, rel, body);
  }

  writeRel(dir, '.oxe/STATE.md', '# STATE\n');
  writeRel(dir, '.oxe/SPEC.md', [
    '# SPEC',
    '',
    '## Objetivo',
    'Expor exportação de atividades do agente.',
    '',
    '## Critérios de aceite',
    '| ID | Critério | Como verificar |',
    '|---|---|---|',
    '| A1 | Canal agentActivity:export registrado | `node -e "process.exit(0)"` |',
    '',
  ].join('\n'));
  writeRel(dir, '.oxe/config.json', {
    external_dependency_check: false,
    plan_lint_preflight: false,
    lint: {
      cited_paths_level: 'error',
      suite_impact: 'warn',
    },
  });

  const taskFiles = includeIpcInScope
    ? ['electron/main/index.ts', 'electron/main/ipc/agent-activity.ts']
    : ['electron/main/index.ts'];
  writeRel(dir, '.oxe/PLAN.json', {
    schema_version: 1,
    phase: 'F1',
    tasks: [
      {
        id: 'T1',
        title: 'OXE-220: adicionar canal agentActivity:export na IPC principal',
        wave: 1,
        files: taskFiles,
        acceptance: ['A1'],
        verify: { commands: [`"${process.execPath}" -e "process.exit(0)"`] },
      },
    ],
    acceptance_tests: [
      {
        criterion: 'A1',
        task: 'T1',
        files: ['tests/acceptance/a1.test.cjs'],
        command: `"${process.execPath}" -e "process.exit(0)"`,
      },
    ],
  });
  writeRel(dir, 'tests/acceptance/a1.test.cjs', '// frozen test\n');

  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@oxe.test');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init oq fixture');
  return dir;
}

describe('OXB-C1 Adendo 2: file-size headroom [G47], delegation notes, and attempt verify file-size guard', () => {
  it('plan lint warns [G47] when an in-scope file is within ~20 lines of cap, writes registerAgentActivityIpc into task.notes idempotently, and never triggers G44', () => {
    const dir = createOqRepo({ indexLines: 998, includeIpcInScope: false });

    const lint1 = op.runtimePlanLint(dir, null, { noPrecheck: true, preflight: false });
    assert.equal(lint1.ok, true, `unexpected lint errors: ${JSON.stringify(lint1.errors)}`);
    assert.ok(Array.isArray(lint1.file_size_headroom) && lint1.file_size_headroom.length === 1);
    assert.equal(lint1.file_size_headroom[0].file, 'electron/main/index.ts');
    assert.equal(lint1.file_size_headroom[0].lines, 998);
    assert.equal(lint1.file_size_headroom[0].limit, 1000);
    assert.equal(lint1.file_size_headroom[0].headroom, 2);
    assert.ok(
      lint1.warnings.some((w) => w.includes('[G47]') && w.includes('electron/main/index.ts') && w.includes('registerAgentActivityIpc')),
      `expected [G47] naming registerAgentActivityIpc, got: ${JSON.stringify(lint1.warnings)}`,
    );
    assert.deepEqual(lint1.file_size_notes_updated, ['T1']);

    const updatedPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.match(updatedPlan.tasks[0].notes, /\[limite-tamanho: electron\/main\/index\.ts\].*998\/1000.*registerAgentActivityIpc/);

    // Re-running plan lint is 100% idempotent AND cited_paths_level: 'error' (G44) produces 0 errors!
    const lint2 = op.runtimePlanLint(dir, null, { noPrecheck: true, preflight: false });
    assert.equal(lint2.ok, true, `G44 or other error after note injection: ${JSON.stringify(lint2.errors)}`);
    assert.equal(lint2.file_size_notes_updated, undefined);
    assert.equal(lint2.cited_path_gaps, undefined);
  });

  it('plan build and buildNodeContextProvider enrich PLAN.json, PLAN.md, and executor prompt lessons with the delegation target', () => {
    const dir = createOqRepo({ indexLines: 995, includeIpcInScope: true });
    const roleDoc = {
      role: 'backend',
      tasks: [
        {
          rid: 'R1',
          title: 'OXE-220: ligar canal de agent activity',
          files: ['electron/main/index.ts', 'electron/main/ipc/agent-activity.ts'],
          edited: ['electron/main/index.ts', 'electron/main/ipc/agent-activity.ts'],
          acceptance: ['A1'],
          verify: { commands: ['node -e 1'] },
        },
      ],
    };
    const built = pb.build([{ file: 'backend.json', doc: roleDoc }], { root: dir, phase: 'F1' });
    assert.deepEqual(built.errors, []);
    assert.match(built.plan.tasks[0].notes, /registerAgentActivityIpc/);
    assert.match(built.planMd, /registerAgentActivityIpc/);
    assert.ok(built.warnings.some((w) => w.includes('[G47]') && w.includes('registerAgentActivityIpc')));

    const ctxProvider = op.buildNodeContextProvider(dir, null);
    const ctx = ctxProvider({ id: 'T1', mutation_scope: ['electron/main/index.ts'], depends_on: [], verify: { acceptance_refs: ['A1'] } }, { root_path: dir });
    assert.ok(
      ctx.lessons.some((l) => l.includes('Limite de tamanho:') && l.includes('registerAgentActivityIpc')),
      `expected fileSizeLessons in prompt context, got: ${JSON.stringify(ctx.lessons)}`,
    );
  });

  it('attempt verify, finish_task guard, and commit-task fail immediately when electron/main/index.ts hits 1002 > 1000 lines, and pass once delegated', async () => {
    const dir = createOqRepo({ indexLines: 998, includeIpcInScope: true });
    const origIndex = fs.readFileSync(path.join(dir, 'electron', 'main', 'index.ts'), 'utf8');

    // 1. In-attempt finish_task guard rejects 1002-line file without ending the attempt
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'index.ts'), `${origIndex}// l999\n// l1000\n// l1001\n// l1002\n`, 'utf8');
    runtime.setFinishTaskGuard((cwd) => {
      const check = fsg.verifyTaskFileSize(cwd, { configRoot: dir, changedOnly: true });
      return check.ok ? { ok: true } : { ok: false, error: check.message };
    });
    const finishRaw = await runtime.BUILT_IN_TOOLS.finish_task.execute({ summary: 'done' }, dir);
    const finishParsed = JSON.parse(finishRaw);
    assert.equal(finishParsed.__finish_task__, false);
    assert.match(finishParsed.error, /electron\/main\/index\.ts: 1002 > 1000/);
    assert.match(finishParsed.error, /registerAgentActivityIpc/);
    runtime.setFinishTaskGuard(null);

    // 2. runtimeCommitTask fails BEFORE running a slow verify command (free & instant)
    let verifyCommandRan = false;
    const planPath = path.join(dir, '.oxe', 'PLAN.json');
    const markerFile = path.join(dir, '.oxe', 'slow-verify-ran.txt').replace(/\\/g, '/');
    const planDoc = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    planDoc.tasks[0].verify.commands = [`"${process.execPath}" -e "require('fs').writeFileSync('${markerFile}', '1')"`];
    fs.writeFileSync(planPath, `${JSON.stringify(planDoc, null, 2)}\n`, 'utf8');

    assert.throws(
      () => op.runtimeCommitTask(dir, null, { task: 'T1' }),
      /regra de tamanho de arquivo reprovou[\s\S]*electron\/main\/index\.ts: 1002 > 1000[\s\S]*registerAgentActivityIpc/,
    );
    verifyCommandRan = fs.existsSync(markerFile);
    assert.equal(verifyCommandRan, false, 'commit-task should fail on file-size BEFORE spending time on verify commands');

    // Reset dirty tree before testing runRuntimeExecute
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'index.ts'), origIndex, 'utf8');
    writeRel(dir, '.oxe/PLAN.md', '# PLAN\n');
    planDoc.tasks[0].verify.commands = [`"${process.execPath}" -e "process.exit(0)"`];
    fs.writeFileSync(planPath, `${JSON.stringify(planDoc, null, 2)}\n`, 'utf8');

    // 3. runRuntimeExecute fails Attempt 1 in verifyNode (BEFORE checkpointCheck!) and succeeds on Attempt 2 when delegated
    let attempts = 0;
    const exec = {
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          fs.writeFileSync(path.join(dir, 'electron', 'main', 'index.ts'), `${origIndex}// extra1\n// extra2\n// extra3\n// extra4\n`, 'utf8');
        } else {
          fs.writeFileSync(path.join(dir, 'electron', 'main', 'index.ts'), origIndex, 'utf8');
          fs.writeFileSync(
            path.join(dir, 'electron', 'main', 'ipc', 'agent-activity.ts'),
            'export function registerAgentActivityIpc() {\n  return { channels: ["agentActivity:list", "agentActivity:export"] };\n}\n',
            'utf8',
          );
        }
        return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
      },
    };

    const runRes = await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true, checkpointCommits: true });
    assert.equal(attempts, 2);
    assert.equal(runRes.result.status, 'completed');
    assert.equal((runRes.result.checkpoint_failed || []).length, 0, 'failed in verifyNode on attempt 1, NOT in checkpointCheck');
    const finalPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(finalPlan.tasks[0].done, true);
  });

  it('exempts pre-existing out-of-scope file-size violations on HEAD so unrelated tasks are not blocked', () => {
    const dir = createOqRepo({
      indexLines: 100,
      extraFiles: {
        'src/LegacyBig.tsx': makeLines(1005),
        'src/Small.ts': 'export const small = 1;\n',
      },
    });
    fs.writeFileSync(path.join(dir, 'src', 'Small.ts'), 'export const small = 2;\n', 'utf8');
    const res = fsg.verifyTaskFileSize(dir, {
      scope: ['src/Small.ts'],
      task: { id: 'T2', files: ['src/Small.ts'] },
    });
    assert.equal(res.ok, true, `expected pre-existing LegacyBig.tsx violation to be exempted, got: ${JSON.stringify(res)}`);
    assert.equal(res.preexisting, true);
  });
});
