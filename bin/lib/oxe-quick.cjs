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

function read(root, id) {
  try { return JSON.parse(fs.readFileSync(fileOf(root, id), 'utf8')); } catch { return null; }
}

function write(root, rec) {
  fs.mkdirSync(dirOf(root), { recursive: true });
  fs.writeFileSync(fileOf(root, rec.id), `${JSON.stringify(rec, null, 2)}\n`);
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
    '## Objetivo', '', rec.objective, '',
    '## Passos', '', '1. (o /oxe-quick preenche: passos curtos, cada um rastreável ao Verificar)', '',
    '## Verificar', '', '- (o comando ou a checagem que prova o objetivo; rode com: oxe-cc quick done --verify "<comando>")', '',
    '## Origem dos commits', '', `Todo commit deste quick leva: ${trailers(rec).map((t) => `\`${t}\``).join(' e ')} (o hook commit-msg do \`oxe-cc guards install\` acrescenta sozinho).`, '',
    'Promover para spec/plan?: não', '',
  ].join('\n');
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
  const rec = { schema: 1, id: newId(input.now), key, objective, by: input.by || null, started_at: new Date().toISOString(), status: 'open', commits: [], verify: null, closed_at: null, ...(prevAbandoned ? { follows: prevAbandoned.id } : {}) };
  // --dry-run: validated, nothing written (no record, no QUICK.md, no current)
  if (input.dryRun) return { resumed: false, dry_run: true, ...rec, trailers: trailers(rec), would_replace: open ? open.id : null };
  if (open && input.replace) write(root, { ...open, status: 'replaced', closed_at: new Date().toISOString() });
  write(root, rec);
  fs.writeFileSync(currentFile(root), `${JSON.stringify({ id: rec.id }, null, 2)}\n`);
  if (input.quickFile) {
    fs.mkdirSync(path.dirname(input.quickFile), { recursive: true });
    fs.writeFileSync(input.quickFile, quickMd(rec));
  }
  return { resumed: false, ...rec, trailers: trailers(rec) };
}

/**
 * The commits of a quick, found by its trailer in every local and remote branch plus HEAD (OxeSpace 14/11, OXE-149:
 * 4 commits in two branches were counted as 1 from HEAD). Not `--all`: a stash commit is not the quick's.
 */
function commitsOf(root, id, spawn = spawnSync) {
  const r = spawn('git', ['log', '--format=%H%x1f%s', '-E', `--grep=^OXE-Quick: ${id}$`, 'HEAD', '--branches', '--remotes'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { sha, subject }; });
}

/**
 * Closes the open quick: the commits found by its trailer, the verification (command + exit + tail of the output, run
 * by the CLI) and the result. A quick with no commit closes only with `noCommit` (nothing needed to change).
 */
function done(root, input = {}) {
  const rec = input.id ? read(root, input.id) : current(root);
  if (!rec) throw new Error('nenhum quick aberto (oxe-cc quick <KEY> "<objetivo>")');
  if (rec.status !== 'open') throw new Error(`${rec.id} já está ${rec.status}`);
  const spawn = input.spawn || spawnSync;
  const commits = commitsOf(root, rec.id, spawn);
  if (!commits.length && !input.noCommit) throw new Error(`${rec.id}: nenhum commit com "OXE-Quick: ${rec.id}" — commite com o trailer (o hook commit-msg acrescenta) ou feche com --no-commit se nada precisou mudar`);
  // --dry-run: the commits found, the verification it would run; nothing run, nothing written
  if (input.dryRun) return { ...rec, dry_run: true, commits, closed: null, would_verify: input.verify || null };
  let verify = null;
  if (input.verify) {
    const r = spawn(input.verify, { cwd: root, encoding: 'utf8', shell: true, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
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
  return { ...closed, closed: true };
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
  const git = (args) => {
    const r = spawn('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
    return String(r.stdout || '');
  };
  if (input.dryRun) {
    // --dry-run: what would be committed and the message with the trailers; nothing staged, nothing committed
    const files = input.all ? git(['status', '--porcelain']).split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
      : input.paths && input.paths.length ? input.paths : git(['diff', '--cached', '--name-only']).split('\n').map((l) => l.trim()).filter(Boolean);
    return { id: rec.id, key: rec.key, dry_run: true, files, message: require('./oxe-origin.cjs').appendTrailers(message, trailers(rec)).trim() };
  }
  if (input.all) git(['add', '-A']);
  else if (input.paths && input.paths.length) {
    // a path deleted in this commit (OxeSpace 14/11): `git add` refuses it once `git rm` staged the deletion; stage the
    // deletion if it is not staged yet, and nothing if it already is
    const present = input.paths.filter((p) => fs.existsSync(path.join(root, p)));
    const gone = input.paths.filter((p) => !present.includes(p));
    if (present.length) git(['add', '--', ...present]);
    if (gone.length) git(['rm', '-q', '--cached', '--ignore-unmatch', '--', ...gone]);
  }
  const staged = git(['diff', '--cached', '--name-only']).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!staged.length) throw new Error('nada para commitar: passe os arquivos, --all, ou faça git add antes');
  const full = require('./oxe-origin.cjs').appendTrailers(message, trailers(rec));
  const tmp = path.join(dirOf(root), `.commit-${rec.id}.txt`);
  fs.mkdirSync(dirOf(root), { recursive: true });
  fs.writeFileSync(tmp, full);
  try { git(['commit', '-q', '-F', tmp]); } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
  const sha = git(['rev-parse', 'HEAD']).trim();
  return { id: rec.id, key: rec.key, sha, files: staged, message: full.trim() };
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
  return { ...closed, cancelled: true };
}

function list(root) {
  try {
    return fs.readdirSync(dirOf(root)).filter((f) => ID_RE.test(f.replace(/\.json$/, ''))).map((f) => read(root, f.replace(/\.json$/, ''))).filter(Boolean).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  } catch { return []; }
}

/** The ALM comment of a quick: the mini-spec at the start, the commits and the verification at the end. */
function cardComment(rec, phase) {
  if (phase === 'cancel') return [`Quick ${rec.id} abandonado (OXE)`, '', `Objetivo: ${rec.objective}`, '', `Motivo: ${rec.cancel.reason}`, ...(rec.cancel.evidence ? ['', `Evidência: ${rec.cancel.evidence}`] : []), '', 'O card não avança por este quick.'].join('\n');
  if (phase === 'start') return [`Quick ${rec.id} (OXE)`, '', `Objetivo: ${rec.objective}`, '', `Commits deste quick levam ${trailers(rec).join(' e ')}.`].join('\n');
  return [`Quick ${rec.id} concluído (OXE)`, '', `Objetivo: ${rec.objective}`, '',
    rec.commits.length ? `Commits (${rec.commits.length}):\n${rec.commits.map((c) => `- ${c.sha.slice(0, 9)} ${c.subject}`).join('\n')}` : 'Sem commit: nada precisou mudar.',
    '', rec.verify ? `Verificação: \`${rec.verify.command}\` → ${rec.verify.ok ? 'passou' : `falhou (exit ${rec.verify.exit})`}` : 'Verificação: não informada (quick done --verify "<comando>")'].join('\n');
}

module.exports = { start, done, commit, cancel, current, list, read, trailers, commitsOf, quickMd, cardComment, newId, ID_RE };
