'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const origin = require('../bin/lib/oxe-origin.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');

// 1.21.2 — G9 (quick as a CLI with a verifiable record) and G11 (the origin gate: nothing reaches a PR that did not
// come from `runtime execute` or a registered quick; exemptions only in origin.exempt). Real git, fake Jira, no paid
// model.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { cwd: dir, encoding: 'utf8', windowsHide: true, env: { ...process.env, NO_COLOR: '1', OXE_NO_PROMPT: '1' } });

function repo(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-origin-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Dev');
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'branch', 'base');
  return dir;
}
const commitFile = (dir, file, msg) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), `${Date.now()}${Math.random()}\n`); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

describe('G9: oxe-cc quick — a verifiable record, the QUICK.md mini-spec, the trailers', () => {
  it('start → commits through the commit-msg hook get the trailers → done --verify closes with the commits', async () => {
    const dir = repo();
    const s = await op.runtimeQuick(dir, null, { action: 'start', objective: 'corrigir o rodapé do terminal' });
    assert.match(s.id, quick.ID_RE);
    assert.deepEqual(s.trailers, [`OXE-Quick: ${s.id}`]);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'quick', `${s.id}.json`)), 'the record');
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'QUICK.md'), 'utf8'), new RegExp(`oxe-quick: ${s.id}[\\s\\S]*## Objetivo\\n\\ncorrigir o rodapé do terminal`));
    // the same objective again resumes; another one is refused while this is open
    assert.equal((await op.runtimeQuick(dir, null, { action: 'start' })).resumed, true);
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'start', key: 'X-1', objective: 'outra coisa qualquer' }), /está aberto/);
    // install the hooks, then a plain commit gets the quick's trailers
    const inst = cli(dir, 'guards', 'install');
    assert.equal(inst.status, 0, inst.stderr);
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'settings.json')), 'G33: the git hooks only; the Claude Code guards need --claude-guards');
    const hook = fs.readFileSync(path.join(dir, '.git', 'hooks', 'commit-msg'), 'utf8');
    assert.match(hook, /# >>> oxe-cc commit-msg >>>[\s\S]*ship commit-msg "\$1" \|\| exit 1[\s\S]*# <<< oxe-cc commit-msg <<</);
    cli(dir, 'guards', 'install');
    assert.equal(fs.readFileSync(path.join(dir, '.git', 'hooks', 'commit-msg'), 'utf8').split('oxe-cc commit-msg >>>').length, 2, 'idempotent');
    commitFile(dir, 'src/footer.ts', 'fix(terminal): rodapé por painel');
    assert.match(git(dir, 'log', '-1', '--format=%B'), new RegExp(`OXE-Quick: ${s.id}`));
    // prose in --verify is refused before anything runs (OXE-158: "->" became a redirect)
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'done', verify: 'testes verdes -> ok' }), /parece texto/);
    // POSIX quoting runs in a POSIX shell (Git bash on Windows): exit 3, not cmd.exe's literal-quote exit 0
    const posix = await op.runtimeQuick(dir, null, { action: 'done', verify: "node -e 'process.exit(3)'" });
    assert.equal(posix.closed, false);
    assert.equal(posix.verify.exit, 3, JSON.stringify(posix.verify));
    // a failing verification keeps it open; a passing one closes it with the commit found by the trailer
    const bad = await op.runtimeQuick(dir, null, { action: 'done', verify: 'node -e "process.exit(3)"' });
    assert.equal(bad.closed, false);
    assert.equal(bad.verify.exit, 3);
    assert.ok(quick.current(dir), 'still open');
    const ok = await op.runtimeQuick(dir, null, { action: 'done', verify: 'node -e "process.exit(0)"' });
    assert.equal(ok.closed, true);
    assert.equal(ok.commits.length, 1);
    assert.equal(quick.read(dir, s.id).status, 'done');
    assert.equal(quick.current(dir), null);
    // the origin of the range: the quick commit is valid and its record exists
    const chk = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.equal(chk.ok, true, JSON.stringify(chk.violations));
    assert.equal(chk.by_kind.quick, 1);
    assert.equal(chk.results[0].verified, true);
  });

  it('quick commit: the CLI makes the commit with the trailers (the hand commit is not the hole in the gate)', async () => {
    const dir = repo({ alm: { provider: 'jira', jira: { project: 'OXE' } } });
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'commit', message: 'x y z' }), /nenhum quick aberto/);
    const s = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-17', objective: 'ratchet de px da escala' });
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'commit', message: 'feat: nada' }), /nada para commitar/);
    fs.writeFileSync(path.join(dir, 'scale.css'), 'a{}\n');
    const r = cli(dir, 'quick', 'commit', '-m', 'feat(scale): ratchet de px', 'scale.css');
    assert.equal(r.status, 0, r.stderr);
    const body = git(dir, 'log', '-1', '--format=%B');
    assert.match(body, new RegExp(`^feat\\(scale\\): ratchet de px\\n\\nOXE-Quick: ${s.id}\\nOXE-Card: OXE-17$`));
    assert.equal(git(dir, 'show', '--name-only', '--format=', 'HEAD'), 'scale.css', 'only the given file');
    const chk = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.equal(chk.ok, true, JSON.stringify(chk.violations));
    assert.equal(chk.results[0].card, 'OXE-17');
    // a deleted path, staged by git rm or not: committed as a deletion (OxeSpace 14/11)
    fs.unlinkSync(path.join(dir, 'scale.css'));
    const d = cli(dir, 'quick', 'commit', '-m', 'chore(scale): remove o css', 'scale.css');
    assert.equal(d.status, 0, d.stderr);
    assert.equal(git(dir, 'show', '--name-status', '--format=', 'HEAD'), 'D\tscale.css');
    // commits in another branch count too (OXE-149: 4 commits in two branches were counted as 1 from HEAD)
    const here = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'outro');
    fs.writeFileSync(path.join(dir, 'b.css'), 'b{}\n');
    assert.equal(cli(dir, 'quick', 'commit', '-m', 'feat(b): outro branch', 'b.css').status, 0);
    git(dir, 'checkout', '-q', here);
    const done = await op.runtimeQuick(dir, null, { action: 'done', verify: 'node -e "process.exit(0)"', dryRun: true });
    assert.equal(done.commits.length, 3, done.commits.map((x) => x.subject).join(' | '));
  });

  it('a quick with no commit closes only with --no-commit', async () => {
    const dir = repo();
    await op.runtimeQuick(dir, null, { action: 'start', objective: 'conferir se o #771 já cobre' });
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'done' }), /nenhum commit/);
    assert.equal((await op.runtimeQuick(dir, null, { action: 'done', noCommit: true })).closed, true);
  });

  it('the CLI: quick --help, quick <KEY> "<objetivo>", trailers, status, list; quick is a command now (not exit 2)', () => {
    const dir = repo();
    const help = cli(dir, 'quick', '--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /oxe-cc quick <KEY> "<objetivo>"/);
    const st = cli(dir, 'quick', 'X-7', 'trocar o texto do aviso de memória');
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /aberto: Q-\d{8}-[a-z0-9]{4} \(X-7\)/);
    const tr = cli(dir, 'quick', 'trailers');
    assert.match(tr.stdout, /^OXE-Quick: Q-\d{8}-[a-z0-9]{4}\nOXE-Card: X-7$/m);
    assert.match(cli(dir, 'quick', 'status').stdout, /quick aberto: .*X-7/);
    assert.match(cli(dir, 'quick', 'list').stdout, /open\s+X-7/);
  });
});

describe('P0 (OxeSpace 14/11): quick --dry-run writes nothing locally either — no record, QUICK.md, event or commit', () => {
  it('start, commit and done with --dry-run leave the project exactly as it was', async () => {
    const dir = repo();
    const snapshot = () => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(`${path.relative(dir, p)}:${fs.statSync(p).size}`); } }; walk(dir); return out.sort().join('|'); };
    const before = snapshot();
    const s = await op.runtimeQuick(dir, null, { action: 'start', objective: 'ajustar a cor do realce', dryRun: true });
    assert.equal(s.dry_run, true);
    assert.equal(quick.current(dir), null);
    assert.equal(snapshot(), before, 'start --dry-run wrote nothing');
    const cli1 = cli(dir, 'quick', 'X-9', 'ajustar a cor do realce', '--dry-run');
    assert.equal(cli1.status, 0, cli1.stderr);
    assert.match(cli1.stdout, /\(simulação\) abriria Q-\d{8}-[a-z0-9]{4} \(X-9\)/);
    assert.equal(snapshot(), before, 'the CLI --dry-run wrote nothing');
    // with a real quick open, commit and done in dry run change nothing
    const real = await op.runtimeQuick(dir, null, { action: 'start', objective: 'ajustar a cor do realce' });
    fs.writeFileSync(path.join(dir, 'a.css'), 'a{}\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const c = await op.runtimeQuick(dir, null, { action: 'commit', message: 'feat: cor', paths: ['a.css'], dryRun: true });
    assert.equal(c.dry_run, true);
    assert.match(c.message, new RegExp(`OXE-Quick: ${real.id}`));
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'nothing staged');
    const recBefore = fs.readFileSync(path.join(dir, '.oxe', 'quick', `${real.id}.json`), 'utf8');
    const d = await op.runtimeQuick(dir, null, { action: 'done', noCommit: true, verify: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'x\')"', dryRun: true });
    assert.equal(d.dry_run, true);
    assert.ok(!fs.existsSync(path.join(dir, 'ran.txt')), 'the verification was not run');
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'quick', `${real.id}.json`), 'utf8'), recBefore, 'the record did not change');
    assert.ok(quick.current(dir), 'still open');
  });
});

describe('grill accepts the ALM kinds (task, story, bug, epic) and reads the card\'s kind with --card', () => {
  it('--type task is the feature tree; with --card and no --type, the kind from the refine collect', () => {
    const dir = repo();
    const t = op.runtimeGrill(dir, null, { action: 'start', card: 'OXE-137', type: 'task' });
    assert.equal(t.type, 'feature');
    assert.equal(op.runtimeGrill(dir, null, { action: 'start', card: 'OXE-140', type: 'bug' }).type, 'bugfix');
    fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'refine'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-141.json'), JSON.stringify({ key: 'OXE-141', kind: 'bug' }));
    assert.equal(op.runtimeGrill(dir, null, { action: 'start', card: 'OXE-141' }).type, 'bugfix');
    assert.throws(() => op.runtimeGrill(dir, null, { action: 'start', card: 'OXE-142', type: 'xyz' }), /do ALM: story \| task \| bug/);
  });
});

describe('G19: the cut (origin.since) and the origin config of a repo that does not version .oxe/', () => {
  it('commits before the cut (a date or a commit) are history; the versioned oxe.config.json and --config are read; no .oxe needed', () => {
    const dir = repo();
    fs.rmSync(path.join(dir, '.oxe'), { recursive: true, force: true });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: sem .oxe');
    commitFile(dir, 'src/old.ts', 'feat: antigo, sem trailer');
    const cut = git(dir, 'rev-parse', 'HEAD');
    commitFile(dir, 'src/new.ts', 'feat: novo, sem trailer');
    // no .oxe at all: still runs (git + defaults) and charges both (the commit that only removed .oxe/ is exempt)
    const all = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.equal(all.violations.length, 2);
    // the versioned config with a commit cut: only the commit after it is charged
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({ origin: { since: cut } }));
    const cutSha = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.deepEqual(cutSha.violations.map((v) => v.subject), ['feat: novo, sem trailer']);
    assert.equal(cutSha.since, cut);
    // a date cut in the future: everything is history
    const alt = path.join(dir, 'origin-ci.json');
    fs.writeFileSync(alt, JSON.stringify({ origin: { since: '2999-01-01' } }));
    assert.equal(op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD', config: 'origin-ci.json' }).ok, true);
    // exemptions from the versioned file reach the commit-msg hook too
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({ origin: { exempt: { paths: ['docs/releases/'] } } }));
    assert.equal(origin.resolveConfig(dir, {}).origin.exempt.paths[0], 'docs/releases/');
    assert.throws(() => origin.resolveConfig(dir, {}, 'missing.json'), /--config missing\.json/);
  });
});

describe('G9 with ALM: the card gets the mini-spec and moves to in_progress, only forward', () => {
  const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'w' };
  const STATES = { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento', in_progress: 'Em desenvolvimento', review: 'Em revisão' };
  function fake(status) {
    const names = Object.values(STATES);
    const st = { status, comments: [], writes: [] };
    const http = async (method, url, headers, body) => {
      const p = new URL(url).pathname;
      if (method !== 'GET') st.writes.push(`${method} ${p}`);
      if (/\/issue\/OXE-135$/.test(p) && method === 'GET') return { status: 200, json: { key: 'OXE-135', fields: { status: { name: st.status } } } };
      if (/\/issue\/OXE-135\/transitions$/.test(p) && method === 'GET') return { status: 200, json: { transitions: names.map((n, i) => ({ id: String(i + 1), name: n, to: { name: n } })) } };
      if (/\/issue\/OXE-135\/transitions$/.test(p) && method === 'POST') { st.status = names[Number(body.transition.id) - 1]; return { status: 204, json: null }; }
      if (/\/issue\/OXE-135\/comment$/.test(p) && method === 'POST') { st.comments.push(body.body); return { status: 201, json: {} }; }
      return { status: 404, json: null, text: `no route ${method} ${p}` };
    };
    return { http, st };
  }
  const alm = (extra = {}) => ({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'w', states: STATES, track: ['grooming', 'refinement', 'ready', 'in_progress', 'review'], ...extra } });

  it('with ALM the card is required; --apply comments and moves Em grooming → Em desenvolvimento; done comments the commits', async () => {
    const dir = repo(alm({ require_apply: true }));
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'start', objective: 'sem card nenhum aqui' }), /nomeia o card/);
    const f = fake('Em grooming');
    // without --apply (require_apply): a simulation, nothing written
    const sim = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-135', objective: 'F6 sob carga sem perder o foco', http: f.http, env: ENV, sleep: async () => {} });
    assert.equal(sim.alm.dry_run, true);
    assert.ok(sim.alm.comment.planned);
    assert.deepEqual(f.st.writes, []);
    assert.deepEqual(sim.trailers, [`OXE-Quick: ${sim.id}`, 'OXE-Card: OXE-135']);
    // with --apply on a fresh quick
    const dir2 = repo(alm({ require_apply: true }));
    const g = fake('Em grooming');
    const real = await op.runtimeQuick(dir2, null, { action: 'start', key: 'OXE-135', objective: 'F6 sob carga sem perder o foco', apply: true, http: g.http, env: ENV, sleep: async () => {} });
    assert.equal(real.alm.comment.commented, true);
    assert.equal(g.st.status, 'Em desenvolvimento');
    commitFile(dir2, 'src/f6.ts', `fix: F6 sob carga\n\nOXE-Quick: ${real.id}\nOXE-Card: OXE-135`);
    const done = await op.runtimeQuick(dir2, null, { action: 'done', apply: true, http: g.http, env: ENV, sleep: async () => {} });
    assert.equal(done.closed, true);
    assert.equal(g.st.comments.length, 2);
    assert.match(JSON.stringify(g.st.comments[1]), /concluído/);
  });

  it('a card already past in_progress is never moved back', async () => {
    const dir = repo(alm());
    const f = fake('Em revisão');
    const r = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-135', objective: 'ajuste depois da revisão', apply: true, http: f.http, env: ENV, sleep: async () => {} });
    assert.equal(r.alm.move.skipped, true);
    assert.equal(f.st.status, 'Em revisão');
  });
});

describe('G11: the origin of every commit, with exemptions only in origin.exempt', () => {
  const ocfg = (o = {}, alm = false) => origin.originConfig({ origin: o, ...(alm ? { alm: { provider: 'jira' } } : {}) });
  const c = (message, extra = {}) => ({ sha: 'abc1234567', parents: 1, author: { name: 'Dev', email: 'dev@example.com' }, message, files: ['src/a.ts'], ...extra });

  it('task and quick trailers pass; nothing else does, unless exempt by merge, author or paths', () => {
    const cfg = ocfg({ exempt: { authors: ['github-actions[bot]'], paths: ['.oxe/', 'docs/releases/'] } });
    assert.equal(origin.classify(c('feat: x\n\nOXE-Task: F2/T4\nOXE-Run: r-1'), cfg).kind, 'task');
    assert.equal(origin.classify(c('fix: y\n\nOXE-Quick: Q-20261114-ab12'), cfg).kind, 'quick');
    const missing = origin.classify(c('wip'), cfg);
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /sem origem/);
    assert.equal(origin.classify(c('Merge pull request #9', { parents: 2 }), cfg).reason, 'merge');
    assert.equal(origin.classify(c('chore: train', { author: { name: 'github-actions[bot]' } }), cfg).ok, true);
    assert.equal(origin.classify(c('docs: notas', { files: ['docs/releases/1.5.2.md', '.oxe/STATE.md'] }), cfg).ok, true);
    assert.equal(origin.classify(c('docs: notas', { files: ['docs/releases/1.5.2.md', 'src/a.ts'] }), cfg).ok, false, 'one file outside the exempt paths');
    // merges are exempt by default, but only by the explicit flag
    assert.equal(origin.classify(c('Merge x', { parents: 2 }), ocfg({ exempt: { merges: false } })).ok, false);
  });

  it('with ALM a quick commit names the card; an unregistered quick fails where the records are readable', () => {
    const cfg = ocfg({}, true);
    assert.match(origin.classify(c('fix\n\nOXE-Quick: Q-20261114-ab12'), cfg).reason, /sem OXE-Card/);
    assert.equal(origin.classify(c('fix\n\nOXE-Quick: Q-20261114-ab12\nOXE-Card: OXE-135'), cfg).ok, true);
    assert.match(origin.classify(c('fix\n\nOXE-Quick: Q-20261114-ab12\nOXE-Card: OXE-135'), cfg, { quickExists: () => false }).reason, /não está registrado/);
    assert.equal(origin.classify(c('fix\n\nOXE-Quick: Q-20261114-ab12\nOXE-Card: OXE-135'), cfg, { quickExists: () => null }).verified, null, 'a CI checkout cannot read .oxe/quick: valid, not verified');
  });

  it('check-origin on a range: the CLI fails (exit 1) and names each commit without origin', () => {
    const dir = repo({ origin: { exempt: { paths: ['.oxe/'] } } });
    commitFile(dir, 'src/a.ts', 'feat: a\n\nOXE-Task: F1/T1\nOXE-Run: run-1');
    commitFile(dir, 'src/b.ts', 'feat: b sem origem');
    commitFile(dir, '.oxe/STATE.md', 'chore: estado');
    const r = cli(dir, 'ship', 'check-origin', 'base..HEAD');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /3 commit\(s\) em base\.\.HEAD: 1 do execute · 1 isento\(s\) · 1 sem origem/);
    assert.match(r.stdout, /feat: b sem origem [—-] sem origem/);
    const j = JSON.parse(cli(dir, 'ship', 'check-origin', 'base..HEAD', '--json').stdout);
    assert.equal(j.ok, false);
    assert.equal(j.violations.length, 1);
  });

  it('check-origin on a PR reads gh pr view (fake gh), with the files of each commit', () => {
    const calls = [];
    const spawn = (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh' && args[0] === 'pr') return { status: 0, stdout: JSON.stringify({ url: 'https://github.com/o/r/pull/801', baseRefName: 'main', headRefName: 'f', commits: [{ oid: 'aaa', messageHeadline: 'feat: x', messageBody: 'OXE-Task: F1/T2', authors: [{ login: 'dev' }] }, { oid: 'bbb', messageHeadline: 'wip', messageBody: '', authors: [{ login: 'dev' }] }] }) };
      if (cmd === 'git' && args[0] === 'cat-file') return { status: 1 };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, stdout: JSON.stringify({ parents: [{}], files: [{ filename: 'src/x.ts' }] }) };
      return { status: 1, stderr: 'unexpected' };
    };
    const out = origin.check(os.tmpdir(), { target: '#801', config: {}, spawn });
    assert.equal(out.pr, 801);
    assert.equal(out.ok, false);
    assert.equal(out.violations[0].sha, 'bbb');
    assert.ok(calls.some((x) => x.startsWith('gh pr view 801 --json commits')));
  });

  it('the commit-msg hook refuses a commit with no origin (require), lets exempt paths and merges through', () => {
    const dir = repo();
    assert.equal(cli(dir, 'guards', 'install').status, 0);
    fs.writeFileSync(path.join(dir, 'src.ts'), 'x\n');
    git(dir, 'add', '-A');
    const refused = spawnSync('git', ['commit', '-q', '-m', 'sem origem'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.notEqual(refused.status, 0, 'refused');
    assert.match(refused.stderr, /commit sem origem/);
    git(dir, 'reset', '-q');
    fs.rmSync(path.join(dir, 'src.ts'));
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# estado\n');
    // guards install also wrote .claude/settings.json: stage only the .oxe file (a commit with .claude/ is refused)
    git(dir, 'add', '.oxe/STATE.md');
    git(dir, 'commit', '-q', '-m', 'chore: estado');
    assert.equal(git(dir, 'log', '-1', '--format=%s'), 'chore: estado', 'only .oxe/: exempt');
  });

  it('G23: with since = a commit, a commit of a long branch dated before the cut commit is history too', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'old-branch');
    const env = { ...process.env, GIT_AUTHOR_DATE: '2026-11-13T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-13T10:00:00Z' };
    fs.writeFileSync(path.join(dir, 'old.ts'), 'x\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'test: congelado antigo do planner'], { cwd: dir, env });
    git(dir, 'checkout', '-q', 'main');
    const envCut = { ...process.env, GIT_AUTHOR_DATE: '2026-11-14T12:14:31Z', GIT_COMMITTER_DATE: '2026-11-14T12:14:31Z' };
    fs.writeFileSync(path.join(dir, 'cut.txt'), 'x\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'chore: corte'], { cwd: dir, env: envCut });
    const cut = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', 'old-branch');
    commitFile(dir, 'new.ts', 'feat: novo, depois do corte');
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({ origin: { since: cut } }));
    const out = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.deepEqual(out.violations.map((v) => v.subject), ['feat: novo, depois do corte'], 'the old commit is history, though not an ancestor of the cut');
  });

  it('origin.exempt.commits: one-off, by full SHA with reason and by; listed in the report; a bad entry is refused', () => {
    const dir = repo();
    commitFile(dir, 'tests/cr02.test.ts', 'test: congelado do CR-02');
    const sha = git(dir, 'rev-parse', 'HEAD');
    commitFile(dir, 'src/x.ts', 'feat: sem origem');
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({ origin: { exempt: { commits: [{ sha, reason: 'teste congelado do CR-02 (planner), antes do OXE-Freeze', by: 'coordenação' }, { sha: sha.slice(0, 9), reason: 'curto', by: 'x' }] } } }));
    const out = op.runtimeCheckOrigin(dir, null, { target: 'base..HEAD' });
    assert.deepEqual(out.violations.map((v) => v.subject), ['feat: sem origem']);
    assert.equal(out.exempt_commits_used.length, 1);
    assert.match(out.exempt_commits_used[0].reason, /coordenação: teste congelado do CR-02/);
    assert.equal(out.config_problems.length, 1, 'the short SHA entry is refused, never a silent exemption');
    const cliOut = cli(dir, 'ship', 'check-origin', 'base..HEAD');
    assert.match(cliOut.stdout, /isenção pontual usada: [0-9a-f]{12}/);
    assert.match(cliOut.stdout, /entrada recusada/);
  });

  it('appendTrailers joins an existing trailer block and never duplicates', () => {
    assert.equal(origin.appendTrailers('fix: x\n\nCo-Authored-By: A <a@x>', ['OXE-Quick: Q-20261114-ab12']), 'fix: x\n\nCo-Authored-By: A <a@x>\nOXE-Quick: Q-20261114-ab12\n');
    assert.equal(origin.appendTrailers('fix: x', ['OXE-Quick: Q-20261114-ab12']), 'fix: x\n\nOXE-Quick: Q-20261114-ab12\n');
    assert.equal(origin.appendTrailers('fix: x\n\nOXE-Quick: Q-20261114-ab12', ['OXE-Quick: Q-20261114-ab12']), 'fix: x\n\nOXE-Quick: Q-20261114-ab12\n');
  });
});
