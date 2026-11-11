'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');

// 1.21.2 — OXB-199: 1-hop reverse import closure in `oxe-plan-build.cjs` / `plan check-role`.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
};

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rev-imp-'));
  dirs.push(dir);

  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A13 | a | t |\n| A14 | b | t |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 2 — Removals\n\n**Critérios de aceite:** A13, A14\n');
  write(dir, '.oxe/config.json', '{}');

  // Target directory/module being deleted in R13 (`electron/main/services/work`)
  write(dir, 'electron/main/services/work/index.ts', 'export function runWork() { return 1; }\n');
  write(dir, 'electron/main/services/work/worker.ts', 'export const WORKER = true;\n');

  // Two production importers NOT initially listed in R13.files
  write(dir, 'electron/main/ipc/thread.ipc.ts', "import { runWork } from '../services/work';\nexport function registerThreadIpc() { return runWork(); }\n");
  write(dir, 'electron/main/mcp-internal/app-write-tools.ts', "import { WORKER } from '@electron/main/services/work/worker';\nexport const tools = [WORKER];\n");

  // One importer that IS already declared in R13.edited (should NOT be flagged as orphan)
  write(dir, 'electron/main/ipc/index.ts', "import { runWork } from '../services/work';\nexport const init = runWork;\n");

  // One test file importing `work` (test files are not production code under src/electron/shared/resources)
  write(dir, 'tests/unit/work.test.ts', "import { runWork } from '../../electron/main/services/work';\nrunWork();\n");

  // Module deleted in R12 (earlier task) that imported R14's target (`oxepost`) — already deleted before R14!
  write(dir, 'electron/main/services/legacy-bridge.ts', "import { publishPost } from './oxepost';\nexport const b = publishPost;\n");
  write(dir, 'electron/main/services/oxepost/index.ts', 'export function publishPost() {}\n');

  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
}

describe('OXB-199: 1-hop reverse import closure in plan check-role and plan build', () => {
  it('plan check-role emits a blocking error listing exact orphan production importers of deleted paths', () => {
    const dir = makeProject();
    const rolePath = 'roles/f2-backend.json';
    write(dir, rolePath, {
      role: 'backend',
      tasks: [
        {
          rid: 'R12',
          title: 'Remover legacy bridge',
          kind: 'remove',
          deleted: ['electron/main/services/legacy-bridge.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A13'],
        },
        {
          rid: 'R13',
          title: 'Remover servico work',
          kind: 'remove',
          deleted: ['electron/main/services/work'],
          edited: ['electron/main/ipc/index.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A13'],
        },
        {
          rid: 'R14',
          title: 'Remover oxepost (cujo unico importador legacy-bridge ja foi deletado em R12)',
          kind: 'remove',
          deleted: ['electron/main/services/oxepost/index.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A14'],
        },
      ],
    });

    const cliRes = spawnSync(process.execPath, [CLI, 'plan', 'check-role', rolePath, '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(cliRes.status, 1, 'check-role must fail with exit code 1 when orphan importers exist');
    assert.match(cliRes.stdout, /R13.*importadores órfãos/);
    assert.match(cliRes.stdout, /electron\/main\/ipc\/thread\.ipc\.ts/);
    assert.match(cliRes.stdout, /electron\/main\/mcp-internal\/app-write-tools\.ts/);
    // Must NOT complain about ipc/index.ts (already in edited), work.test.ts (test file), or R14 (legacy-bridge already deleted in R12)
    assert.doesNotMatch(cliRes.stdout, /electron\/main\/ipc\/index\.ts/);
    assert.doesNotMatch(cliRes.stdout, /work\.test\.ts/);
    assert.doesNotMatch(cliRes.stdout, /R14.*importadores órfãos/);
  });

  it('plan build --auto-close-imports automatically injects 1-hop orphan importers into Tn.files and pack exact_paths', () => {
    const dir = makeProject();
    const rolePath = 'roles/f2-backend.json';
    write(dir, rolePath, {
      role: 'backend',
      tasks: [
        {
          rid: 'R13',
          title: 'Remover servico work',
          kind: 'remove',
          deleted: ['electron/main/services/work'],
          edited: ['electron/main/ipc/index.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A13'],
        },
      ],
    });

    // CLI check-role passes when --auto-close-imports is provided
    const checkOk = spawnSync(process.execPath, [CLI, 'plan', 'check-role', rolePath, '--auto-close-imports', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(checkOk.status, 0, checkOk.stdout + checkOk.stderr);

    // CLI plan build --auto-close-imports writes PLAN.json and IMPLEMENTATION-PACK.json with closed scope
    const buildRes = spawnSync(process.execPath, [CLI, 'plan', 'build', '--from', rolePath, '--phase', 'F2', '--auto-close-imports', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(buildRes.status, 0, buildRes.stdout + buildRes.stderr);

    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const pack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    const t1 = plan.tasks[0];
    const p1 = pack.tasks[0];

    assert.ok(t1.files.includes('electron/main/ipc/thread.ipc.ts'), 'thread.ipc.ts auto-closed into T1.files');
    assert.ok(t1.files.includes('electron/main/mcp-internal/app-write-tools.ts'), 'app-write-tools.ts auto-closed into T1.files');
    assert.ok(p1.exact_paths.includes('electron/main/ipc/thread.ipc.ts'), 'thread.ipc.ts in pack exact_paths');
    assert.ok(p1.exact_paths.includes('electron/main/mcp-internal/app-write-tools.ts'), 'app-write-tools.ts in pack exact_paths');

    // Programmatic API check as well
    const direct = planBuild.build([{ file: rolePath, doc: JSON.parse(fs.readFileSync(path.join(dir, rolePath), 'utf8')) }], {
      root: dir,
      autoCloseImports: true,
    });
    assert.deepEqual(direct.errors, []);
    assert.ok(direct.plan.tasks[0].files.includes('electron/main/ipc/thread.ipc.ts'));
  });
});
