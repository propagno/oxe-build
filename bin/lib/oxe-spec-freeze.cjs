'use strict';

/**
 * OXB-099: `oxe-cc spec freeze --from <PR|sha> [--paths glob] [--criteria A12] [--cr CR-n]` imports the frozen tests a
 * PR (or commit) brings into the program: each test file it changed (filtered by --paths) becomes an
 * `acceptance_tests` entry of PLAN.json with its `proves` (the it/test titles in the file), its content hash and its
 * origin (`{ kind: pr|sha, ref, sha }`). The criterion comes from --criteria, else from an `A<n>` in the file's
 * describe/it titles. A file already frozen with different content is refused unless a CR is named (`--cr`), which is
 * recorded as `resolves`. A file not yet in the working tree is written from the ref.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { unquoteGitPath } = require('./oxe-origin.cjs');

const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (p) => String(p).replace(/\\/g, '/');
function globRe(g) { return new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')}$`); }

// the same reader the plan lint uses (OxeSpace 14/11, CR-07: freeze kept `\'` in the titles and the lint, which
// unescapes, refused 9 proves): JS escapes undone, it.each/test.each, template literals without ${…}, JVM tests
function titlesOf(text, file) {
  return [...new Set(require('./oxe-plan-json.cjs').declaredTestTitles(text, file))].filter(Boolean);
}
/**
 * OxeSpace 14/11 (OxeCode F4 T20): a test file shared by two tasks (`-t "OXE-128 next"` / `-t "OXE-128 ring"`) put all 9
 * titles in T20's proves; the 4 ring ones never run under T20's filter → proof_not_executed. The full name of each
 * test (its enclosing describe titles + its own, joined by a space, as vitest/jest match `-t`) is filtered by the
 * pattern.
 */
/** Comments blanked out (same length, positions kept), strings untouched — a commented-out it() is not a test. */
function blankComments(text) {
  const s = String(text || '');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      for (; j < s.length && s[j] !== ch; j += 1) if (s[j] === '\\') j += 1;
      out += s.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && s[i + 1] === '/') {
      let j = s.indexOf('\n', i);
      if (j < 0) j = s.length;
      out += ' '.repeat(j - i);
      i = j - 1;
    } else if (ch === '/' && s[i + 1] === '*') {
      let j = s.indexOf('*/', i + 2);
      j = j < 0 ? s.length : j + 2;
      out += s.slice(i, j).replace(/[^\n]/g, ' ');
      i = j - 1;
    } else out += ch;
  }
  return out;
}

function fullTestNames(text) {
  const src = blankComments(text);
  // index of the ")" closing the "(" at `open`, skipping strings, template literals and comments
  const closeOf = (open) => {
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
      if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return src.length; i += 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') {
        for (i += 1; i < src.length && src[i] !== ch; i += 1) if (src[i] === '\\') i += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) return i; }
    }
    return src.length;
  };
  const unq = (s) => s.replace(/\\(['"`\\])/g, '$1');
  const describes = [];
  for (const m of src.matchAll(/(?:\btest\.)?\bdescribe(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const open = m.index + m[0].indexOf('(');
    describes.push({ title: unq(m[2]), start: open, end: closeOf(open) });
  }
  const out = [];
  for (const m of src.matchAll(/\b(?:it|test)(?!\.(?:describe|suite|step|beforeEach|afterEach|beforeAll|afterAll|before|after|use|info|expect|extend|setTimeout|configure)\b)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    const at = m.index;
    const chain = describes.filter((d) => d.start < at && at < d.end).sort((a, b) => a.start - b.start).map((d) => d.title);
    out.push({ title: unq(m[2]), full: [...chain, unq(m[2])].join(' ') });
  }
  return out;
}

const JVM_FILE = /\.(kt|kts|java|groovy|scala)$/i;

/**
 * OxeSpace 14/11 (Celular F3): --proves-filter never matched Kotlin tests. JVM full names are `package.Class.method`
 * (what Gradle's --tests matches); a @DisplayName title takes the full name of the method it annotates.
 */
function fullJvmTestNames(text) {
  const src = blankComments(text);
  const pkg = (/^\s*package\s+([\w.]+)/m.exec(src) || [])[1] || '';
  const classes = [...src.matchAll(/\b(?:class|object|interface)\s+([A-Za-z_$][\w$]*)/g)].map((m) => ({ name: m[1], at: m.index }));
  const classAt = (i) => { let c = ''; for (const k of classes) if (k.at < i) c = k.name; return c; };
  const full = (cls, name) => [pkg, cls, name].filter(Boolean).join('.');
  const out = [];
  const titles = require('./oxe-plan-json.cjs').declaredTestTitles(text, 'x.kt');
  for (const t of titles) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fun = new RegExp(`\\bfun\\s+(?:\`${esc}\`|${esc})\\s*\\(|\\b${esc}\\s*\\(`).exec(src);
    if (fun) { out.push({ title: t, full: full(classAt(fun.index), t) }); continue; }
    // a @DisplayName: the method that follows it
    const disp = new RegExp(`@DisplayName\\(\\s*"${esc.replace(/"/g, '\\\\"')}"`).exec(src);
    if (disp) {
      const next = /\bfun\s+(?:`([^`]+)`|([A-Za-z_$][\w$]*))|\b(?:void|public|private)\s+(?:\w+\s+)*([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(disp.index));
      const method = next ? (next[1] || next[2] || next[3]) : t;
      out.push({ title: t, full: full(classAt(disp.index), method) });
    }
  }
  return out;
}

/** The `-t` / `--testNamePattern` / `--grep` (JS) or `--tests` (Gradle) pattern of a test command, or null. */
function namePatternOf(command) {
  const m = /(?:^|\s)(?:-t|--testNamePattern|--test-name-pattern|--grep|--tests)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(String(command || ''));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function filterTitles(text, titles, pattern, file = '') {
  if (!pattern) return titles;
  if (JVM_FILE.test(String(file))) {
    // Gradle --tests: a glob over package.Class.method (* = anything); without *, a part of the name
    const re = pattern.includes('*') ? new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null;
    const hit = (s) => (re ? re.test(s) : s.includes(pattern));
    const selected = new Set(fullJvmTestNames(text).filter((t) => hit(t.full)).map((t) => t.title));
    return titles.filter((t) => selected.has(t));
  }
  let re = null;
  try { re = new RegExp(pattern); } catch { re = null; }
  const hit = (s) => (re ? re.test(s) : s.includes(pattern));
  const selected = new Set(fullTestNames(text).filter((t) => hit(t.full)).map((t) => t.title));
  return titles.filter((t) => selected.has(t));
}

function criterionOf(text) {
  const src = blankComments(text);
  for (const m of src.matchAll(/\b(?:describe|it|test)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const hit = /\b(A\d+(?:\.\d+)?|AC-\d+(?:\.\d+)?)\b/.exec(m[2]);
    if (hit) return hit[1];
  }
  return null;
}

/** The ref's commit sha and changed files: a PR via `gh`, a sha via git. spawn is injectable (tests). */
function resolveRef(root, from, spawn = spawnSync) {
  const pr = /^(?:#|pr[-:]?)?(\d+)$/i.exec(String(from));
  if (pr && !/^[0-9a-f]{7,40}$/i.test(String(from))) {
    const r = spawn('gh', ['pr', 'view', pr[1], '--json', 'headRefOid,files,url'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`gh pr view ${pr[1]} falhou: ${String(r.stderr || '').trim().slice(0, 200)}`);
    const j = JSON.parse(r.stdout);
    return { kind: 'pr', ref: `#${pr[1]}`, url: j.url || null, sha: j.headRefOid, files: (j.files || []).map((f) => norm(f.path)) };
  }
  const v = spawn('git', ['rev-parse', '--verify', `${from}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (v.status !== 0) throw new Error(`${from}: não é um PR (#n) nem um commit deste repositório`);
  const s = v.stdout.trim();
  const d = spawn('git', ['diff-tree', '--root', '-m', '--first-parent', '--no-commit-id', '--name-only', '-r', s], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { kind: 'sha', ref: s.slice(0, 12), sha: s, files: String(d.stdout || '').split(/\r?\n/).filter(Boolean).map((f) => norm(unquoteGitPath(f))) };
}

function contentAt(root, ref, file, spawn = spawnSync) {
  const r = spawn('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function freeze(root, jsonPath, doc, options = {}) {
  if (options.task && !(doc.tasks || []).some((t) => t && String(t.id).toUpperCase() === String(options.task).toUpperCase())) throw new Error(`--task ${options.task}: tarefa inexistente no PLAN.json`);
  const origin = resolveRef(root, options.from, options.spawn);
  const globs = options.paths ? String(options.paths).split(',').map((g) => globRe(g.trim())) : null;
  const files = origin.files.filter((f) => TEST_RE.test(f) && (!globs || globs.some((re) => re.test(f))));
  if (!files.length) throw new Error(`${origin.ref}: nenhum arquivo de teste${options.paths ? ` em ${options.paths}` : ''}`);
  doc.acceptance_tests = Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : [];
  const frozen = [];
  const refused = [];
  for (const f of files) {
    let text = contentAt(root, origin.sha, f, options.spawn);
    const abs = path.join(root, f);
    const local = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (text == null) text = local;
    if (text == null) { refused.push({ file: f, why: `o conteúdo de ${f} em ${origin.ref} não está disponível (faça fetch do PR)` }); continue; }
    const hash = sha(text);
    // OxeSpace 15/11 (OxeCode F4, CR-F4-6): A17 and A18 share a test file; picking the first entry listing it made
    // `--criteria A18` overwrite A17's entry. With --criteria, the entry is that criterion's (a new one when the file is
    // only another criterion's); without it, the first entry listing the file, as before.
    const wantedCriterion = options.criteria ? String(options.criteria).split(',')[0].trim().toUpperCase() : null;
    const withFile = doc.acceptance_tests.filter((a) => (a.files || []).map((x) => norm(typeof x === 'string' ? x : x.path)).includes(f));
    const existing = wantedCriterion
      ? withFile.find((a) => String(a.criterion || '').toUpperCase() === wantedCriterion) || withFile.find((a) => !a.criterion) || null
      : withFile[0] || null;
    if (existing && existing.sha256 && existing.sha256 !== hash && !options.cr) { refused.push({ file: f, why: `${f} já está congelado com outro conteúdo — mudar um teste congelado exige um CR (--cr CR-n)` }); continue; }
    const criterion = (options.criteria && String(options.criteria).split(',')[0].trim().toUpperCase()) || criterionOf(text) || (existing && existing.criterion) || null;
    if (!criterion) { refused.push({ file: f, why: `${f}: sem critério — informe --criteria A<n> ou cite o A<n> no describe` }); continue; }
    const allTitles = titlesOf(text, f);
    if (!allTitles.length) { refused.push({ file: f, why: `${f}: nenhum it/test com título — nada a provar` }); continue; }
    // only the titles the entry's command selects (--proves-filter, or its -t / --testNamePattern)
    const pattern = options.provesFilter || namePatternOf(options.command || (existing && existing.command) || '');
    const proves = filterTitles(text, allTitles, pattern, f);
    if (!proves.length) { refused.push({ file: f, why: `${f}: o filtro "${pattern}" não seleciona nenhum dos ${allTitles.length} testes — confira o -t do comando ou o --proves-filter` }); continue; }
    if (local == null || local !== text) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); }
    const entry = {
      ...(existing || {}),
      criterion,
      // the entry's other files stay (OxeSpace 14/11, Celular F3: RenderedScreen.kt dropped out of A7/A8/A9/A11)
      files: [...new Set([...((existing && existing.files) || []).map((x) => norm(typeof x === 'string' ? x : x.path)), f])],
      // an explicit --command wins on a re-freeze (OxeSpace 14/11: A5 kept a command naming a deleted .ts)
      command: options.command || (existing && existing.command) || `npx vitest run ${f}`,
      proves,
      sha256: hash,
      // per file: the run's acceptance lock and the dossier read the re-frozen hash of THIS file (OxeSpace 14/11, F2 close)
      hashes: { ...((existing && existing.hashes) || {}), [f]: hash },
      origin: { kind: origin.kind, ref: origin.ref, sha: origin.sha, ...(origin.url ? { url: origin.url } : {}) },
      // idempotent: freezing again for the same CR re-reads the titles and the hash, but bumps the version only the
      // first time that CR touches the entry
      ...(options.cr ? { resolves: [...new Set([...((existing && existing.resolves) || []), String(options.cr).toUpperCase()])], version: ((existing && existing.version) || 1) + (existing && !((existing.resolves || []).includes(String(options.cr).toUpperCase())) ? 1 : 0) } : {}),
      // --task T3: the test belongs to that task (no hand edit of "task" in an executing phase's PLAN.json)
      ...(options.task ? { task: String(options.task).toUpperCase() } : {}),
    };
    if (existing) Object.assign(existing, entry); else doc.acceptance_tests.push(entry);
    frozen.push({ file: f, criterion, proves: proves.length, origin: origin.ref });
  }
  if (frozen.length) fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  // OXB-109 / OXB-205: the imported tests go through the same rigor + suspicious-regex lint as the planned ones.
  let rigor = [];
  try {
    const r = require('./oxe-test-rigor.cjs');
    const imported = { acceptance_tests: doc.acceptance_tests.filter((a) => frozen.some((f) => (a.files || []).includes(f.file))), scanAcceptanceDir: false };
    rigor = [
      ...r.rigorMessages(r.sourceAssertionFindings(root, imported)),
      ...r.suspiciousRegexMessages(r.suspiciousRegexFindings(root, imported)),
      ...r.pausedSocketMessages(r.pausedSocketFindings(root, imported)),
    ];
  } catch { rigor = []; }
  return { origin, frozen, refused, rigor };
}

module.exports = { freeze, titlesOf, criterionOf, resolveRef, fullTestNames, fullJvmTestNames, namePatternOf, filterTitles };
