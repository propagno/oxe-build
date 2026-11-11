'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// OXB-195: auto-inclusion of coupled governance/contract files (coupled_scope)

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-coupled-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'electron', 'main', 'mcp-internal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'validation'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'electron', 'main', 'mcp-internal', 'tools.ts'), '// tools\n');
  fs.writeFileSync(path.join(dir, 'shared', 'mcp-coverage.ts'), '// coverage\n');
  fs.writeFileSync(path.join(dir, 'docs', 'validation', 'mcp-coverage-1.4.md'), '# coverage\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'file-size-baseline.json'), '{}\n');

  const config = {
    coupled_scope: [
      {
        when: 'electron/main/mcp-internal/**',
        include: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md'],
      },
      {
        when_deleted: 'scripts/file-size-baseline.json',
        include: ['scripts/file-size-baseline.json'],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config, null, 2));

  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

describe('OXB-195: auto-inclusion of coupled governance and contract files (coupled_scope)', () => {
  it('plan build auto-includes coupled contract files in files and pack exact_paths', () => {
    const root = makeGitProject();
    const roleDoc = {
      role: 'backend',
      tasks: [
        {
          rid: 'R1',
          title: 'Adicionar nova tool MCP',
          kind: 'add',
          created: ['electron/main/mcp-internal/new-tool.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A1'],
        },
        {
          rid: 'R2',
          title: 'Remover baseline',
          kind: 'remove',
          deleted: ['scripts/file-size-baseline.json'],
          verify: { commands: ['npm test'] },
          acceptance: ['A2'],
        },
      ],
    };

    const res = planBuild.build([{ file: 'role.json', doc: roleDoc }], { root });
    assert.deepEqual(res.errors, []);

    const t1 = res.plan.tasks.find((t) => t.rid === 'R1');
    assert.ok(t1.files.includes('shared/mcp-coverage.ts'), 't1 includes shared/mcp-coverage.ts');
    assert.ok(t1.files.includes('docs/validation/mcp-coverage-1.4.md'), 't1 includes docs/validation/mcp-coverage-1.4.md');

    const pack1 = res.pack.tasks.find((t) => t.id === t1.id);
    assert.ok(pack1.exact_paths.includes('shared/mcp-coverage.ts'), 'pack1 includes shared/mcp-coverage.ts');
    assert.ok(pack1.exact_paths.includes('docs/validation/mcp-coverage-1.4.md'), 'pack1 includes docs/validation/mcp-coverage-1.4.md');

    const t2 = res.plan.tasks.find((t) => t.rid === 'R2');
    assert.ok(t2.files.includes('scripts/file-size-baseline.json'), 't2 includes scripts/file-size-baseline.json');
  });

  it('checkRole suggests coupled scope when trigger is touched without including coupled files', () => {
    const root = makeGitProject();
    const roleDoc = {
      role: 'backend',
      tasks: [
        {
          rid: 'R1',
          title: 'Adicionar nova tool MCP',
          created: ['electron/main/mcp-internal/new-tool.ts'],
          verify: { commands: ['npm test'] },
          acceptance: ['A1'],
        },
      ],
    };

    const res = planBuild.checkRole(root, roleDoc);
    assert.ok(res.warnings.some((w) => w.includes('escopo acoplado recomendado (shared/mcp-coverage.ts, docs/validation/mcp-coverage-1.4.md)')));
  });

  it('plan lint warns if coupled scope is missing from task.files', () => {
    const root = makeGitProject();
    const plan = {
      source: 'PLAN.json',
      tasks: [
        {
          id: 'T1',
          title: 'Modificar tool MCP',
          wave: 1,
          files: ['electron/main/mcp-internal/tools.ts'],
          verifyCommand: 'npm test',
        },
      ],
    };

    const res = planJson.lintPlan({ plan, projectRoot: root });
    assert.ok(res.warnings.some((w) => w.includes('escopo acoplado recomendado não incluído em files (shared/mcp-coverage.ts, docs/validation/mcp-coverage-1.4.md)')));
  });
});
