'use strict';

/**
 * 1.21.2 — G11, the origin gate (user rule relayed 14/11: "nada pode ser implementado se não vier do quick-win ou do
 * oxe-execute"). Every commit that reaches a PR carries where it came from:
 *   - `OXE-Task: F2/T4` (+ `OXE-Run: <id>`) — stamped by `oxe-cc runtime execute`;
 *   - `OXE-Quick: Q-20261114-ab12` (+ `OXE-Card: OXE-135` when an ALM is configured) — a registered quick
 *     (`oxe-cc quick <KEY> "<objetivo>"`, record in .oxe/quick/).
 * What needs none is explicit in `origin.exempt`: merge commits, listed authors (the merge train's bot, the release
 * bot), and commits that only touch listed paths (`.oxe/`, `docs/releases/`). Nothing is exempt by guess.
 *
 * `check(...)` reads a range (default `<base>..HEAD`) or a PR (`gh pr view <n> --json commits`). `commitMsg(...)` is
 * the commit-msg hook: it appends the open quick's trailers, or refuses a commit with no origin.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASK_RE = /^OXE-Task:\s*(?:F\d+\/)?T\d+\s*$/m;
const RUN_RE = /^OXE-Run:\s*\S+\s*$/m;
const QUICK_RE = /^OXE-Quick:\s*(Q-\d{8}-[a-z0-9]{4})\s*$/im;
const CARD_RE = /^OXE-Card:\s*([A-Za-z][A-Za-z0-9]*-\d+|\d+)\s*$/m;

/** The origin block of .oxe/config.json, with the defaults. `require_card` defaults to "an ALM is configured". */
function originConfig(config = {}) {
  const o = config.origin && typeof config.origin === 'object' ? config.origin : {};
  const ex = o.exempt && typeof o.exempt === 'object' ? o.exempt : {};
  const almOn = Boolean(config.alm && config.alm.provider && config.alm.provider !== 'none');
  return {
    exempt: {
      merges: ex.merges !== false,
      authors: Array.isArray(ex.authors) ? ex.authors.map(String) : [],
      paths: Array.isArray(ex.paths) ? ex.paths.map((p) => String(p).replace(/\\/g, '/')) : ['.oxe/'],
      // G20: an author exempt ONLY for its own paths (github-actions[bot] for the goldens the CI re-records, not for
      // any path): [{ "author": "github-actions[bot]", "paths": ["mobile/android/app/src/test/snapshots/"] }]
      authored: Array.isArray(ex.authored) ? ex.authored.filter((r) => r && r.author && Array.isArray(r.paths) && r.paths.length).map((r) => ({ author: String(r.author), paths: r.paths.map((p) => String(p).replace(/\\/g, '/')) })) : [],
      // a one-off commit, by its full SHA, with the reason and who decided (audited: listed in every report)
      commits: Array.isArray(ex.commits) ? ex.commits.filter((c) => c && /^[0-9a-f]{40}$/i.test(String(c.sha || '')) && String(c.reason || '').trim().length >= 8 && String(c.by || '').trim()).map((c) => ({ sha: String(c.sha).toLowerCase(), reason: String(c.reason).trim(), by: String(c.by).trim() })) : [],
    },
    // entries of origin.exempt.commits that are refused (short SHA, no reason, no by): never a silent exemption
    problems: Array.isArray(ex.commits) ? ex.commits.filter((c) => !(c && /^[0-9a-f]{40}$/i.test(String(c.sha || '')) && String(c.reason || '').trim().length >= 8 && String(c.by || '').trim())).map((c) => `origin.exempt.commits: entrada recusada ${JSON.stringify(c)} — exige sha completo (40 hex), reason (uma frase) e by`) : [],
    commit_msg: ['require', 'append', 'off'].includes(o.commit_msg) ? o.commit_msg : 'require',
    require_card: o.require_card != null ? o.require_card === true : almOn,
    base: typeof o.base === 'string' && o.base ? o.base : null,
    // G19: the cut — only commits after it are charged (a date, or a commit: what it already contains is history)
    since: typeof o.since === 'string' && o.since.trim() ? o.since.trim() : null,
  };
}

/**
 * G19: the origin config of a repo that does not version .oxe/ (OxeSpace): .oxe/config.json, then the versioned
 * `oxe.config.json` at the root (its `origin` wins, so the CI and every worktree read the same rules), then an
 * explicit `--config <file>`.
 */
function resolveConfig(root, base = {}, file = null) {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const out = { ...base };
  const versioned = read(path.join(root, 'oxe.config.json'));
  if (versioned && versioned.origin) out.origin = mergeOrigin(out.origin, versioned.origin);
  if (versioned && versioned.alm && !out.alm) out.alm = versioned.alm;
  if (file) {
    const explicit = read(path.resolve(root, file));
    if (!explicit) throw new Error(`--config ${file}: arquivo ausente ou JSON inválido`);
    if (explicit.origin) out.origin = mergeOrigin(out.origin, explicit.origin);
    if (explicit.alm) out.alm = explicit.alm;
  }
  return out;
}

/**
 * OxeSpace 15/11 (#854): the versioned `origin` replaced the whole `exempt` block of .oxe/config.json, so a one-off
 * exemption pinned locally (exempt.commits) vanished. The rules still win key by key; the exemption LISTS are joined
 * (commits by sha, paths, authors, authored), so an exemption is never dropped by another file's list.
 */
function mergeOrigin(base, over) {
  const a = base && typeof base === 'object' ? base : {};
  const b = over && typeof over === 'object' ? over : {};
  const out = { ...a, ...b };
  const ea = a.exempt && typeof a.exempt === 'object' ? a.exempt : null;
  const eb = b.exempt && typeof b.exempt === 'object' ? b.exempt : null;
  if (ea && eb) {
    // `over` first: on the same key (a commit sha) the versioned / --config entry wins (cross-review 15/11)
    const list = (k) => [...(Array.isArray(eb[k]) ? eb[k] : []), ...(Array.isArray(ea[k]) ? ea[k] : [])];
    const uniq = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const keys = { commits: (c) => String((c && c.sha) || '').toLowerCase() || JSON.stringify(c), paths: (p) => String(p), authors: (p) => String(p).toLowerCase(), authored: (r) => JSON.stringify(r) };
    out.exempt = { ...ea, ...eb };
    // a list neither side declares stays absent (paths keeps its default ['.oxe/'])
    for (const [k, key] of Object.entries(keys)) if (Array.isArray(ea[k]) || Array.isArray(eb[k])) out.exempt[k] = uniq(list(k), key);
    // the same author in both files: ONE rule with the union of its paths (a commit touching a/ and b/ fits it)
    if (Array.isArray(out.exempt.authored)) {
      const byAuthor = new Map();
      for (const r of out.exempt.authored) {
        if (!r || !r.author) continue;
        const k = String(r.author).toLowerCase();
        const prev = byAuthor.get(k);
        const paths = (Array.isArray(r.paths) ? r.paths : []).map((p) => String(p).replace(/\\/g, '/'));
        byAuthor.set(k, prev ? { ...prev, paths: [...new Set([...prev.paths, ...paths])] } : { ...r, paths });
      }
      out.exempt.authored = [...byAuthor.values()];
    }
  }
  return out;
}

const isDateCut = (s) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(s));

const normOriginPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Decodes git C-quoted output paths (e.g. `".oxe/sess\\303\\265es/notas.md"` → `".oxe/sessões/notas.md"`) without
 * altering git CLI arguments (preserving compatibility with mocked `spawn` callers).
 */
function unquoteGitPath(raw) {
  const s = String(raw || '').trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  const inner = s.slice(1, -1);
  const bytes = [];
  const escMap = { a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, '"': 0x22, '\\': 0x5c };
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const oct = /^[0-7]{1,3}/.exec(inner.slice(i + 1));
      if (oct) {
        bytes.push(parseInt(oct[0], 8) & 0xff);
        i += oct[0].length;
        continue;
      }
      const next = inner[i + 1];
      const code = Object.prototype.hasOwnProperty.call(escMap, next) ? escMap[next] : next.charCodeAt(0);
      bytes.push(code & 0xff);
      i += 1;
      continue;
    }
    for (const b of Buffer.from(inner[i], 'utf8')) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

function underPaths(file, paths) {
  const f = normOriginPath(unquoteGitPath(file));
  if (!f || !Array.isArray(paths)) return false;
  return paths.some((rawP) => {
    const p = normOriginPath(rawP);
    if (!p) return false;
    const clean = p.replace(/\/+$/, '');
    if (!clean) return false;
    if (p.endsWith('/')) return f.startsWith(`${clean}/`);
    return f === clean || f.startsWith(`${clean}/`);
  });
}

/**
 * One commit: `{ sha, parents, author: { name, email, login }, message, files }` → its origin verdict.
 * `ctx.quickExists(id)`: true / false when the quick records are readable here, null when not (a CI checkout).
 */
function classify(commit, ocfg, ctx = {}) {
  const base = { sha: commit.sha, subject: String(commit.message || '').split('\n')[0] };
  const pinned = (ocfg.exempt.commits || []).find((c) => c.sha === String(commit.sha || '').toLowerCase());
  if (pinned) return { ...base, ok: true, kind: 'exempt', reason: `commit isento por ${pinned.by}: ${pinned.reason}`, pinned: true };
  if (ocfg.since) {
    // a commit cut: what the cut commit contains, and also every commit dated before the cut commit (a long branch
    // opened before the rule is history too — OxeSpace 14/11, G23: 4af13af37 of 13/11 was charged in #808)
    const before = isDateCut(ocfg.since)
      ? Boolean(commit.date) && Date.parse(commit.date) < Date.parse(ocfg.since)
      : (typeof ctx.isAncestor === 'function' && ctx.isAncestor(commit.sha, ocfg.since) === true)
        || (Boolean(commit.date) && Boolean(ctx.cutDate) && Date.parse(commit.date) < Date.parse(ctx.cutDate));
    if (before) return { ...base, ok: true, kind: 'exempt', reason: `antes do corte (origin.since ${ocfg.since})` };
  }
  if (ocfg.exempt.merges && Number(commit.parents) > 1) return { ...base, ok: true, kind: 'exempt', reason: 'merge' };
  const who = [commit.author && commit.author.name, commit.author && commit.author.email, commit.author && commit.author.login].filter(Boolean).map((s) => String(s).toLowerCase());
  const byAuthor = ocfg.exempt.authors.find((a) => who.includes(String(a).toLowerCase()));
  if (byAuthor) return { ...base, ok: true, kind: 'exempt', reason: `autor ${byAuthor}` };
  const files = commit.files || [];
  const authored = ocfg.exempt.authored.find((r) => who.includes(r.author.toLowerCase()) && files.length && files.every((f) => underPaths(f, r.paths)));
  if (authored) return { ...base, ok: true, kind: 'exempt', reason: `autor ${authored.author} só em ${authored.paths.join(', ')}` };
  if (files.length && files.every((f) => underPaths(f, ocfg.exempt.paths))) return { ...base, ok: true, kind: 'exempt', reason: `só ${ocfg.exempt.paths.join(', ')}` };
  const msg = String(commit.message || '');
  if (TASK_RE.test(msg)) return { ...base, ok: true, kind: 'task', task: TASK_RE.exec(msg)[0].replace(/^OXE-Task:\s*/, '').trim(), run: RUN_RE.test(msg) ? RUN_RE.exec(msg)[0].replace(/^OXE-Run:\s*/, '').trim() : null };
  const q = QUICK_RE.exec(msg);
  if (q) {
    const card = CARD_RE.exec(msg);
    if (ocfg.require_card && !card) return { ...base, ok: false, kind: 'quick', quick: q[1], reason: 'OXE-Quick sem OXE-Card (com ALM, o quick nomeia o card)' };
    const known = typeof ctx.quickExists === 'function' ? ctx.quickExists(q[1]) : null;
    // OxeSpace 15/11 (#854, coordination): a commit made by `quick commit` (its trailers) whose local record was lost —
    // the commit is OLDER than the first record this checkout keeps, and the quick id's date is not after the commit.
    // A distinct, audited status: neither a pass nor a fail, listed in every report.
    if (known === false && ctx.quickStoreSince && (commit.date || commit.authored_date)) {
      const idDay = /^Q-(\d{4})(\d{2})(\d{2})-/.exec(q[1]);
      // a rebase / cherry-pick moves the COMMITTER date to now; the author date keeps when `quick commit` made it
      const commitMs = Math.min(...[commit.authored_date, commit.date].map((d) => Date.parse(d)).filter(Number.isFinite));
      const idOk = idDay ? Date.parse(`${idDay[1]}-${idDay[2]}-${idDay[3]}T00:00:00Z`) <= commitMs + 24 * 3600_000 : false;
      if (idOk && commitMs < Date.parse(ctx.quickStoreSince)) {
        return { ...base, ok: true, kind: 'quick_unrecorded', quick: q[1], card: card ? card[1] : null, reason: `registro ausente, trailer presente: ${q[1]} é anterior ao primeiro registro em .oxe/quick (${ctx.quickStoreSince})` };
      }
    }
    if (known === false) return { ...base, ok: false, kind: 'quick', quick: q[1], card: card ? card[1] : null, reason: `${q[1]} não está registrado em .oxe/quick/ (oxe-cc quick <KEY> "<objetivo>")` };
    return { ...base, ok: true, kind: 'quick', quick: q[1], card: card ? card[1] : null, verified: known };
  }
  return { ...base, ok: false, kind: 'missing', reason: 'sem origem: nem OXE-Task (runtime execute) nem OXE-Quick (oxe-cc quick)' };
}

function run(spawn, cmd, args, cwd) {
  const r = spawn(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${String((r.stderr || (r.error && r.error.message) || '')).trim().split('\n')[0] || `saiu com ${r.status}`}`);
  return String(r.stdout || '');
}

/** The commits of a git range, with parents, author, full message and files. */
function commitsFromGit(root, range, spawn = spawnSync) {
  const raw = run(spawn, 'git', ['log', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%aI%x1f%B%x1e', range], root);
  return raw.split('\x1e').map((s) => s.replace(/^\s+/, '')).filter(Boolean).map((rec) => {
    const [sha, parents, name, email, date, authoredDate, message] = rec.split('\x1f');
    const files = run(spawn, 'git', ['show', '--name-only', '--format=', '--no-renames', sha], root).split('\n').map((l) => unquoteGitPath(l)).filter(Boolean);
    return { sha, parents: String(parents || '').trim().split(/\s+/).filter(Boolean).length, author: { name, email }, date, authored_date: authoredDate || null, message: String(message || '').trim(), files };
  });
}

/** The commits of a PR (gh): message, authors and, per commit, parents and files (git when local, else gh api). */
function commitsFromPr(root, pr, spawn = spawnSync) {
  const view = JSON.parse(run(spawn, 'gh', ['pr', 'view', String(pr), '--json', 'commits,baseRefName,headRefName,url'], root));
  const out = [];
  for (const c of view.commits || []) {
    const sha = c.oid;
    let parents = null;
    let files = null;
    const local = spawn('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, windowsHide: true });
    if (local.status === 0) {
      parents = run(spawn, 'git', ['log', '-1', '--format=%P', sha], root).trim().split(/\s+/).filter(Boolean).length;
      files = run(spawn, 'git', ['show', '--name-only', '--format=', '--no-renames', sha], root).split('\n').map((l) => unquoteGitPath(l)).filter(Boolean);
    } else {
      const api = JSON.parse(run(spawn, 'gh', ['api', `repos/{owner}/{repo}/commits/${sha}`], root));
      parents = (api.parents || []).length;
      files = (api.files || []).map((f) => f.filename);
    }
    const a = (c.authors || [])[0] || {};
    out.push({ sha, parents, date: c.committedDate || c.authoredDate || null, authored_date: c.authoredDate || null, author: { name: a.name, email: a.email, login: a.login }, message: [c.messageHeadline, c.messageBody].filter(Boolean).join('\n\n'), files });
  }
  return { pr: Number(pr), url: view.url || null, base: view.baseRefName || null, head: view.headRefName || null, commits: out };
}

/**
 * `oxe-cc ship check-origin [<#PR>|<range>]`. `target`: "#801" / "801" (a PR), "a..b" (a range) or empty
 * (`<origin.base | origin/main>..HEAD`).
 */
function check(root, options = {}) {
  const config = resolveConfig(root, options.config || {}, options.configFile || null);
  const ocfg = originConfig(config);
  const spawn = options.spawn || spawnSync;
  const target = String(options.target || '').trim();
  const quickDir = path.join(root, '.oxe', 'quick');
  // OxeSpace 15/11: the records are mirrored in the git common dir (shared by every worktree): a record missing here
  // but in the mirror counts as recorded
  let mirrorDir = null;
  // never with a mocked spawn (a test of the classification): the mirror lookup runs real git
  if (!options.spawn) { try { mirrorDir = require('./oxe-quick.cjs').mirrorDirOf(root); } catch { mirrorDir = null; } }
  const stores = [quickDir, mirrorDir].filter((d) => d && fs.existsSync(d));
  const quickExists = stores.length ? (id) => stores.some((d) => fs.existsSync(path.join(d, `${id}.json`))) : () => null;
  // the start of the record stores this checkout sees: the earliest started_at among their records
  const quickStoreSince = (() => {
    let min = null;
    for (const dir of stores) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!/^Q-.*\.json$/.test(f)) continue;
          let r = null;
          try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { r = null; }
          const at = r && (r.started_at || r.created_at);
          if (at && Number.isFinite(Date.parse(at)) && (!min || Date.parse(at) < Date.parse(min))) min = at;
        }
      } catch { /* no store */ }
    }
    return min;
  })();
  let source;
  let commits;
  if (/^#?\d+$/.test(target)) {
    const pr = commitsFromPr(root, target.replace(/^#/, ''), spawn);
    source = { pr: pr.pr, url: pr.url, base: pr.base, head: pr.head };
    commits = pr.commits;
  } else {
    const range = target || `${ocfg.base || 'origin/main'}..HEAD`;
    source = { range };
    commits = commitsFromGit(root, range, spawn);
  }
  // a commit cut (origin.since = sha): what that commit already contains is history; needs the commit locally
  const isAncestor = (sha, cut) => { const r = spawn('git', ['merge-base', '--is-ancestor', sha, cut], { cwd: root, windowsHide: true }); return r.status === 0 ? true : r.status === 1 ? false : null; };
  const cutDate = ocfg.since && !isDateCut(ocfg.since) ? (() => { const r = spawn('git', ['log', '-1', '--format=%cI', ocfg.since], { cwd: root, encoding: 'utf8', windowsHide: true }); return r.status === 0 ? String(r.stdout || '').trim() || null : null; })() : null;
  const results = commits.map((c) => classify(c, ocfg, { quickExists, isAncestor, cutDate, quickStoreSince }));
  const violations = results.filter((r) => !r.ok);
  return { ok: violations.length === 0, ...source, commits: results.length, by_kind: results.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {}), results, violations, exempt: ocfg.exempt, since: ocfg.since, exempt_commits_used: results.filter((r) => r.pinned).map((r) => ({ sha: r.sha, reason: r.reason })), quick_unrecorded: results.filter((r) => r.kind === 'quick_unrecorded').map((r) => ({ sha: r.sha, quick: r.quick, reason: r.reason })), config_problems: ocfg.problems };
}

/** The trailers lines to append to a message that has none of them. */
function appendTrailers(message, trailers) {
  const body = String(message).replace(/\s+$/, '');
  const missing = trailers.filter((t) => !new RegExp(`^${t.split(':')[0]}:`, 'm').test(body));
  if (!missing.length) return `${body}\n`;
  // a trailer block is the last paragraph of "Key: value" lines; join it when there is one already
  const lastPara = body.split(/\n\s*\n/).pop() || '';
  const isTrailerBlock = lastPara.split('\n').every((l) => /^[A-Za-z][A-Za-z0-9-]*:\s/.test(l));
  return `${body}${isTrailerBlock && body.includes('\n') ? '\n' : '\n\n'}${missing.join('\n')}\n`;
}

/**
 * The commit-msg hook. `file`: the message file git passes. Returns `{ ok, appended?, reason? }`; the CLI exits 1
 * when not ok. A message with OXE-Task or OXE-Quick passes. With a quick open, its trailers are appended. Otherwise
 * (commit_msg "require") a merge in progress, an exempt author or only exempt staged paths pass; anything else is
 * refused, with the way out.
 */
function commitMsg(root, file, options = {}) {
  const config = resolveConfig(root, options.config || {}, options.configFile || null);
  const ocfg = originConfig(config);
  if (ocfg.commit_msg === 'off') return { ok: true, skipped: 'origin.commit_msg off' };
  const spawn = options.spawn || spawnSync;
  const message = fs.readFileSync(file, 'utf8');
  const text = message.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  if (TASK_RE.test(text) || QUICK_RE.test(text)) return { ok: true };
  const quick = options.currentQuick || null;
  if (quick) {
    const trailers = [`OXE-Quick: ${quick.id}`, ...(quick.key ? [`OXE-Card: ${quick.key}`] : [])];
    fs.writeFileSync(file, appendTrailers(text, trailers));
    return { ok: true, appended: trailers };
  }
  if (ocfg.commit_msg === 'append') return { ok: true, warning: 'sem origem: o check-origin do PR vai recusar este commit' };
  const gitDir = (() => { try { return path.resolve(root, run(spawn, 'git', ['rev-parse', '--git-dir'], root).trim()); } catch { return null; } })();
  if (ocfg.exempt.merges && gitDir && fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) return { ok: true, exempt: 'merge' };
  const ident = (() => { try { return run(spawn, 'git', ['var', 'GIT_AUTHOR_IDENT'], root).toLowerCase(); } catch { return ''; } })();
  const byAuthor = ocfg.exempt.authors.find((a) => ident.includes(String(a).toLowerCase()));
  if (byAuthor) return { ok: true, exempt: `autor ${byAuthor}` };
  const staged = (() => { try { return run(spawn, 'git', ['diff', '--cached', '--name-only'], root).split('\n').map((l) => unquoteGitPath(l)).filter(Boolean); } catch { return []; } })();
  const authored = ocfg.exempt.authored.find((r) => ident.includes(r.author.toLowerCase()) && staged.length && staged.every((f) => underPaths(f, r.paths)));
  if (authored) return { ok: true, exempt: `autor ${authored.author} só em ${authored.paths.join(', ')}` };
  if (staged.length && staged.every((f) => underPaths(f, ocfg.exempt.paths))) return { ok: true, exempt: `só ${ocfg.exempt.paths.join(', ')}` };
  return { ok: false, reason: 'commit sem origem: abra um quick (oxe-cc quick <KEY> "<objetivo>") ou rode a tarefa por oxe-cc runtime execute. Isenções só em origin.exempt (.oxe/config.json)' };
}

module.exports = { resolveConfig, originConfig, classify, check, commitsFromGit, commitsFromPr, commitMsg, appendTrailers, unquoteGitPath, underPaths, TASK_RE, QUICK_RE, CARD_RE };
