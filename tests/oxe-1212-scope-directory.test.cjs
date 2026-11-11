'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// OXB-193: directories in files / deleted (oxe-plan-build and scope-guard)

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dir-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  const memDir = path.join(dir, 'electron', 'main', 'services', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'index.ts'), 'export const mem = 1;\n');
  fs.writeFileSync(path.join(memDir, 'cache.ts'), 'export const cache = 2;\n');

  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

describe('OXB-193: scope directories in plan-build, scope-guard and plan-lint', () => {
  it('oxe-plan-build expands directory in deleted via git tree, keeping directory prefix in files and removed_paths', () => {
    const root = makeGitProject();
    const roleDoc = {
      role: 'backend',
      tasks: [
        {
          rid: 'R5',
          title: 'Remover AI Memory',
          kind: 'remove',
          deleted: ['electron/main/services/memory'],
          verify: { commands: ['npm test'] },
          acceptance: ['A1'],
        },
      ],
    };

    const res = planBuild.build([{ file: 'role.json', doc: roleDoc }], { root });
    assert.deepEqual(res.errors, []);
    const t = res.plan.tasks.find((x) => x.id === 'T1' || x.rid === 'R5');
    assert.ok(t, 'tarefa T1 encontrada');
    assert.ok(t.files.includes('electron/main/services/memory/index.ts'), 'expandiu index.ts');
    assert.ok(t.files.includes('electron/main/services/memory/cache.ts'), 'expandiu cache.ts');
    assert.ok(t.files.includes('electron/main/services/memory'), 'manteve prefixo');

    const packTask = res.pack.tasks.find((x) => x.id === t.id);
    assert.ok(packTask, 'pack task encontrada');
    assert.ok(packTask.removed_paths.includes('electron/main/services/memory/index.ts'));
    assert.ok(packTask.removed_paths.includes('electron/main/services/memory/cache.ts'));
    assert.ok(packTask.removed_paths.includes('electron/main/services/memory'));
  });

  it('scope-guard isPathInScope authorizes child files when scope contains a directory prefix or glob and enforces exact case across operational and resume', () => {
    const resume = require('../bin/lib/oxe-resume.cjs');
    const scope = ['electron/main/services/memory', 'src/components/Teams/**'];
    for (const check of [op.isPathInScope, resume.isPathInScope]) {
      assert.equal(check('electron/main/services/memory/index.ts', scope), true);
      assert.equal(check('electron/main/services/memory/deep/sub.ts', scope), true);
      assert.equal(check('src/components/Teams/Button.tsx', scope), true);
      assert.equal(check('src/components/Teams/sub/Modal.tsx', scope), true);
      assert.equal(check('src/components/teams/Button.tsx', scope), false, 'case mismatch must not match scope');
      assert.equal(check('Electron/main/services/memory/index.ts', scope), false, 'case mismatch must not match directory prefix');
      assert.equal(check('src/other/outside.ts', scope), false);
    }
  });

  it('plan lint warns if task.files contains an unexpanded directory, but stays clean when expanded', () => {
    const root = makeGitProject();
    // Unexpanded
    const planUnexpanded = {
      source: 'PLAN.json',
      tasks: [
        {
          id: 'T1',
          title: 'Remover',
          wave: 1,
          files: ['electron/main/services/memory'],
          verifyCommand: 'npm test',
        },
      ],
    };
    const lintRes1 = planJson.lintPlan({ plan: planUnexpanded, projectRoot: root });
    assert.ok(lintRes1.warnings.some((w) => w.includes('diretório não expandido em files ("electron/main/services/memory")')));

    // Expanded
    const planExpanded = {
      source: 'PLAN.json',
      tasks: [
        {
          id: 'T1',
          title: 'Remover',
          wave: 1,
          files: ['electron/main/services/memory', 'electron/main/services/memory/index.ts'],
          verifyCommand: 'npm test',
        },
      ],
    };
    const lintRes2 = planJson.lintPlan({ plan: planExpanded, projectRoot: root });
    assert.ok(!lintRes2.warnings.some((w) => w.includes('diretório não expandido em files')));
  });
});
