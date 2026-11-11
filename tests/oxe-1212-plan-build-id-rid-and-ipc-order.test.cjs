'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mergeRolePlans } = require('../bin/lib/oxe-plan-merge.cjs');
const pb = require('../bin/lib/oxe-plan-build.cjs');

// 1.21.2 — OXB-203: f7-tasks-FRONTEND.json had FE-AP1 (rid A24) and FE-AP2 depends_on ["FE-AP1"] → "depends on unknown";
// FE-A24/FE-A55 ran before F7-IPC (which adds the channels to shared/types/ipc.ts and window.d.ts) and typecheck failed.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2)); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

const FRONTEND = { role: 'frontend', tasks: [
  { rid: 'A24', id: 'FE-AP1', title: 'painel de automação', files: ['src/components/Automation/Panel.tsx'], acceptance: ['A24'], verify: { commands: ['node -e 1'] } },
  { rid: 'A25', id: 'FE-AP2', title: 'histórico', files: ['src/components/Automation/History.tsx'], depends_on: ['FE-AP1'], acceptance: ['A25'], verify: { commands: ['node -e 1'] } },
  { rid: 'A55', id: 'FE-A55', title: 'mock e2e', files: ['electron/main/e2e/mock-ipc.ts'], acceptance: ['A55'], verify: { commands: ['node -e 1'] } },
  { rid: 'A60', id: 'FE-A60', title: 'só estilo', files: ['src/styles/theme.css'], acceptance: ['A60'], verify: { commands: ['node -e 1'] } },
] };
const BACKEND = { role: 'backend', tasks: [
  { rid: 'F7-IPC', id: 'F7-IPC', title: 'canais IPC da fase', files: ['shared/types/ipc.ts', 'src/types/window.d.ts', 'electron/main/ipc/automation.ipc.ts'], acceptance: ['A24'], verify: { commands: ['node -e 1'] } },
] };

describe('OXB-203: id → rid aliases in depends_on', () => {
  it('depends_on by the role id resolves to the rid (plain and role-qualified)', () => {
    const r = mergeRolePlans([{ file: 'frontend.json', doc: FRONTEND }, { file: 'backend.json', doc: BACKEND }]);
    assert.deepEqual(r.errors, []);
    const t24 = r.plan.tasks.find((t) => t.rid === 'A24');
    const t25 = r.plan.tasks.find((t) => t.rid === 'A25');
    assert.deepEqual(t25.depends_on, [t24.id]);
    assert.ok(t25.wave > t24.wave);
    const q = mergeRolePlans([{ file: 'f.json', doc: { role: 'frontend', tasks: [{ rid: 'A1', id: 'FE-1', title: 'a' }, { rid: 'A2', id: 'FE-2', title: 'b', depends_on: ['frontend:FE-1'] }] } }]);
    assert.deepEqual(q.errors, []);
    assert.deepEqual(q.plan.tasks[1].depends_on, ['T1']);
  });

  it('an id shared by two rids is ambiguous; an unknown dependency still errors', () => {
    const r = mergeRolePlans([
      { file: 'a.json', doc: { role: 'a', tasks: [{ rid: 'R1', id: 'X', title: 'a' }, { rid: 'R3', title: 'c', depends_on: ['X'] }] } },
      { file: 'b.json', doc: { role: 'b', tasks: [{ rid: 'R2', id: 'X', title: 'b' }, { rid: 'R4', title: 'd', depends_on: ['NOPE'] }] } },
    ]);
    const text = r.errors.join('\n');
    assert.match(text, /depends_on "X" é ambíguo/);
    assert.match(text, /R4: depends_on "NOPE" não existe em nenhum plano/);
  });
});

describe('OXB-203: --pair-as-deps orders the IPC contract before its frontend consumers', () => {
  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ipc-'));
    dirs.push(dir);
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/config.json', '{}');
    write(dir, 'shared/types/ipc.ts', 'export type Channel = "a";\n');
    write(dir, 'src/types/window.d.ts', 'interface Window { oxe: unknown }\n');
    write(dir, 'electron/main/ipc/automation.ipc.ts', 'export const x = 1;\n');
    write(dir, 'electron/main/e2e/mock-ipc.ts', 'export const mock = {};\n');
    write(dir, 'src/components/Automation/Panel.tsx', 'export const Panel = () => window.oxe.automation.list();\n');
    write(dir, 'src/components/Automation/History.tsx', 'export const History = () => null;\n');
    write(dir, 'src/styles/theme.css', 'body{}\n');
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    write(dir, 'roles/frontend.json', FRONTEND);
    write(dir, 'roles/backend.json', BACKEND);
    return dir;
  }

  it('without the flag the consumers may run first; with it they depend on the IPC task and come in a later wave', () => {
    const dir = repo();
    const inputs = () => [{ file: 'frontend.json', doc: JSON.parse(JSON.stringify(FRONTEND)) }, { file: 'backend.json', doc: JSON.parse(JSON.stringify(BACKEND)) }];
    const plain = pb.build(inputs(), { root: dir });
    assert.deepEqual(plain.errors, []);
    const ipcPlain = plain.plan.tasks.find((t) => t.rid === 'F7-IPC');
    const panelPlain = plain.plan.tasks.find((t) => t.rid === 'A24');
    assert.ok(!(panelPlain.depends_on || []).includes(ipcPlain.id));

    const res = pb.build(inputs(), { root: dir, pairAsDeps: true });
    assert.deepEqual(res.errors, []);
    const ipc = res.plan.tasks.find((t) => t.rid === 'F7-IPC');
    const panel = res.plan.tasks.find((t) => t.rid === 'A24');
    const mock = res.plan.tasks.find((t) => t.rid === 'A55');
    const history = res.plan.tasks.find((t) => t.rid === 'A25');
    const theme = res.plan.tasks.find((t) => t.rid === 'A60');
    assert.ok(panel.depends_on.includes(ipc.id), 'window.oxe consumer depends on the IPC task');
    assert.ok(mock.depends_on.includes(ipc.id), 'the e2e IPC mock depends on the IPC task');
    assert.ok(!(history.depends_on || []).includes(ipc.id), 'a task that does not consume window.oxe is not paired');
    assert.ok(!(theme.depends_on || []).includes(ipc.id));
    assert.ok(panel.wave > ipc.wave && mock.wave > ipc.wave && history.wave > panel.wave);
    assert.deepEqual(res.paired.map((p) => p.task).sort(), [mock.id, panel.id].sort());
    // the plan stays valid for plan lint's dependency rule
    const planJson = require('../bin/lib/oxe-plan-json.cjs');
    const parsed = planJson.planJsonToParsedPlan(res.plan);
    assert.deepEqual(planJson.lintPlan({ plan: parsed }).errors.filter((e) => /onda|depende/.test(e)), []);
  });

  it('CLI: plan build --pair-as-deps writes the ordered PLAN.json', () => {
    const dir = repo();
    const r = spawnSync(process.execPath, [CLI, 'plan', 'build', '--from', 'roles/frontend.json', 'roles/backend.json', '--pair-as-deps', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const ipc = plan.tasks.find((t) => t.rid === 'F7-IPC');
    const panel = plan.tasks.find((t) => t.rid === 'A24');
    assert.ok(panel.depends_on.includes(ipc.id));
    assert.match(r.stdout, /passa a depender de .*--pair-as-deps/);
  });
});
