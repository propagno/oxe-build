'use strict';

/**
 * 1.21.2 — G9, the quick as a CLI with a verifiable record (user rule relayed 14/11: "nada pode ser implementado se
 * não vier do quick-win ou do oxe-execute"). `oxe-cc quick <KEY> "<objetivo>"` opens a quick: a record in
 * .oxe/quick/<id>.json (who, when, which card, the objective = the mini-spec), the QUICK.md header for the /oxe-quick
 * workflow, and the trailers every commit of it carries (OXE-Quick / OXE-Card, appended by the commit-msg hook).
 * `quick done` closes it with the commits found by the trailer and the verification that was run. Pure file + git.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const dirOf = (root) => path.join(root, '.oxe', 'quick');
const fileOf = (root, id) => path.join(dirOf(root), `${id}.json`);
const currentFile = (root) => path.join(dirOf(root), 'current.json');
const ID_RE = /^Q-\d{8}-[a-z0-9]{4}$/;

function newId(now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `Q-${d}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`;
}

/**
 * OxeSpace 15/11 (t30, F5): quick records vanished from a worktree's untracked .oxe/quick (a re-created .oxe, a
 * synced folder) and check-origin then refused commits `quick commit` made. Every record is mirrored in the git COMMON
 * dir (`git rev-parse --git-common-dir`/oxe/quick), shared by all the worktrees of the repo and never touched by a
 * checkout; a record missing locally is read — and restored — from there.
 */
const mirrorCache = new Map();
const mirrorBackfilled = new Set();
/**
 * Resolves `<git-common-dir>/oxe/quick`.
 * OXB-G01: when `options.readOnly` is true (e.g. `ship check-origin`), strictly read-only —
 * NEVER calls `fs.mkdirSync` or copies/writes any file inside `.git/`.
 */
function mirrorDirOf(root, options = {}) {
  const readOnly = Boolean(options && options.readOnly);
  const key = path.resolve(root);
  let dir = mirrorCache.get(key) || null;
  if (!dir) {
    try {
      const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true });
      const out = r.status === 0 ? String(r.stdout || '').trim() : '';
      if (out) dir = path.join(path.resolve(root, out), 'oxe', 'quick');
    } catch { dir = null; }
    if (!dir) return null; // not cached: a repo initialised later is found next time
    mirrorCache.set(key, dir);
  }
  if (readOnly) {
    return fs.existsSync(dir) ? dir : null;
  }
  if (!mirrorBackfilled.has(key)) {
    mirrorBackfilled.add(key);
    // cross-review 15/11: the records made BEFORE the mirror existed go in once (backfill), or a sibling worktree that
    // only sees the mirror would read them as lost
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dirOf(root))) {
        if (!ID_RE.test(f.replace(/\.json$/, '')) || fs.existsSync(path.join(dir, f))) continue;
        try { fs.copyFileSync(path.join(dirOf(root), f), path.join(dir, f)); } catch { /* */ }
      }
    } catch { /* no local records */ }
  }
  return dir;
}

function read(root, id, options = {}) {
  if (!ID_RE.test(String(id || ''))) return null;
  try { return JSON.parse(fs.readFileSync(fileOf(root, id), 'utf8')); } catch { /* not here: the mirror */ }
  const m = mirrorDirOf(root, options);
  if (!m) return null;
  try {
    const text = fs.readFileSync(path.join(m, `${id}.json`), 'utf8');
    const rec = JSON.parse(text);
    // restore the local copy (best effort) unless readOnly
    if (!options.readOnly) {
      try { fs.mkdirSync(dirOf(root), { recursive: true }); fs.writeFileSync(fileOf(root, id), text); } catch { /* */ }
    }
    return rec;
  } catch { return null; }
}

function write(root, rec) {
  if (!rec || !ID_RE.test(String(rec.id || ''))) throw new Error(`quick id inválido: ${rec && rec.id}`);
  fs.mkdirSync(dirOf(root), { recursive: true });
  const text = `${JSON.stringify(rec, null, 2)}\n`;
  fs.writeFileSync(fileOf(root, rec.id), text);
  const m = mirrorDirOf(root);
  if (m) { try { fs.mkdirSync(m, { recursive: true }); fs.writeFileSync(path.join(m, `${rec.id}.json`), text); } catch { /* auxiliar */ } }
}

/** A quick record exists here or in the repo's mirror (the check-origin question). Read-only (OXB-G01). */
function exists(root, id) {
  if (!ID_RE.test(String(id || ''))) return false;
  if (fs.existsSync(fileOf(root, id))) return true;
  const m = mirrorDirOf(root, { readOnly: true });
  return Boolean(m && fs.existsSync(path.join(m, `${id}.json`)));
}

/** The open quick of this project, or null. */
function current(root) {
  try {
    const { id } = JSON.parse(fs.readFileSync(currentFile(root), 'utf8'));
    const rec = id ? read(root, id) : null;
    return rec && rec.status === 'open' ? rec : null;
  } catch { return null; }
}

const trailers = (rec) => [`OXE-Quick: ${rec.id}`, ...(rec.key ? [`OXE-Card: ${rec.key}`] : [])];

/** The QUICK.md of a new quick: the objective is the mini-spec; the workflow fills the steps and the verification. */
function quickMd(rec) {
  return [
    `<!-- oxe-quick: ${rec.id}${rec.key ? ` · card ${rec.key}` : ''} · aberto ${rec.started_at} -->`,
    `# Quick ${rec.id}${rec.key ? ` — ${rec.key}` : ''}`, '',
    '## Contexto', '', rec.key ? `Card ALM: ${rec.key} · worktree: \`${rec.worktree || '.'}\`${rec.branch ? ` · branch: \`${rec.branch}\`` : ''}` : `Worktree: \`${rec.worktree || '.'}\`${rec.branch ? ` · branch: \`${rec.branch}\`` : ''}`, '',
    '## Objetivo', '', rec.objective, '',
    '## Passos', '', '1. (o /oxe-quick preenche: passos curtos, cada um rastreável ao Verificar)', '',
    '## Verificar', '', '- (o comando ou a checagem que prova o objetivo; rode com: oxe-cc quick done --verify "<comando>")', '',
    '## Origem dos commits', '', `Todo commit deste quick leva: ${trailers(rec).map((t) => `\`${t}\``).join(' e ')} (o hook commit-msg do \`oxe-cc guards install\` acrescenta sozinho).`, '',
    'Plano formal existente?: não',
    'Promover para spec/plan?: não', '',
  ].join('\n');
}

function currentBranchOf(root, spawn = spawnSync) {
  try {
    const r = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const b = String(r.stdout || '').trim();
      return b && b !== 'HEAD' ? b : null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Opens a quick. `key`: the card (OXE-135) or null without ALM; `objective`: one sentence (≥ 8 chars). The same card
 * with a quick already open resumes it; another open quick refuses unless `replace`.
 */
function start(root, input = {}) {
  const objective = String(input.objective || '').trim();
  const key = input.key ? String(input.key).toUpperCase() : null;
  const open = current(root);
  if (open && (open.key === key || (!key && !objective)) && !input.replace) return { resumed: true, ...open, trailers: trailers(open) };
  if (objective.length < 8) throw new Error('informe o objetivo do quick em uma frase: oxe-cc quick <KEY> "<objetivo>"');
  if (open && !input.replace) throw new Error(`o quick ${open.id}${open.key ? ` (${open.key})` : ''} está aberto: feche com oxe-cc quick done, ou abra outro com --replace`);
  // a new quick on a card whose last quick was abandoned links back to it
  const prevAbandoned = key ? list(root).find((r) => r.key === key && r.status === 'abandoned') : null;
  const branch = currentBranchOf(root, input.spawn || spawnSync);
  const worktree = path.basename(path.resolve(root));
  const rec = { schema: 1, id: newId(input.now), key, objective, by: input.by || null, worktree, branch, started_at: new Date().toISOString(), status: 'open', commits: [], verify: null, closed_at: null, ...(prevAbandoned ? { follows: prevAbandoned.id } : {}) };
  // --dry-run: validated, nothing written (no record, no QUICK.md, no current)
  if (input.dryRun) return { resumed: false, dry_run: true, ...rec, trailers: trailers(rec), would_replace: open ? open.id : null };
  if (open && input.replace) {
    write(root, { ...open, status: 'replaced', closed_at: new Date().toISOString() });
    require('./oxe-agent-coord.cjs').tryAutoLease(root, 'release', { agent_id: `quick:${open.id}`, task: open.id }, { spawn: input.spawn || spawnSync });
  }
  write(root, rec);
  fs.writeFileSync(currentFile(root), `${JSON.stringify({ id: rec.id }, null, 2)}\n`);
  if (input.quickFile) {
    fs.mkdirSync(path.dirname(input.quickFile), { recursive: true });
    fs.writeFileSync(input.quickFile, quickMd(rec));
  }
  require('./oxe-agent-coord.cjs').tryAutoLease(root, 'register', {
    agent_id: `quick:${rec.id}`,
    provider: input.by || 'oxe-quick',
    role: 'quick',
    task: rec.id,
    branch,
    write_set: Array.isArray(input.write_set) ? input.write_set : [],
  }, { spawn: input.spawn || spawnSync });
  return { resumed: false, ...rec, trailers: trailers(rec) };
}

/**
 * The commits of a quick, found by its trailer in every local and remote branch plus HEAD (OxeSpace 14/11, OXE-149:
 * 4 commits in two branches were counted as 1 from HEAD). Not `--all`: a stash commit is not the quick's.
 */
function commitsOf(root, id, spawn = spawnSync) {
  if (!ID_RE.test(String(id || ''))) return [];
  const r = spawn('git', ['log', '--format=%H%x1f%s', '-E', `--grep=^OXE-Quick: ${id}$`, 'HEAD', '--branches', '--remotes'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { sha, subject }; });
}

/**
 * Closes the open quick: the commits found by its trailer, the verification (command + exit + tail of the output, run
 * by the CLI) and the result. A quick with no commit closes only with `noCommit` (nothing needed to change).
 */
/** Git for Windows' bash, when installed (the usual paths, then PATH); null otherwise. */
function gitBash() {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const w = spawnSync('where', ['bash'], { encoding: 'utf8', windowsHide: true });
  const first = w.status === 0 ? String(w.stdout || '').split(/\r?\n/).find((l) => /git/i.test(l) && /bash\.exe$/i.test(l.trim())) : null;
  return first ? first.trim() : null;
}

function done(root, input = {}) {
  const rec = input.id ? read(root, input.id) : current(root);
  if (!rec) throw new Error('nenhum quick aberto (oxe-cc quick <KEY> "<objetivo>")');
  if (rec.status !== 'open') throw new Error(`${rec.id} já está ${rec.status}`);
  // OxeSpace 14/11 (OXE-158): --verify is run by the shell; prose in it ("a -> b") became a redirect and left a stray
  // file. A prose arrow is refused before anything runs.
  if (input.verify && /(^|\s)[-=]>(\s|$)/.test(String(input.verify))) throw new Error(`--verify roda no shell: "${String(input.verify).slice(0, 80)}" parece texto ("->" vira redirecionamento e cria um arquivo). Passe só o comando (ex.: --verify "npx vitest run x.test.ts") e escreva o resto no commit`);
  const spawn = input.spawn || spawnSync;
  const commits = commitsOf(root, rec.id, spawn);
  if (!commits.length && !input.noCommit) throw new Error(`${rec.id}: nenhum commit com "OXE-Quick: ${rec.id}" — commite com o trailer (o hook commit-msg acrescenta) ou feche com --no-commit se nada precisou mudar`);
  // --dry-run: the commits found, the verification it would run; nothing run, nothing written
  if (input.dryRun) return { ...rec, dry_run: true, commits, closed: null, would_verify: input.verify || null };
  let verify = null;
  if (input.verify) {
    // OxeSpace 15/11: on Windows `shell: true` is cmd.exe — a POSIX-quoted chain ('…' && …) broke (exit 127,
    // "'node: command not found"). With POSIX syntax and Git's bash present, the verify runs in bash.
    const bash = process.platform === 'win32' && /'|\$\(|\$[A-Za-z_{]|\bexport\s/.test(String(input.verify)) ? (input.bashPath !== undefined ? input.bashPath : gitBash()) : null;
    const r = bash
      ? spawn(bash, ['-c', input.verify], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
      : spawn(input.verify, { cwd: root, encoding: 'utf8', shell: true, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const outText = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
    verify = { command: input.verify, exit: r.status, ok: r.status === 0, tail: outText.slice(-12).join('\n') };
    if (!verify.ok) {
      write(root, { ...rec, verify, last_failed_verify_at: new Date().toISOString() });
      return { ...rec, verify, closed: false, commits };
    }
  }
  const closed = { ...rec, status: 'done', commits, verify, closed_at: new Date().toISOString(), by_close: input.by || null };
  write(root, closed);
  try { fs.unlinkSync(currentFile(root)); } catch { /* */ }
  require('./oxe-agent-coord.cjs').tryAutoLease(root, 'release', { agent_id: `quick:${rec.id}`, task: rec.id }, { spawn });
  const marked = markClosed(root, closed, input);
  return { ...closed, closed: true, ...marked };
}

/**
 * Jornada (item 9): `quick done` fecha também o QUICK.md (status no cabeçalho e na seção) e a fase do STATE.md
 * (`quick_active` → `quick_done`), senão o próximo passo continuava em /oxe-execute. Só toca o QUICK.md deste quick
 * (o cabeçalho `<!-- oxe-quick: <id>`) e só a fase `quick_active`; o resto do STATE fica como está.
 */
function markClosed(root, rec, input = {}) {
  const out = { quick_md_closed: false, state_closed: false };
  const quickFile = input.quickFile || path.join(root, '.oxe', 'QUICK.md');
  try {
    const text = fs.readFileSync(quickFile, 'utf8');
    if (new RegExp(`<!--\\s*oxe-quick:\\s*${rec.id}\\b`).test(text) && !/<!--\s*oxe-quick-status:/.test(text)) {
      const nl = text.includes('\r\n') ? '\r\n' : '\n';
      const verifyLine = rec.verify ? `verificação \`${rec.verify.command}\` ${rec.verify.ok ? 'passou' : `falhou (exit ${rec.verify.exit})`}` : 'sem verificação informada';
      const status = [`<!-- oxe-quick-status: done · ${rec.closed_at} -->`, '', '## Status', '', `Concluído em ${rec.closed_at} · ${rec.commits.length} commit(s) · ${verifyLine}. Próximo: oxe-cc status (com delivery.mode "pr": oxe-cc quick promote --open-pr numa branch, depois CI/merge; local: os commits do quick já são a entrega).`, ''].join(nl);
      fs.writeFileSync(quickFile, `${text.replace(/\s*$/, '')}${nl}${nl}${status}`);
      out.quick_md_closed = true;
    }
  } catch { /* sem QUICK.md: só o registro */ }
  const stateFile = input.stateFile || path.join(root, '.oxe', 'STATE.md');
  try {
    const st = fs.readFileSync(stateFile, 'utf8');
    const re = /(##\s*Fase atual\s*(?:\r?\n)+\s*`)quick_active(`)/i;
    if (re.test(st)) { fs.writeFileSync(stateFile, st.replace(re, '$1quick_done$2')); out.state_closed = true; }
  } catch { /* sem STATE */ }
  return out;
}

/**
 * `quick commit -m "<mensagem>" [<arquivos…> | --all]`: the commit of the open quick, made by the CLI with its
 * trailers, so a hand commit is never the hole in the origin gate. Without files or --all, what is staged.
 */
function commit(root, input = {}) {
  const rec = current(root);
  if (!rec) throw new Error('nenhum quick aberto (oxe-cc quick <KEY> "<objetivo>")');
  const message = String(input.message || '').trim();
  if (message.length < 4) throw new Error('informe a mensagem do commit (-m "<mensagem>")');
  const spawn = input.spawn || spawnSync;
  const originMod = require('./oxe-origin.cjs');
  const git = (args) => {
    const r = spawn('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
    return String(r.stdout || '');
  };
  const parsePorcelainLine = (l) => {
    const body = l.slice(3);
    const target = l.startsWith('R') || l.startsWith('C') ? body.split(' -> ').pop() : body;
    return originMod.unquoteGitPath(target);
  };
  if (input.dryRun) {
    // --dry-run: what would be committed and the message with the trailers; nothing staged, nothing committed
    const files = input.all ? git(['status', '--porcelain']).split(/\r?\n/).filter((l) => l.length > 3).map(parsePorcelainLine).filter(Boolean)
      : input.paths && input.paths.length ? input.paths : git(['diff', '--cached', '--name-only']).split(/\r?\n/).map((l) => originMod.unquoteGitPath(l)).filter(Boolean);
    return { id: rec.id, key: rec.key, dry_run: true, files, message: originMod.appendTrailers(message, trailers(rec)).trim() };
  }
  const hasExplicitPaths = Boolean(!input.all && input.paths && input.paths.length);
  const normRel = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  let otherStaged = [];
  if (hasExplicitPaths) {
    const preStaged = git(['diff', '--cached', '--name-only']).split(/\r?\n/).map((l) => normRel(originMod.unquoteGitPath(l))).filter(Boolean);
    const wantedSet = new Set(input.paths.map(normRel));
    otherStaged = preStaged.filter((p) => !wantedSet.has(p));
  }
  if (input.all) git(['add', '-A']);
  else if (hasExplicitPaths) {
    // a path deleted in this commit (OxeSpace 14/11): `git add` refuses it once `git rm` staged the deletion; stage the
    // deletion if it is not staged yet, and nothing if it already is
    const present = input.paths.filter((p) => fs.existsSync(path.join(root, p)));
    const gone = input.paths.filter((p) => !present.includes(p));
    if (present.length) git(['add', '--', ...present]);
    if (gone.length) git(['rm', '-q', '--cached', '--ignore-unmatch', '--', ...gone]);
  }
  const stagedAll = git(['diff', '--cached', '--name-only']).split(/\r?\n/).map((l) => originMod.unquoteGitPath(l)).filter(Boolean);
  const staged = hasExplicitPaths
    ? stagedAll.filter((p) => input.paths.map(normRel).includes(normRel(p)))
    : stagedAll;
  if (!staged.length) throw new Error('nada para commitar: passe os arquivos, --all, ou faça git add antes');
  const full = originMod.appendTrailers(message, trailers(rec));
  const tmp = path.join(dirOf(root), `.commit-${rec.id}.txt`);
  fs.mkdirSync(dirOf(root), { recursive: true });
  fs.writeFileSync(tmp, full);
  // OXB-C2 #2: when explicit paths are given, commit ONLY those paths (`--only -- <paths>`) so unrelated staged files
  // (e.g. a leftover LF rewrite in index) are never swept into the quick commit.
  const commitArgs = hasExplicitPaths ? ['commit', '-q', '-F', tmp, '--only', '--', ...input.paths] : ['commit', '-q', '-F', tmp];
  try { git(commitArgs); } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
  const sha = git(['rev-parse', 'HEAD']).trim();
  return { id: rec.id, key: rec.key, sha, files: staged, message: full.trim(), ...(otherStaged.length ? { other_staged: otherStaged } : {}) };
}

/**
 * `quick cancel --reason "…" [--evidence <url|path>]` (G32): closes the open quick as `abandoned`, never "done" —
 * a quick that did not reproduce, or was dropped. The card is commented, never moved forward.
 */
function cancel(root, input = {}) {
  const rec = input.id ? read(root, input.id) : current(root);
  if (!rec) throw new Error('nenhum quick aberto (oxe-cc quick status)');
  if (rec.status !== 'open') throw new Error(`${rec.id} já está ${rec.status}`);
  const reason = String(input.reason || '').trim();
  if (reason.length < 8) throw new Error('informe o motivo em uma frase (--reason "…"): fica no registro e no card');
  const closed = { ...rec, status: 'abandoned', commits: commitsOf(root, rec.id, input.spawn || spawnSync), cancel: { reason, evidence: input.evidence ? String(input.evidence) : null, by: input.by || null }, closed_at: new Date().toISOString() };
  if (input.dryRun) return { ...closed, dry_run: true, status: rec.status, would_status: 'abandoned' };
  write(root, closed);
  try { fs.unlinkSync(currentFile(root)); } catch { /* */ }
  require('./oxe-agent-coord.cjs').tryAutoLease(root, 'release', { agent_id: `quick:${rec.id}`, task: rec.id }, { spawn: input.spawn || spawnSync });
  return { ...closed, cancelled: true };
}

function list(root, opts = {}) {
  const localIds = new Set();
  const ids = new Set();
  const take = (dir, targetSet) => { try { for (const f of fs.readdirSync(dir)) { const id = f.replace(/\.json$/, ''); if (ID_RE.test(id)) targetSet.add(id); } } catch { /* */ } };
  take(dirOf(root), localIds);
  for (const id of localIds) ids.add(id);
  const includeAll = opts && opts.local === true ? false : true;
  if (includeAll) {
    const m = mirrorDirOf(root);
    if (m) take(m, ids);
  }
  const open = current(root);
  const openId = open ? open.id : null;
  return [...ids].map((id) => {
    const rec = read(root, id);
    if (!rec) return null;
    return { ...rec, local: localIds.has(id), active: id === openId };
  }).filter(Boolean).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

/** The ALM comment of a quick: the mini-spec at the start, the commits and the verification at the end. */
function cardComment(rec, phase) {
  if (phase === 'cancel') return [`Quick ${rec.id} abandonado (OXE)`, '', `Objetivo: ${rec.objective}`, '', `Motivo: ${rec.cancel.reason}`, ...(rec.cancel.evidence ? ['', `Evidência: ${rec.cancel.evidence}`] : []), '', 'O card não avança por este quick.'].join('\n');
  if (phase === 'start') return [`Quick ${rec.id} (OXE)`, '', `Objetivo: ${rec.objective}`, '', `Commits deste quick levam ${trailers(rec).join(' e ')}.`].join('\n');
  return [`Quick ${rec.id} concluído (OXE)`, '', `Objetivo: ${rec.objective}`, '',
    rec.commits.length ? `Commits (${rec.commits.length}):\n${rec.commits.map((c) => `- ${c.sha.slice(0, 9)} ${c.subject}`).join('\n')}` : 'Sem commit: nada precisou mudar.',
    '', rec.verify ? `Verificação: \`${rec.verify.command}\` → ${rec.verify.ok ? 'passou' : `falhou (exit ${rec.verify.exit})`}` : 'Verificação: não informada (quick done --verify "<comando>")'].join('\n');
}

/**
 * The base branch a quick PR targets: `delivery.base` of the config, else the remote's default (`origin/HEAD`), else
 * `main`. Read-only (one git call).
 */
function baseBranchOf(root, cfg = null, spawn = spawnSync) {
  const d = cfg && cfg.delivery && typeof cfg.delivery === 'object' ? cfg.delivery : null;
  if (d && d.base) return String(d.base);
  try {
    const r = spawn('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const ref = r && r.status === 0 ? String(r.stdout || '').trim() : '';
    if (ref) return ref.replace(/^origin\//, '');
  } catch { /* no remote */ }
  return 'main';
}

/**
 * Returns the quick relevant to this worktree: either the currently open quick (`.oxe/quick/current.json`)
 * or a locally recorded `done` quick whose commits sit at HEAD (and not yet promoted to a PR).
 */
function activeOnWorktree(root, spawn = spawnSync) {
  const open = current(root);
  if (open) return { state: 'open', quick: open };
  const localDir = dirOf(root);
  if (!fs.existsSync(localDir)) return null;
  let headSha = null;
  let headMsg = '';
  try {
    const r = spawn('git', ['log', '-1', '--format=%H%x1f%B'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const [h, ...rest] = String(r.stdout || '').split('\x1f');
      headSha = (h || '').trim() || null;
      headMsg = rest.join('\x1f');
    }
  } catch { /* ignore */ }
  const branch = currentBranchOf(root, spawn);
  const localRecs = [];
  try {
    for (const f of fs.readdirSync(localDir)) {
      const id = f.replace(/\.json$/, '');
      if (!ID_RE.test(id)) continue;
      const rec = read(root, id);
      if (rec && rec.status === 'done') localRecs.push(rec);
    }
  } catch { /* ignore */ }
  localRecs.sort((a, b) => String(b.closed_at || b.started_at || '').localeCompare(String(a.closed_at || a.started_at || '')));
  for (const rec of localRecs) {
    if (rec.pr) continue;
    const headHasTrailer = headMsg && new RegExp(`^OXE-Quick:\\s*${rec.id}$`, 'm').test(headMsg);
    const headInCommits = headSha && Array.isArray(rec.commits) && rec.commits.some((c) => c && c.sha === headSha);
    const sameBranch = branch && rec.branch && rec.branch === branch;
    if (headHasTrailer || headInCommits || sameBranch) return { state: 'done', quick: rec };
  }
  return null;
}

/**
 * OXB-C20 #7: `oxe-cc quick promote [--id <Q-...>] [--open-pr] [--base main] [--draft] [--dry-run] [--force]`:
 * checks commit origin, pushes the current branch and opens a PR with `Fecha <KEY>` + quick verification summary.
 */
function promote(root, input = {}) {
  const spawn = input.spawn || spawnSync;
  let rec = input.id ? read(root, input.id) : null;
  if (!rec) {
    const act = activeOnWorktree(root, spawn);
    rec = act ? act.quick : null;
  }
  if (!rec) {
    const localDir = dirOf(root);
    const localIds = fs.existsSync(localDir)
      ? fs.readdirSync(localDir).map((f) => f.replace(/\.json$/, '')).filter((id) => ID_RE.test(id))
      : [];
    const localRecs = localIds.map((id) => read(root, id)).filter((r) => r && (r.status === 'done' || r.status === 'open'))
      .sort((a, b) => String(b.closed_at || b.started_at || '').localeCompare(String(a.closed_at || a.started_at || '')));
    rec = localRecs[0] || null;
  }
  if (!rec) throw new Error('nenhum quick local encontrado para promover (abra com oxe-cc quick <KEY> "<objetivo>" ou informe --id Q-...)');
  const branch = currentBranchOf(root, spawn);
  const base = String(input.base || baseBranchOf(root, input.config || null, spawn));
  if (branch && branch === base && input.openPr && !input.dryRun) {
    throw new Error(`você está na branch base (${base}): crie uma branch para o quick antes de abrir o PR`);
  }
  const commits = Array.isArray(rec.commits) && rec.commits.length ? rec.commits : commitsOf(root, rec.id, spawn);
  // OXB-C31-5 (152perf, OXE-386 #1059): the origin check ran against the LOCAL main, 4245 commits behind in the
  // program worktrees, and refused 84 commits the PR never carried. Like runtime promote (OXB-157): the range starts
  // at <remote>/<base> when it exists; the PR still targets <base>.
  const warnings = [];
  let rangeBase = base;
  if (!/^[0-9a-f]{7,40}$/i.test(base) && !base.includes('/')) {
    const git = (args) => spawn('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }) || {};
    const remotes = String((git(['remote']).stdout) || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (remotes.includes('origin')) {
      if (input.fetch !== false) git(['fetch', '-q', 'origin', base]);
      const remoteRef = `origin/${base}`;
      const has = git(['rev-parse', '--verify', '-q', `${remoteRef}^{commit}`]);
      if (has.status === 0 && String(has.stdout || '').trim()) {
        rangeBase = remoteRef;
        const behind = Number(String((git(['rev-list', '--count', `refs/heads/${base}..${remoteRef}`]).stdout) || '').trim()) || 0;
        if (behind > 0) warnings.push(`a branch local ${base} está ${behind} commit(s) atrás de ${remoteRef} — o check-origin usa ${remoteRef}..HEAD`);
      }
    }
  }
  let origin = null;
  try {
    const originLib = require('./oxe-origin.cjs');
    // oxe-origin.check reads `target` (a range or #PR); the spawn only when injected — a mocked spawn turns off the
    // lookup of the records mirrored for the sibling worktrees (the same rule as ship check-origin)
    origin = originLib.check(root, { target: `${rangeBase}..HEAD`, ...(input.spawn ? { spawn: input.spawn } : {}) });
  } catch (err) {
    origin = { ok: true, skipped: true, reason: err.message };
  }
  const title = rec.key ? `${rec.key}: ${rec.objective.slice(0, 72)}` : `quick: ${rec.objective.slice(0, 72)}`;
  const bodyLines = [
    ...(rec.key ? [`Fecha ${rec.key}`, ''] : []),
    '## Objetivo',
    '',
    rec.objective,
    '',
    '## Rastreabilidade OXE',
    '',
    `- \`OXE-Quick: ${rec.id}\``,
    ...(rec.key ? [`- \`OXE-Card: ${rec.key}\``] : []),
    ...(rec.verify ? [`- Verificação: \`${rec.verify.command}\` → ${rec.verify.ok ? 'passou' : `falhou (exit ${rec.verify.exit})`}`] : []),
    ...(commits.length ? ['', '## Commits', '', ...commits.map((c) => `- \`${String(c.sha).slice(0, 9)}\` ${c.subject}`)] : []),
  ];
  const body = bodyLines.join('\n');
  if (input.dryRun || !input.openPr) {
    return {
      promoted: false,
      dry_run: Boolean(input.dryRun),
      planned: true,
      id: rec.id,
      key: rec.key,
      branch,
      base,
      title,
      body,
      commits: commits.length,
      origin,
      range_base: rangeBase,
      warnings,
    };
  }
  if (origin && origin.ok === false && !input.force) {
    throw new Error(`ship check-origin reprovou ${(origin.violations || []).length} commit(s) sem origem na branch (${(origin.violations || []).slice(0, 3).map((v) => String(v.sha || '').slice(0, 9)).filter(Boolean).join(', ') || rangeBase + '..HEAD'}; intervalo ${rangeBase}..HEAD) — corrija ou use --force`);
  }
  const pushRes = spawn('git', ['push', '-u', 'origin', branch || 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (pushRes.status !== 0) {
    throw new Error(`git push falhou: ${(pushRes.stderr || pushRes.stdout || '').trim()}`);
  }
  const ghArgs = ['pr', 'create', '--base', base, '--title', title, '--body', body, ...(input.draft ? ['--draft'] : [])];
  const prRes = spawn('gh', ghArgs, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (prRes.status !== 0) {
    throw new Error(`gh pr create falhou: ${(prRes.stderr || prRes.stdout || '').trim()}`);
  }
  const prUrl = String(prRes.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  const updated = { ...rec, pr: prUrl || null, promoted_at: new Date().toISOString() };
  write(root, updated);
  return {
    promoted: true,
    id: rec.id,
    key: rec.key,
    branch,
    base,
    title,
    body,
    pr: prUrl || null,
    commits: commits.length,
    origin,
    range_base: rangeBase,
    warnings,
  };
}

module.exports = { start, done, commit, cancel, promote, current, activeOnWorktree, baseBranchOf, currentBranchOf, list, read, exists, mirrorDirOf, trailers, commitsOf, quickMd, cardComment, newId, ID_RE };
