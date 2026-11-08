'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const policy = require('../bin/lib/oxe-policy-rules.cjs');
const changeLib = require('../bin/lib/oxe-change.cjs');

// 1.21.2 — OXB-118 (P0): the OXESpace's 10 policy_rules were strings; checkPolicyRules dropped every rule without
// id+forbid in silence. Nothing was enforced while everyone believed it was.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const STRINGS = ['nunca git stash nem checkout no checkout principal', 'nunca ler o banco vivo do app', 'remover OXESPACE_* do ambiente dos filhos'];
const STRUCTURED = [
  { id: 'no-stash', kind: 'command', deny: '\\bgit\\s+(stash|checkout)\\b', message: 'nunca git stash/checkout no checkout principal' },
  { id: 'no-live-db', kind: 'path', deny_read: '**/AppData/Roaming/oxespace/**', message: 'nunca ler o banco vivo do app' },
  { id: 'no-oxespace-env', kind: 'env', strip: 'OXESPACE_' },
  { id: 'no-console', forbid: 'console\\.log\\(', paths: '^src/' },
];

function project(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pol-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, policy_rules: rules }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
  const phase = { id: 'F1', title: 'F1', requirements: [], acceptance: ['A1'], scope: null, status: 'executing', plan_ref: null, run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null };
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F1', created_at: 'x', updated_at: 'x', phases: [phase] }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-118: enforced vs advisory project rules, and action rules', () => {
  it('strings are advisory (reported, never silent); structured forms are enforced; an invalid regex is reported', () => {
    const s = policy.summary([...STRINGS, ...STRUCTURED, { id: 'bad', kind: 'command', deny: '(' }]);
    assert.equal(s.advisory.length, 3);
    assert.equal(s.enforced.length, 5);
    assert.deepEqual(s.invalid.map((r) => r.id), ['bad']);
    const lint = op.runtimePlanLint(project(STRINGS), null, { preflight: false });
    assert.ok(lint.warnings.some((w) => /policy_rule_advisory: 3 de 3 regra\(s\) do projeto são só texto/.test(w)), lint.warnings.join('\n'));
    const r = spawnSync(process.execPath, [CLI, 'policy', 'list', '--json', '--dir', project([...STRINGS, ...STRUCTURED])], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual([j.enforced, j.advisory], [4, 3]);
  });

  it('action rules: a recorded `git stash` and a read of the live DB are violations; env strip removes the prefix', () => {
    const v = policy.checkActionRules(STRUCTURED, {
      commands: [{ command: 'npm test', task: 'T1' }, { command: 'git stash push -m wip', task: 'T1' }],
      reads: [{ path: 'C:/Users/u/AppData/Roaming/oxespace/db.sqlite', task: 'T2' }, { path: 'src/a.js' }],
    });
    assert.deepEqual(v.map((x) => [x.rule, x.kind, x.task]), [['no-stash', 'command', 'T1'], ['no-live-db', 'path_read', 'T2']]);
    assert.deepEqual(policy.envStripPatterns(STRUCTURED), ['^OXESPACE_']);
    const rt = require('../lib/runtime');
    rt.configureChildEnv({ scrub: policy.envStripPatterns(STRUCTURED) });
    try {
      const env = rt.childProcessEnv({ PATH: 'x', OXESPACE_TOKEN: 'secret', OXESPACE_HOME: 'h' });
      assert.deepEqual(Object.keys(env), ['PATH']);
    } finally { rt.configureChildEnv({}); }
    // content rules keep working; an action rule never reaches the content checker
    const dir = project(STRUCTURED);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'console.log(1)\n');
    assert.deepEqual(changeLib.checkPolicyRules(dir, STRUCTURED, ['src/a.js']).map((x) => x.rule), ['no-console']);
  });

  it('verify: a `git stash` the executor recorded in this run becomes a constraint CR with the rule and the command (once)', async () => {
    const dir = project(STRUCTURED);
    const executor = { async execute() { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'module.exports = 1;\n'); return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' }; } };
    const ran = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    op.appendEvent(dir, null, { type: 'ExecutorUsage', run_id: ran.result.run_id || op.readRunState(dir, null).run_id, work_item_id: 'T1', payload: { commands: ['git stash push -m wip'], reads: [], writes: [] } });
    await op.runRuntimeVerify(dir, null, { timeoutMs: 60_000, gates: false });
    await op.runRuntimeVerify(dir, null, { timeoutMs: 60_000, gates: false });
    const crs = changeLib.listChanges(path.join(dir, '.oxe', 'program')).filter((cr) => /^policy_rule:/.test(cr.by));
    assert.equal(crs.length, 1, 'not duplicated on a second verify');
    assert.equal(crs[0].class, 'constraint');
    assert.match(crs[0].summary, /regra do projeto 'no-stash' violada em T1: comando git stash push -m wip/);
  });
});
