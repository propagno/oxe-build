'use strict';

/**
 * OXB-108: anti-stub verifier. A task green on its frozen tests can still ship a skeleton. Three levels per file the
 * task created or changed:
 *   1. exists      — every symbol its implementation-pack entry declares is defined in the declared file;
 *   2. substantive — no stub in the lines the task ADDED: "not implemented", a body that only throws/returns a TODO,
 *                    Kotlin TODO(), NotImplementedError, an empty exported function, a placeholder component;
 *   3. wired       — a NEW source file is imported/used by some other non-test file (or is a declared entry point).
 * Levels 1–2 run in the task's verify (a finding makes it red, with file:line). Level 3 runs at the phase verify: a
 * task may create a module the next task wires up, so "not wired yet" is only a defect when the phase closes.
 *
 * CLI (verify segment): node oxe-stub-check.cjs --task T3 [--root .] [--since <sha>] [--levels exists,substantive]
 *                       node oxe-stub-check.cjs --phase --since <base_commit> [--levels substantive,wired]
 * config `.oxe/config.json` "stub_check": false | { "wired": true, "entries": [globs], "ignore": [globs] }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java|py|go|rs|swift|cs)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * OXB-188: a stub the agent itself LABELS as blocked — a comment/KDoc with BLOCKED, "OXB stub", or "until <X> lands /
 * exists / is merged". It is not "almost done": the change it needs is outside the task's scope, so the task must
 * stop as scope_insufficient naming the file that owns the missing symbol, never complete.
 */
const COMMENT_RE = /^\s*(\/\/|\/\*+|\*|#|--|<!--)|\s(\/\/|\/\*|#)\s/;
const BLOCKED_PATTERNS = [
  /\bBLOCKED\b/,
  /\bOXB\b.{0,20}\bstub\b|\bstub\b.{0,20}\bOXB\b/i,
  /\buntil\b.{1,120}\b(lands?|exists?|is (merged|added|available|implemented)|gets? (added|merged))\b/i,
  /\baté (que )?.{1,100}\b(exist[ai]|ser (criad|mergead|implementad)|chegar)\w*/i,
];

const STUB_PATTERNS = [
  { re: /\bnot\s+implemented(\s+yet)?\b/i, why: 'marcador "not implemented"' },
  { re: /\bthrow\s+new\s+\w*Error\(\s*['"`]\s*(TODO|FIXME|stub|unimplemented)\b/i, why: 'corpo que só lança TODO/stub' },
  { re: /\breturn\s+(null|undefined|\{\s*\}|\[\s*\]|''|""|0|false)\s*;?\s*\/\/\s*(TODO|FIXME|stub)\b/i, why: 'retorno vazio marcado TODO' },
  { re: /(^|[^\w.])TODO\(\s*(['"][^'"]*['"])?\s*\)/, why: 'Kotlin TODO()' },
  { re: /\braise\s+NotImplementedError\b|\bNotImplementedError\(/, why: 'NotImplementedError' },
  { re: /\bunimplemented!\(|\btodo!\(/, why: 'Rust todo!/unimplemented!' },
  { re: /\bUnsupportedOperationException\(\s*["'][^"']*\b(TODO|not implemented)/i, why: 'UnsupportedOperationException TODO' },
  { re: /<[A-Za-z][\w.]*[^>]*>\s*(TODO|Placeholder|Coming soon|Lorem ipsum)\b[^<]*<\//i, why: 'componente placeholder' },
  { re: /^\s*export\s+(default\s+)?(async\s+)?function\s+\w*\s*\([^)]*\)\s*(:\s*[^{=]+)?\{\s*\}\s*;?\s*$/, why: 'função exportada vazia' },
  { re: /^\s*export\s+const\s+\w+\s*(:[^=]+)?=\s*(async\s*)?\([^)]*\)\s*(:\s*[^=]+)?=>\s*\{\s*\}\s*;?\s*$/, why: 'função exportada vazia' },
];

function config(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8'));
    if (cfg && cfg.stub_check === false) return null;
    return cfg && typeof cfg.stub_check === 'object' ? cfg.stub_check : {};
  } catch { return {}; }
}

function globRe(glob) {
  let re = '';
  const g = norm(glob);
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i += 1; if (g[i + 1] === '/') i += 1; } else re += '[^/]*'; }
    else re += /[.+^${}()|[\]\\?]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`, 'i');
}

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

/** Added lines of a file vs `base` (working tree), with their line numbers; a new/untracked file: every line. */
function addedLines(root, file, base) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) return [];
  const tracked = git(root, ['cat-file', '-e', `${base || 'HEAD'}:${file}`]).status === 0;
  if (!tracked) return fs.readFileSync(abs, 'utf8').split(/\r?\n/).map((text, i) => ({ line: i + 1, text }));
  const diff = git(root, ['diff', '-U0', base || 'HEAD', '--', file]).stdout || '';
  const out = [];
  let ln = 0;
  for (const l of diff.split(/\r?\n/)) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) { ln = Number(h[1]); continue; }
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) { out.push({ line: ln, text: l.slice(1) }); ln += 1; }
    else if (!l.startsWith('-') && !l.startsWith('\\')) ln += 1;
  }
  return out;
}

/** Files changed vs `base` (working tree included), new ones flagged. */
function changedFiles(root, base, scope) {
  const args = ['diff', '--name-status', base || 'HEAD', '--', ...(scope && scope.length ? scope : [])];
  const out = new Map();
  for (const l of (git(root, args).stdout || '').split(/\r?\n/)) {
    const m = /^([AMDRC])\d*\t(?:[^\t]+\t)?(.+)$/.exec(l);
    if (m && m[1] !== 'D') out.set(norm(m[2]), m[1] === 'A');
  }
  for (const l of (git(root, ['ls-files', '--others', '--exclude-standard', '--', ...(scope && scope.length ? scope : [])]).stdout || '').split(/\r?\n/)) {
    if (l.trim()) out.set(norm(l.trim()), true);
  }
  return out;
}

function definesSymbol(text, name) {
  const n = name.replace(/[$]/g, '\\$');
  return new RegExp(`\\b(function\\*?|class|const|let|var|interface|type|enum|fun|object|val|def|struct|trait|func)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b|\\b${n}\\s*[:=]\\s*(async\\s*)?(\\(|function)|\\b(module\\.)?exports\\.${n}\\s*=|module\\.exports\\s*=\\s*\\{[^}]*\\b${n}\\b`).test(text);
}

/** Level 1: symbols the pack declares for the task, defined in their files. */
function existsFindings(root, taskId) {
  const out = [];
  let pack = null;
  for (const p of [path.join(root, '.oxe', 'IMPLEMENTATION-PACK.json')]) { try { pack = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* */ } }
  const entry = pack && Array.isArray(pack.tasks) ? pack.tasks.find((t) => t && (t.id === taskId || t.task === taskId)) : null;
  for (const s of (entry && Array.isArray(entry.symbols) ? entry.symbols : [])) {
    if (!s || typeof s !== 'object' || s.exported === false) continue;
    const name = String(s.name || '').trim();
    const file = norm(s.path || s.file || '');
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || !file || file.includes('*')) continue;
    let text = null;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { text = null; }
    if (text == null) out.push({ level: 'exists', file, line: 0, why: `arquivo do símbolo ${name} não existe` });
    else if (!definesSymbol(text, name)) out.push({ level: 'exists', file, line: 0, why: `${name} declarado no pack, não definido no arquivo` });
  }
  return out;
}

/** Level 2: stubs in the added lines. */
/** The out-of-scope files a blocked stub points at: the files (outside the task's scope) that define the types it names. */
function blockedTargets(root, text, scope) {
  const names = [...new Set((String(text).match(/\b[A-Z][A-Za-z0-9]+(?:\.[a-z][A-Za-z0-9]*)?\b/g) || []).map((n) => n.split('.')[0]).filter((n) => !['BLOCKED', 'OXB', 'TODO', 'KDoc'].includes(n)))].slice(0, 6);
  const out = [];
  const inScope = new Set((scope || []).map(norm));
  for (const n of names) {
    const r = git(root, ['grep', '-l', '-E', `(class|interface|object|type|enum|struct|protocol)[[:space:]]+${n}\\b`]);
    for (const f of String(r.stdout || '').split(/\r?\n/).filter(Boolean).map(norm)) if (!inScope.has(f) && !TEST_RE.test(f) && !out.some((o) => o.file === f)) out.push({ file: f, symbol: n });
  }
  for (const p of String(text).match(/[\w./-]+\.(kt|kts|java|ts|tsx|js|py|go|rs|swift)\b/g) || []) if (!inScope.has(norm(p)) && !out.some((o) => o.file === norm(p))) out.push({ file: norm(p), symbol: null });
  return out.slice(0, 4);
}

function substantiveFindings(root, files, base, ignore, scope) {
  const out = [];
  for (const file of files) {
    if (!CODE_RE.test(file) || TEST_RE.test(file) || ignore.some((re) => re.test(file))) continue;
    for (const { line, text } of addedLines(root, file, base)) {
      if (/oxe-stub-ok/.test(text)) continue; // explicit, reviewed exception on the line
      if (COMMENT_RE.test(text) && BLOCKED_PATTERNS.some((re) => re.test(text))) {
        out.push({ level: 'blocked', file, line, why: 'stub marcado como bloqueado (BLOCKED / "until … lands")', text: text.trim().slice(0, 160), needs: blockedTargets(root, text, scope) });
        continue;
      }
      const hit = STUB_PATTERNS.find((p) => p.re.test(text));
      if (hit) out.push({ level: 'substantive', file, line, why: hit.why, text: text.trim().slice(0, 120) });
    }
  }
  return out;
}

/** Level 3: a new source file referenced by another non-test file, or a declared entry point. */
function wiredFindings(root, newFiles, entries, ignore) {
  const out = [];
  const candidates = newFiles.filter((f) => CODE_RE.test(f) && !TEST_RE.test(f) && !ignore.some((re) => re.test(f)) && !entries.some((re) => re.test(f)) && !/\.d\.ts$/.test(f) && !/(^|\/)(index|main)\.[^/]+$/.test(f));
  if (!candidates.length) return out;
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { pkg = {}; }
  const pkgEntries = JSON.stringify([pkg.main, pkg.bin, pkg.exports, pkg.module]).replace(/\\\\/g, '/');
  const tracked = (git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).stdout || '').split(/\r?\n/).map(norm).filter((f) => f && CODE_RE.test(f) && !TEST_RE.test(f));
  const texts = new Map();
  const read = (f) => { if (!texts.has(f)) { try { const st = fs.statSync(path.join(root, f)); texts.set(f, st.size < 1_500_000 ? fs.readFileSync(path.join(root, f), 'utf8') : ''); } catch { texts.set(f, ''); } } return texts.get(f); };
  for (const file of candidates) {
    const stem = path.posix.basename(file).replace(/\.[^.]+$/, '');
    if (pkgEntries.includes(file) || pkgEntries.includes(stem)) continue;
    const re = new RegExp(`['"\`][^'"\`]*\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z]+)?['"\`]|\\bimport\\s+[\\w.]*\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const used = tracked.some((other) => other !== file && re.test(read(other)));
    if (!used) out.push({ level: 'wired', file, line: 0, why: 'arquivo novo que nenhum outro arquivo (fora dos testes) importa ou usa' });
  }
  return out;
}

/** Findings for a task (levels exists + substantive by default) or a phase diff (substantive + wired). */
function stubFindings(root, options = {}) {
  const cfg = config(root);
  if (!cfg) return [];
  const ignore = (Array.isArray(cfg.ignore) ? cfg.ignore : []).map(globRe);
  const entries = (Array.isArray(cfg.entries) ? cfg.entries : []).map(globRe);
  // wired is opt-in (stub_check.wired: true): a module one phase delivers is often wired by a later phase.
  const levels = new Set(options.levels || (options.phase ? ['substantive', ...(cfg.wired === true ? ['wired'] : [])] : ['exists', 'substantive']));
  const changed = changedFiles(root, options.since || 'HEAD', options.scope || []);
  const files = [...changed.keys()];
  const out = [];
  if (levels.has('exists') && options.task) out.push(...existsFindings(root, options.task));
  if (levels.has('substantive')) out.push(...substantiveFindings(root, files, options.since || 'HEAD', ignore, options.scope || []));
  if (levels.has('wired')) out.push(...wiredFindings(root, files.filter((f) => changed.get(f)), entries, ignore));
  return out;
}

function format(findings) {
  return findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ''}  [${f.level}] ${f.why}${f.text ? `  — ${f.text}` : ''}${f.needs && f.needs.length ? `  → precisa de ${f.needs.map((n) => `${n.file}${n.symbol ? ` (${n.symbol})` : ''}`).join(', ')}` : ''}`).join('\n');
}

/** OXB-188: the line the scheduler reads to stop with scope_insufficient (no retry), naming the files. */
function blockedLine(findings) {
  const b = findings.filter((f) => f.level === 'blocked');
  if (!b.length) return null;
  const needs = [...new Set(b.flatMap((f) => (f.needs || []).map((n) => n.file)))];
  return `scope_insufficient: stub marcado como bloqueado em ${b.map((f) => `${f.file}:${f.line}`).join(', ')}${needs.length ? ` — a mudança precisa de ${needs.join(', ')}, fora do escopo da tarefa` : ''} (OXB-188)`;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const root = path.resolve(arg('--root') || process.cwd());
  const task = arg('--task');
  let scope = [];
  if (task) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'PLAN.json'), 'utf8'));
      const t = (doc.tasks || []).find((x) => x && x.id === task);
      scope = (t && t.files ? t.files : []).map(norm).filter((p) => p && !p.includes('*'));
    } catch { scope = []; }
  }
  const findings = stubFindings(root, { task, phase: argv.includes('--phase'), since: arg('--since'), scope, levels: arg('--levels') ? arg('--levels').split(',') : null });
  if (findings.length) {
    const bl = blockedLine(findings);
    if (bl) console.error(bl);
    console.error(`oxe stub-check: ${findings.length} problema(s) — a tarefa ainda não está pronta (OXB-108)\n${format(findings)}\n(exceção revisada: comente "oxe-stub-ok" na linha, ou stub_check.ignore no .oxe/config.json)`);
    process.exit(1);
  }
  console.log('oxe stub-check: ok');
}

module.exports = { blockedLine, blockedTargets, BLOCKED_PATTERNS, stubFindings, format, addedLines, STUB_PATTERNS };
