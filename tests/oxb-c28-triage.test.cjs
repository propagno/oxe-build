'use strict';

// OXB-C28-3..9 (8e, 21/11 noite): spec freeze and test.each / unchanged tests, plan pack fix --add, refine lint UI
// heuristic, plan amend-test from another program, alm intake rehearsal line, quick ALM writes independent.
// C28-1 and C28-2 (scheduler) are in packages/runtime/tests/scheduler.test.ts.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const freezeLib = require('../bin/lib/oxe-spec-freeze.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); }
function repo(at) {
  const dir = at || fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c28-'));
  if (!at) dirs.push(dir);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@oxe.dev');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const sha = (dir) => git(dir, 'rev-parse', 'HEAD').stdout.trim();

const EACH_TEST = [
  "import { describe, test } from 'vitest';",
  "describe('OXE-332 navegação', () => {",
  "  test.each([['a', 1], ['b', 2]])('A4 mapeia %s para %i', (x, y) => {});",
  "});",
  '',
].join('\n');

describe('OXB-C28-3: spec freeze sees test.each titles', () => {
  it('a -t filter selects the each titles (template and expanded rows); the A<n> comes from the each title', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'nav.test.ts'), EACH_TEST);
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'each');
    const names = freezeLib.fullTestNames(EACH_TEST).map((t) => t.full);
    assert.ok(names.includes('OXE-332 navegação A4 mapeia a para 1'), names.join('\n'));
    const doc = { tasks: [], acceptance_tests: [] };
    const jsonPath = path.join(dir, '.oxe', 'PLAN.json');
    const out = freezeLib.freeze(dir, jsonPath, doc, { from: sha(dir), command: 'npx vitest run tests/nav.test.ts -t "OXE-332"' });
    assert.deepEqual(out.refused, []);
    assert.equal(out.frozen[0].criterion, 'A4');
    assert.ok(doc.acceptance_tests[0].proves.includes('A4 mapeia a para 1'), doc.acceptance_tests[0].proves.join(' | '));
  });
});

describe('OXB-C28-4: spec freeze --from <sha> --paths <file> freezes a test the sha did not change', () => {
  it('an explicit path comes from the ref tree; a glob still means the ref diff when it has a match', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'old.test.ts'), "describe('A2 antigo', () => { it('continua', () => {}); });\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'old test');
    fs.writeFileSync(path.join(dir, 'tests', 'new.test.ts'), "describe('A3 novo', () => { it('novo', () => {}); });\n");
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'new test');
    const jsonPath = path.join(dir, '.oxe', 'PLAN.json');
    const doc = { tasks: [], acceptance_tests: [] };
    const out = freezeLib.freeze(dir, jsonPath, doc, { from: sha(dir), paths: 'tests/old.test.ts' });
    assert.deepEqual(out.frozen.map((f) => f.file), ['tests/old.test.ts']);
    const doc2 = { tasks: [], acceptance_tests: [] };
    const out2 = freezeLib.freeze(dir, jsonPath, doc2, { from: sha(dir), paths: 'tests/*.test.ts' });
    assert.deepEqual(out2.frozen.map((f) => f.file), ['tests/new.test.ts'], 'the glob keeps meaning "the tests the ref changed"');
  });
});

describe('OXB-C28-5: plan pack fix --add', () => {
  const pack = { schema_version: 1, ready: true, tasks: [{ id: 'T1', mode: 'mutating', exact_paths: ['src/a.ts', 'src/hook.ts'], symbols: [{ name: 'a', path: 'src/a.ts' }], contracts: ['a exportado de src/a.ts'], expected_checks: ['node -e 0'] }] };
  it('adds a symbol of a file in the task scope (with signature), with its contract and a fixes record', () => {
    const dir = repo();
    const file = path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json');
    fs.writeFileSync(file, JSON.stringify(pack));
    const out = op.runtimePlanPackFix(dir, null, { task: 'T1', symbol: 'src/hook.ts#useThing', add: true, signature: '() => Thing', by: 'planner', reason: 'o teste não importa o hook' });
    assert.equal(out.change, 'add');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')).tasks[0];
    const s = entry.symbols.find((x) => x.name === 'useThing');
    assert.equal(s.path, 'src/hook.ts');
    assert.equal(s.signature, '() => Thing');
    assert.ok(entry.contracts.includes('useThing exportado de src/hook.ts'));
    assert.equal(entry.fixes[0].change, 'add');
    assert.throws(() => op.runtimePlanPackFix(dir, null, { task: 'T1', symbol: 'src/hook.ts#useThing', add: true, by: 'planner', reason: 'de novo, duplicado' }), /já está nos symbols/);
    assert.throws(() => op.runtimePlanPackFix(dir, null, { task: 'T1', symbol: 'src/other.ts#x', add: true, by: 'planner', reason: 'fora do escopo da tarefa' }), /não está no escopo de T1/);
  });
});

describe('OXB-C28-6: refine lint UI heuristic', () => {
  it('a behavior card citing src/components/ is not a geometry card; one with a measure still is', () => {
    const behavior = [
      '# OXE-332 — Fechar o menu ao trocar de aba',
      '## Critérios de aceite',
      '1. **A1** — Dado o menu aberto em `src/components/Nav/Menu.tsx`, quando o usuário troca de aba, então o menu fecha · Teste: tests/menu.test.tsx › fecha',
    ].join('\n');
    const r = op.uiCardGaps(behavior, { kind: 'story', labels: [] });
    assert.equal(r.isUi, false);
    assert.equal(r.behavior_component_exempt, true);
    const visual = `${behavior}\n2. **A2** — a altura da linha é 28 px nos dois temas`;
    assert.equal(op.uiCardGaps(visual, { kind: 'story', labels: [] }).isUi, true);
    assert.equal(op.uiCardGaps(behavior, { kind: 'story', labels: ['area-marca'] }).isUi, true, 'area-marca keeps it a UI card');
  });
});

describe('OXB-C28-7: plan amend-test from another program', () => {
  it('finds the owner program by its acceptance_tests (or --program) and amends ITS PLAN.json with the hash of the file here', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c28-7-'));
    dirs.push(parent);
    const ownerDir = repo(path.join(parent, 'fam-152-chat'));
    const hereDir = repo(path.join(parent, 'fam-152-accfix'));
    const rel = 'tests/oxe-58.test.ts';
    for (const d of [ownerDir, hereDir]) fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(ownerDir, rel), "describe('A1', () => { it('velho', () => {}); });\n");
    fs.writeFileSync(path.join(hereDir, rel), "describe('A1', () => { it('novo', () => {}); });\n");
    const ownerPlan = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', done: true, files: ['src/x.ts'] }], acceptance_tests: [{ criterion: 'A1', files: [rel], command: `npx vitest run ${rel}`, proves: ['velho'], sha256: 'old' }] };
    fs.writeFileSync(path.join(ownerDir, '.oxe', 'PLAN.json'), JSON.stringify(ownerPlan, null, 2));
    fs.writeFileSync(path.join(ownerDir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(hereDir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [], acceptance_tests: [] }, null, 2));
    fs.writeFileSync(path.join(hereDir, '.oxe', 'PLAN.md'), '# PLAN\n');
    const out = op.runtimePlanAmendTest(hereDir, null, { file: rel, reason: 'CR-9', by: 'tech-lead' });
    assert.equal(out.owner_program, 'chat');
    const amended = JSON.parse(fs.readFileSync(path.join(ownerDir, '.oxe', 'PLAN.json'), 'utf8')).acceptance_tests[0];
    assert.notEqual(amended.sha256, 'old');
    assert.equal(amended.sha256, out.sha256);
    assert.throws(() => op.runtimePlanAmendTest(hereDir, null, { file: rel, reason: 'CR-9', program: 'nao-existe' }), /--program nao-existe: programa não encontrado/);
  });
});

describe('OXB-C28-9: quick start — comment and move are independent ALM writes', () => {
  it('a 404 on the comment names the call and the move still runs', async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', base_url: 'https://example.atlassian.net', project: 'OXE', email_env: 'C28_JIRA_EMAIL', token_env: 'C28_JIRA_TOKEN', states: { ready: 'A fazer', in_progress: 'Em andamento' } } }));
    process.env.C28_JIRA_EMAIL = 'x';
    process.env.C28_JIRA_TOKEN = 'y';
    const calls = [];
    const http = async (method, url) => {
      calls.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
      if (/\/comment/.test(url)) return { status: 404, json: null, text: 'Issue does not exist', headers: {} };
      if (/\/transitions/.test(url) && method === 'GET') return { status: 200, json: { transitions: [{ id: '31', name: 'Em andamento', to: { name: 'Em andamento' } }] }, text: '', headers: {} };
      if (method === 'GET') return { status: 200, json: { key: 'OXE-357', fields: { status: { name: 'A fazer' } } }, text: '', headers: {} };
      return { status: 204, json: null, text: '', headers: {} };
    };
    try {
      const out = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-357', objective: 'corrigir algo', apply: true, http, sleep: async () => {}, retries: 1 });
      assert.match(String(out.alm.error), /comentário: HTTP 404 em POST \/rest\/api\/\d\/issue\/OXE-357\/comment/);
      assert.ok(calls.some((c) => /^POST .*\/transitions/.test(c)), `the move ran: ${calls.join(' | ')}`);
    } finally {
      delete process.env.C28_JIRA_EMAIL;
      delete process.env.C28_JIRA_TOKEN;
    }
  });
});
