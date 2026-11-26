'use strict';

// lean 1.1 — `oxe-cc phase close`: the end of a phase on the manual path in one deterministic command.
// Bench Restitui (21-22/11): verify → commit-task → program close took ~15 min and 6-10 human actions per phase,
// and the order verify → commit-task → close fell into `stale_verdict` (a second verify).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const verdicts = require('../bin/lib/oxe-verdicts.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1', NO_COLOR: '1' } });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

const CHECK = `node -e "process.exit(typeof require('./src/store.js').save === 'function' ? 0 : 1)"`;
const ROADMAP = '# Roteiro\n\n## Fase 1 — Armazenamento\n\n**Requisitos:** R1\n**Critérios de aceite:** A1\n**Escopo:** store\n\n## Fase 2 — API\n\n**Requisitos:** R2\n**Critérios de aceite:** A2\n**Escopo:** api\n';
const SPEC = `# OXE — SPEC\n\n## Objetivo\n\nFase 1.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | store exporta save | \`${CHECK}\` |\n`;
const PLAN_MD = `# OXE — PLAN\n\n## Resumo\n\nFase 1.\n\n### T1 — Store\n\n- **Arquivos alvo:** \`src/store.js\`\n- **Depende de:** —\n- **Onda:** 1\n- **Verificar:**\n  - Comando: \`${CHECK}\`\n- **Aceite vinculado:** A1\n`;
const GOOD = 'function save(item) { return item; }\nmodule.exports = { save };\n';

/** A phase planned and implemented by hand (no `runtime execute`): the code is on disk, uncommitted, T1 not done. */
function project({ code = GOOD } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-lean-close-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'README.md', 'x\n');
  write(dir, '.oxe/STATE.md', '# OXE — STATE\n\n- **phase:** plan_ready\n');
  write(dir, '.oxe/ROADMAP.md', ROADMAP);
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  write(dir, '.oxe/SPEC.md', SPEC);
  write(dir, '.oxe/PLAN.md', PLAN_MD);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'Store', wave: 1, files: ['src/store.js'], acceptance: ['A1'], verify: { commands: [CHECK] } }] }, null, 2));
  write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ tasks: [{ id: 'T1', mode: 'mutating', exact_paths: ['src/store.js'], symbols: [{ kind: 'function', name: 'save', path: 'src/store.js' }] }] }));
  if (code != null) write(dir, 'src/store.js', code);
  const compiled = cli(dir, 'runtime', 'compile');
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  return dir;
}
const planTask = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')).tasks[0];
const phase = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8')).phases[0];

describe('lean 1.1: oxe-cc phase close', () => {
  it('closes a hand-made phase in one command: verify, commit with OXE-Task, done, handoff draft, close', () => {
    const dir = project();
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, true, JSON.stringify(out, null, 1));
    assert.equal(r.status, 0);
    assert.deepEqual(out.steps.map((s) => s.step), ['verify', 'commit-task', 'handoff', 'program close']);
    assert.equal(planTask(dir).done, true);
    assert.match(git(dir, 'log', '--format=%B').stdout, /OXE-Task: F1\/T1/);
    assert.equal(phase(dir).status, 'closed');
    const handoff = fs.readFileSync(path.join(dir, '.oxe', 'dossier', 'F1', 'plan.md'), 'utf8');
    assert.match(handoff, /Rascunho gerado pelo `oxe-cc phase close`/);
    assert.match(handoff, /T1 Store/);
    assert.match(out.next, /program start --phase F2/);
  });

  it('a red verify stops there: nothing is committed, the task is not done, exit 1 and the check is named', () => {
    const dir = project({ code: 'module.exports = {};\n' });
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, false);
    assert.equal(out.stopped_at, 'verify');
    assert.equal(r.status, 1);
    assert.ok(out.reasons.length > 0);
    assert.notEqual(planTask(dir).done, true);
    assert.doesNotMatch(git(dir, 'log', '--format=%B').stdout, /OXE-Task/);
    assert.equal(phase(dir).status === 'closed', false);
  });

  it('work already committed without the trailer: the task is done on the verified HEAD', () => {
    const dir = project();
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'store by hand');
    const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, true, JSON.stringify(out, null, 1));
    assert.equal(planTask(dir).done_commit, head);
  });

  it('a file changed outside the tasks stops at commit-task with what to do', () => {
    const dir = project();
    write(dir, 'src/extra.js', 'module.exports = 1;\n');
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, false);
    assert.match(out.reasons.join(' '), /src\/extra\.js/, JSON.stringify(out, null, 1));
    assert.equal(phase(dir).status === 'closed', false);
  });
});

describe('lean 1.1: the verify is of the tree it ran on (no second verify after commit-task)', () => {
  it('verify → commit-task → program close: no stale_verdict; a later code change is still stale', async () => {
    const dir = project();
    const verified = await op.runRuntimeVerify(dir, null, {});
    assert.equal(verified.report.status, 'passed', JSON.stringify(verified.report.check_results.map((c) => [c.check_id, c.status, c.error])));
    assert.match(op.readRunState(dir, null).verification_tree, /^[0-9a-f]{40}$/);
    op.runtimeCommitTask(dir, null, { task: 'T1' });
    const reasons = () => (op.runtimeProgramClose(dir, null, { commit: false }).gate.reasons || []).join(' | ');
    assert.doesNotMatch(reasons(), /stale_verdict/);
    write(dir, 'src/store.js', `${GOOD}// changed after the verify\n`);
    git(dir, 'commit', '-qam', 'late change');
    assert.match(reasons(), /stale_verdict/);
  });

  it('worktreeTree does not touch the real index', () => {
    const dir = project();
    const before = git(dir, 'status', '--porcelain').stdout;
    const tree = verdicts.worktreeTree(dir);
    assert.match(tree, /^[0-9a-f]{40}$/);
    assert.equal(git(dir, 'status', '--porcelain').stdout, before);
    assert.deepEqual(verdicts.codeDiff(dir, tree, 'HEAD'), ['src/store.js']);
  });

  it('a folder that is not the top of its own repository gets no tree (never crawls an outer repository)', () => {
    const dir = project();
    assert.equal(verdicts.worktreeTree(path.join(dir, 'src')), null, 'a subfolder of a repository');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-lean-nogit-'));
    dirs.push(bare);
    write(bare, 'a.txt', 'x\n');
    // os.tmpdir() may itself sit inside a repository (a home directory under git): still null, and nothing is added there
    assert.equal(verdicts.worktreeTree(bare), null);
  });
});

describe('lean 1.1: status --full --json', () => {
  it('--full brings the whole active run; without it the run is slim', async () => {
    const dir = project();
    await op.runRuntimeVerify(dir, null, {});
    const slim = JSON.parse(cli(dir, 'status', '--json').stdout);
    const full = JSON.parse(cli(dir, 'status', '--json', '--full').stdout);
    assert.ok(JSON.stringify(full.activeRun).length > JSON.stringify(slim.activeRun).length);
  });
});

// lean 2.1/2.2 — profile "lean": the plan is two hand-written things (frozen tests + one role file); the CLI generates
// PLAN.json, PLAN.md and the pack, and plan lint no longer asks for anchors, fixture pack or the self-evaluation.
const ACCEPT_TEST = "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { save } = require('../../src/store.js');\n\ntest('A1: save devolve o item', () => {\n  assert.deepEqual(save({ a: 1 }), { a: 1 });\n});\n";
const ROLE = {
  role: 'fase',
  tasks: [{ rid: 'R1', title: 'Store', files: ['src/store.js'], created: ['src/store.js'], acceptance: ['A1'], verify: { commands: ['node --test test/acceptance/store.test.js'] } }],
  acceptance_tests: [{ criterion: 'A1', files: ['test/acceptance/store.test.js'], command: 'node --test test/acceptance/store.test.js', proves: ['A1: save devolve o item'] }],
};

function leanProject(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-lean-plan-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'package.json', JSON.stringify({ name: 'demo', version: '0.1.0', private: true, scripts: { test: 'node --test' } }));
  write(dir, '.oxe/STATE.md', '# OXE — STATE\n\n- **phase:** plan_ready\n');
  write(dir, '.oxe/ROADMAP.md', ROADMAP);
  write(dir, '.oxe/SPEC.md', SPEC.replace(/\| A1 .*\n/, '| A1 | save devolve o item | teste de aceite |\n'));
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, ...config }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  write(dir, 'test/acceptance/store.test.js', ACCEPT_TEST);
  write(dir, '.oxe/plan/F1.role.json', JSON.stringify(ROLE, null, 2));
  const built = cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json');
  assert.equal(built.status, 0, built.stdout + built.stderr);
  return dir;
}

describe('lean 2.1: profile lean — plan build + plan lint are the whole plan', () => {
  it('lean: lint passes with no REFERENCE-ANCHORS, FIXTURE-PACK or self-evaluation; the new frozen test is red for the right reason', () => {
    const dir = leanProject({ profile: 'lean' });
    const lint = cli(dir, 'plan', 'lint');
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
    assert.match(lint.stdout + lint.stderr, /vermelho pelo motivo certo/);
    assert.equal(fs.existsSync(path.join(dir, '.oxe', 'REFERENCE-ANCHORS.md')), false);
  });

  it('default profile: the same plan still needs the hand-written artifacts (nothing changes outside lean)', () => {
    const dir = leanProject({});
    const lint = cli(dir, 'plan', 'lint');
    assert.equal(lint.status, 1);
    assert.match(lint.stdout, /REFERENCE-ANCHORS\.md ausente/);
    assert.match(lint.stdout, /plan_self_evaluation_incomplete/);
  });

  it('lean: the whole phase — build, lint, frozen-test commit, compile, code, phase close', () => {
    const dir = leanProject({ profile: 'lean' });
    git(dir, 'add', 'test'); git(dir, 'commit', '-qm', 'test(acceptance): frozen tests F1');
    assert.equal(cli(dir, 'runtime', 'compile').status, 0);
    write(dir, 'src/store.js', 'function save(item) { return item; }\nmodule.exports = { save };\n');
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, true, JSON.stringify(out, null, 1));
  });

  it('lean: a frozen test changed after the compile is tampering — phase close stops', () => {
    const dir = leanProject({ profile: 'lean' });
    git(dir, 'add', 'test'); git(dir, 'commit', '-qm', 'test(acceptance): frozen tests F1');
    assert.equal(cli(dir, 'runtime', 'compile').status, 0);
    write(dir, 'src/store.js', 'function save() { return null; }\nmodule.exports = { save };\n');
    write(dir, 'test/acceptance/store.test.js', ACCEPT_TEST.replace('assert.deepEqual(save({ a: 1 }), { a: 1 });', 'assert.ok(true);'));
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, false);
    assert.match(JSON.stringify(out.reasons), /acceptance_tampered|adulter|tamper/i);
  });
});

describe('lean 2.1: the short workflow variant is the one resolved under profile lean', () => {
  it('workflow path: lean variant under lean, the full one otherwise and with --full', () => {
    const lean = leanProject({ profile: 'lean' });
    const full = leanProject({});
    const norm = (s) => s.trim().split(path.sep).join('/');
    assert.match(norm(cli(lean, 'workflow', 'path', 'plan').stdout), /oxe\/workflows\/lean\/plan\.md$/);
    assert.match(norm(cli(lean, 'workflow', 'path', 'execute').stdout), /oxe\/workflows\/lean\/execute\.md$/);
    assert.match(norm(cli(lean, 'workflow', 'path', 'plan', '--full').stdout), /oxe\/workflows\/plan\.md$/);
    assert.match(norm(cli(lean, 'workflow', 'path', 'spec').stdout), /oxe\/workflows\/lean\/spec\.md$/);
    assert.match(norm(cli(lean, 'workflow', 'path', 'verify').stdout), /oxe\/workflows\/verify\.md$/);
    assert.match(norm(cli(full, 'workflow', 'path', 'plan').stdout), /oxe\/workflows\/plan\.md$/);
  });

  it('the wrappers of plan and execute point to the lean variant; the lean plan reads a fraction of the full one', () => {
    const root = path.join(__dirname, '..');
    for (const slug of ['spec', 'plan', 'execute']) assert.match(fs.readFileSync(path.join(root, '.cursor', 'commands', `oxe-${slug}.md`), 'utf8'), /Variante enxuta/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.cursor', 'commands', 'oxe-verify.md'), 'utf8'), /Variante enxuta/);
    const size = (rel) => fs.statSync(path.join(root, 'oxe', 'workflows', rel)).size;
    assert.ok(size('lean/plan.md') < size('plan.md') / 5, 'lean/plan.md must stay under a fifth of plan.md');
    assert.ok(size('lean/plan.md') < 8 * 1024 && size('lean/execute.md') < 8 * 1024);
  });
});

// lean bench L2/L3 — the two governance gaps the lean round showed.
describe('lean bench L2: a criterion verified by hand needs the sign-off even with a frozen test', () => {
  it('"teste manual + checagem" keeps the phase open (exit 2, sign-off listed); after the sign-off it closes', () => {
    const dir = leanProject({ profile: 'lean' });
    const spec = path.join(dir, '.oxe', 'SPEC.md');
    fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace('| teste de aceite |', '| teste manual no navegador + teste de aceite |'));
    git(dir, 'add', 'test'); git(dir, 'commit', '-qm', 'test(acceptance): frozen tests F1');
    assert.equal(cli(dir, 'runtime', 'compile').status, 0);
    write(dir, 'src/store.js', 'function save(item) { return item; }\nmodule.exports = { save };\n');
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, false, JSON.stringify(out, null, 1));
    assert.deepEqual(out.signoffs_pending, ['A1'], JSON.stringify({ stopped_at: out.stopped_at, reasons: out.reasons, steps: out.steps }));
    assert.equal(r.status, 2, JSON.stringify(out.reasons));
    op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A1', by: 'po', evidence: 'abri o app e conferi' });
    const again = cli(dir, 'phase', 'close', '--json');
    assert.equal(JSON.parse(again.stdout.slice(again.stdout.indexOf('{'))).closed, true, again.stdout);
  });
});

describe('lean bench L3: the phase is not planned on top of product code with no origin', () => {
  it('lean: plan build refuses a dirty product file and names it; --allow-dirty and a commit both unblock', () => {
    const dir = leanProject({ profile: 'lean' });
    write(dir, 'src/extra.js', 'module.exports = 1;\n');
    const refused = cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json', '--force');
    assert.equal(refused.status, 1);
    assert.match(refused.stdout + refused.stderr, /código alterado sem origem.*src\/extra\.js/);
    assert.match(refused.stdout + refused.stderr, /oxe-cc quick/);
    assert.equal(cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json', '--force', '--allow-dirty').status, 0);
    git(dir, 'add', 'src/extra.js'); git(dir, 'commit', '-qm', 'x');
    assert.equal(cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json', '--force').status, 0);
  });

  it('default profile: plan build is unchanged', () => {
    const dir = leanProject({});
    write(dir, 'src/extra.js', 'module.exports = 1;\n');
    assert.equal(cli(dir, 'plan', 'build', '--from', '.oxe/plan/F1.role.json', '--force').status, 0);
  });
});

describe('lean bench L4: test helpers in the plan acceptance folder are not architecture drift', () => {
  it('a shared helper next to the frozen tests does not block the close', () => {
    const dir = leanProject({ profile: 'lean' });
    write(dir, 'test/acceptance/setup.js', 'module.exports = {};\n');
    git(dir, 'add', 'test'); git(dir, 'commit', '-qm', 'test(acceptance): frozen tests F1');
    assert.equal(cli(dir, 'runtime', 'compile').status, 0);
    write(dir, 'src/store.js', 'function save(item) { return item; }\nmodule.exports = { save };\n');
    const r = cli(dir, 'phase', 'close', '--json');
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(out.closed, true, JSON.stringify(out, null, 1));
  });
});
