'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// OXB-194: plan-build and verify deleted tests filtering

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-del-v-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  fs.mkdirSync(path.join(dir, 'tests', 'integration'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'integration', 'memory-control.test.ts'), '// test\n');
  fs.writeFileSync(path.join(dir, 'tests', 'unit', 'other.test.ts'), '// test\n');

  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

describe('OXB-194: oxe-plan-build automatically drops deleted tests from verify commands of task and dependents', () => {
  it('drops deleted tests from verify commands in task and subsequent dependent tasks', () => {
    const root = makeGitProject();
    const roleDoc = {
      role: 'backend',
      tasks: [
        {
          rid: 'R5',
          title: 'Remover Memory Control',
          kind: 'remove',
          deleted: ['tests/integration/memory-control.test.ts'],
          verify: {
            commands: [
              'npx vitest run tests/integration/memory-control.test.ts',
            ],
          },
          acceptance: ['A1'],
        },
        {
          rid: 'R6',
          title: 'Ajustar Core',
          depends_on: ['R5'],
          files: ['tests/unit/other.test.ts'],
          verify: {
            commands: [
              'npx vitest run tests/integration/memory-control.test.ts tests/unit/other.test.ts',
            ],
          },
          acceptance: ['A2'],
        },
      ],
    };

    const res = planBuild.build([{ file: 'role.json', doc: roleDoc }], { root });
    assert.deepEqual(res.errors, []);
    const t1 = res.plan.tasks.find((t) => t.rid === 'R5');
    const t2 = res.plan.tasks.find((t) => t.rid === 'R6');

    // T1's command only ran the deleted test, so it's dropped
    assert.deepEqual(t1.verify.commands, []);

    // T2's command had both deleted and other tests; deleted was dropped
    assert.equal(t2.verify.commands.length, 1);
    assert.equal(t2.verify.commands[0], 'npx vitest run tests/unit/other.test.ts');
  });

  it('plan lint errors when verify command cites a test file deleted by the task or its dependency', () => {
    const plan = {
      source: 'PLAN.json',
      tasks: [
        {
          id: 'T1',
          title: 'Remoção',
          wave: 1,
          removed_paths: ['tests/integration/memory-control.test.ts'],
          verifyCommand: 'npx vitest run tests/integration/memory-control.test.ts',
        },
        {
          id: 'T2',
          title: 'Subsequente',
          wave: 2,
          dependsOn: ['T1'],
          verifyCommand: 'npx vitest run tests/integration/memory-control.test.ts tests/unit/other.test.ts',
        },
      ],
    };

    const lintRes = planJson.lintPlan({ plan });
    assert.equal(lintRes.ok, false);
    assert.ok(lintRes.errors.some((e) => e.includes('T1: verify cita arquivo removido por ela ou dependência ("tests/integration/memory-control.test.ts")')));
    assert.ok(lintRes.errors.some((e) => e.includes('T2: verify cita arquivo removido por ela ou dependência ("tests/integration/memory-control.test.ts")')));
  });
});
