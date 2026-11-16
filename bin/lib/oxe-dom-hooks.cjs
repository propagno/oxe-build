'use strict';

/**
 * OxeSpace 15/11 (OxeCode F6 T30 → #852): the task turned CommandMenu into the CommandBar palette and dropped the cmdk
 * markup ([cmdk-root], [cmdk-item][data-value=cmd-…]) that ~30 e2e specs and e2e/helpers read. The executor runs no
 * e2e and the checkpoint's related tests are vitest only, so the break showed only in the PR's CI.
 *
 * A static check, no e2e run: each DOM hook a commit REMOVES from markup (data-* / cmdk-* attributes, with their
 * static value or value prefix) that is gone from the whole product tree, but still READ by an e2e/test file, is
 * reported with its readers.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { unquoteGitPath } = require('./oxe-origin.cjs');

const MARKUP_RE = /\.(tsx|jsx|vue|svelte|html?|astro)$/i;
const TEST_PATH_RE = /(^|\/)(e2e|tests?|__tests__|spec|playwright|cypress)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$/i;
const NON_DOM_RE = /\.(css|scss|sass|less|styl|md|mdx|txt|svg|map|lock|ya?ml)$|(^|\/)(docs|\.oxe|\.github)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md)$/i;
const ARIA_READER_RE = /ByRole|ByLabel|aria-label|AccessibleName|\bname\s*:|toHaveAccessibleName|\btitle\b/i;
const TESTID_READER_RE = /data-testid|getByTestId|testid/i;
// data-* / cmdk-* attributes in markup: name, then an optional static value ("x", 'x', {"x"}, {`x-${…}`} → prefix)
const ATTR_RE = /(?<![\w-])((?:data|cmdk)-[a-z0-9-]+)(?:\s*=\s*(?:"([^"{}]*)"|'([^'{}]*)'|\{\s*["'`]([^"'`$]*)(\$\{)?[^}]*\}))?/gi;
// OxeSpace 15/11 (OxeCode F5 T22): an ACCESSIBLE NAME e2e reads by role + name ("Primary navigation", "Clear search"):
// aria-label="…" static, or aria-label={t('nav.primary')} resolved through the locale file
const ARIA_RE = /(?<![\w-])aria-label\s*=\s*(?:"([^"{}]{3,})"|'([^'{}]{3,})'|\{\s*t\(\s*['"`]([\w.:-]+)['"`][^)]*\)\s*\})/gi;

function git(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** Blank HTML (`<!-- -->`), block (`/* *\/`) and line (`//`) comments while keeping string literals intact. */
function stripMarkupComments(text) {
  const s = String(text || '');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      for (; j < s.length && s[j] !== ch; j += 1) if (s[j] === '\\') j += 1;
      out += s.slice(i, Math.min(j + 1, s.length));
      i = j;
    } else if (ch === '<' && s.slice(i, i + 4) === '<!--') {
      const end = s.indexOf('-->', i + 4);
      const stop = end < 0 ? s.length : end + 3;
      out += s.slice(i, stop).replace(/[^\r\n]/g, ' ');
      i = stop - 1;
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end < 0 ? s.length : end + 2;
      out += s.slice(i, stop).replace(/[^\r\n]/g, ' ');
      i = stop - 1;
    } else if (ch === '/' && s[i + 1] === '/') {
      let end = s.indexOf('\n', i + 2);
      if (end < 0) end = s.length;
      out += ' '.repeat(end - i);
      i = end - 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Hooks on removed (`-`) lines of a unified diff of markup files: [{ name, value, prefix, file }]. */
function removedHooks(diffText) {
  const out = new Map();
  let file = null;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line === '--- /dev/null') { file = null; continue; } // an added file: nothing removed from it
    const hdr = /^(?:\+\+\+ b\/|--- a\/)(.+)$/.exec(line) || /^(?:\+\+\+ "b\/|--- "a\/)(.+)"$/.exec(line);
    if (hdr) {
      if (line.startsWith('---')) file = unquoteGitPath(line.startsWith('--- "') ? `"${hdr[1]}"` : hdr[1]);
      continue;
    }
    if (!file || !MARKUP_RE.test(file) || TEST_PATH_RE.test(file) || !line.startsWith('-') || line.startsWith('---')) continue;
    const cleanLine = stripMarkupComments(line.slice(1));
    for (const a of cleanLine.matchAll(ATTR_RE)) {
      const name = a[1].toLowerCase();
      // an empty value (cmdk-root="") is the attribute alone
      const raw = a[2] != null ? a[2] : a[3] != null ? a[3] : (a[4] != null && !a[5] ? a[4] : null);
      const value = raw === '' ? null : raw;
      const prefix = a[4] != null && a[5] && a[4] !== '' ? a[4] : null;
      if ((value != null && value.length < 2) || (prefix != null && prefix.length < 2)) continue; // too short to search
      const key = `${name}=${value != null ? value : prefix != null ? `${prefix}*` : ''}`;
      if (!out.has(key)) out.set(key, { name, value, prefix, file });
    }
    for (const a of cleanLine.matchAll(ARIA_RE)) {
      const value = a[1] != null ? a[1] : a[2] != null ? a[2] : null;
      const i18nKey = a[3] || null;
      const key = `aria-label=${value != null ? value : `t:${i18nKey}`}`;
      if (!out.has(key)) out.set(key, { name: 'aria-label', value, prefix: null, i18nKey, file });
    }
  }
  return [...out.values()];
}

function lookupLocaleKey(doc, key) {
  if (!doc || !key) return null;
  if (typeof doc[key] === 'string') return doc[key]; // flat keys ("nav.primary": "…")
  let cur = doc;
  for (const part of String(key).split(/[.:]/)) { if (!cur || typeof cur !== 'object') return null; cur = cur[part]; }
  return typeof cur === 'string' ? cur : null;
}

/** The text of a dotted i18n key in a locale JSON file at `ref` ({ nav: { primary: "Primary navigation" } }). */
function localeText(root, ref, localeFile, key) {
  if (!localeFile || !key) return null;
  let doc = null;
  try { doc = JSON.parse(git(root, ['show', `${ref}:${String(localeFile).replace(/\\/g, '/')}`]) || 'null'); } catch { doc = null; }
  return lookupLocaleKey(doc, key);
}

/** An accessible name removed from markup and gone from the product, still read by tests by its TEXT. */
function ariaFinding(root, sha, h, options, parent) {
  // cross-review 15/11: a key removed from the locale in the same commit still has its text in the parent
  const text = h.value != null ? h.value : (localeText(root, sha, options.locale, h.i18nKey) || (parent ? localeText(root, parent, options.locale, h.i18nKey) : null));
  if (!text || text.length < 3) return null;
  // kept: the key still used in code (i18n), or the name still in markup (also when a key became the literal)
  const inMarkup = () => grepAll(root, sha, [text]).filter((l) => { const f = l.split(':')[0]; return MARKUP_RE.test(f) && !TEST_PATH_RE.test(f); });
  const kept = h.i18nKey
    ? [...grepAll(root, sha, [h.i18nKey]).filter((l) => { const f = l.split(':')[0]; return !TEST_PATH_RE.test(f) && !NON_DOM_RE.test(f) && !/\.json$/i.test(f); }), ...inMarkup()]
    : inMarkup();
  if (kept.length) return null;
  // only lines that READ an accessible name (getByRole / getByLabel / name: / aria-label…): a common word ("Search",
  // "Close") in a describe() or a comment is not a reader
  const readers = grepAll(root, sha, [text]).filter((l) => TEST_PATH_RE.test(l.split(':')[0]) && ARIA_READER_RE.test(l));
  if (!readers.length) return null;
  return { hook: `aria-label="${text}"${h.i18nKey ? ` (${h.i18nKey})` : ''}`, removed_in: h.file, readers: readers.slice(0, 12).map((l) => l.slice(0, 200)), readers_total: readers.length };
}

/** Lines of the tree at `ref` that contain every needle outside single-line comments, as "file:line: text". */
function grepAll(root, ref, needles) {
  // git grep -e A -e B matches EITHER: the lines holding ALL needles are kept afterwards
  const args = ['grep', '-n', '-I', '-F'];
  for (const n of needles) args.push('-e', n);
  const raw = git(root, [...args, ref]);
  const prefix = `${ref}:`;
  return raw.split(/\r?\n/).filter(Boolean).map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
    .filter((l) => {
      const m = /^(.+?):(\d+):(.*)$/.exec(l);
      const body = stripMarkupComments(m ? m[3] : l);
      return needles.every((n) => body.includes(n));
    });
}

/**
 * For the commit `sha` (against `parent`): the removed hooks gone from the product tree and still read by tests.
 * @returns {{ hook: string, removed_in: string, readers: string[] }[]}
 */
function hooksStillRead(root, parent, sha, options = {}) {
  const diff = git(root, ['diff', '--unified=0', '--no-color', parent, sha, '--', ...(options.paths || [])]);
  const hooks = removedHooks(diff);
  if (!hooks.length) return [];
  const findings = [];
  for (const h of hooks) {
    if (h.name === 'aria-label') { const f = ariaFinding(root, sha, h, options, parent); if (f) findings.push(f); continue; }
    const token = h.value != null ? h.value : h.prefix;
    const productNeedles = token != null ? [token] : [h.name];
    // still in the product (another component keeps it): not removed
    // conservative: the token anywhere in a non-test file (a markup attribute, an id list that builds it) counts as kept
    // cross-review 15/11: a leftover CSS rule ([cmdk-root] {…}), a doc, a lockfile never RENDER the hook — they do not
    // keep it in the product
    const inProduct = grepAll(root, sha, productNeedles).filter((l) => { const f = l.split(':')[0]; return !TEST_PATH_RE.test(f) && !NON_DOM_RE.test(f); });
    if (inProduct.length) continue;
    const readerNeedles = h.name === 'data-testid' && token != null ? [token] : token != null ? [h.name, token] : [h.name];
    let readers = grepAll(root, sha, readerNeedles).filter((l) => TEST_PATH_RE.test(l.split(':')[0]));
    if (h.name === 'data-testid' && token != null) readers = readers.filter((l) => TESTID_READER_RE.test(l));
    if (!readers.length) continue;
    findings.push({ hook: `${h.name}${token != null ? `=${token}${h.prefix != null ? '…' : ''}` : ''}`, removed_in: h.file, readers: readers.slice(0, 12).map((l) => l.slice(0, 200)), readers_total: readers.length });
  }
  return findings;
}

function extractHooksFromText(text, file, out = new Map()) {
  const src = stripMarkupComments(text);
  for (const a of src.matchAll(ATTR_RE)) {
    const name = a[1].toLowerCase();
    const raw = a[2] != null ? a[2] : a[3] != null ? a[3] : (a[4] != null && !a[5] ? a[4] : null);
    const value = raw === '' ? null : raw;
    const prefix = a[4] != null && a[5] && a[4] !== '' ? a[4] : null;
    if ((value != null && (value.length < 2 || /[\r\n]/.test(value))) || (prefix != null && (prefix.length < 2 || /[\r\n]/.test(prefix)))) continue;
    const key = `${name}=${value != null ? value : prefix != null ? `${prefix}*` : ''}`;
    const prev = out.get(key);
    if (!prev) out.set(key, { name, value, prefix, file, files: [file] });
    else if (!prev.files.includes(file)) prev.files.push(file);
  }
  for (const a of src.matchAll(ARIA_RE)) {
    const value = a[1] != null ? a[1] : a[2] != null ? a[2] : null;
    if (value != null && /[\r\n]/.test(value)) continue;
    const i18nKey = a[3] || null;
    const key = `aria-label=${value != null ? value : `t:${i18nKey}`}`;
    const prev = out.get(key);
    if (!prev) out.set(key, { name: 'aria-label', value, prefix: null, i18nKey, file, files: [file] });
    else if (!prev.files.includes(file)) prev.files.push(file);
  }
  return out;
}

/**
 * Shift-left pre-prompt check: DOM and accessible-name hooks currently present in the task's markup files that are
 * actively read by test/e2e files at `ref` (default HEAD). Zero git calls when `files` has no markup files.
 */
function hooksReadInFiles(root, files, options = {}) {
  if (!root || !Array.isArray(files) || !files.length) return [];
  const markupEntries = [];
  const seenPaths = new Set();
  for (const item of files) {
    const rawPath = typeof item === 'string' ? item : item && item.path;
    const rel = String(rawPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!rel || seenPaths.has(rel) || !MARKUP_RE.test(rel) || TEST_PATH_RE.test(rel)) continue;
    seenPaths.add(rel);
    markupEntries.push({
      rel,
      content: item && typeof item === 'object' && typeof item.content === 'string' ? item.content : null,
      exists: item && typeof item === 'object' ? item.exists : undefined,
    });
  }
  if (!markupEntries.length || !fs.existsSync(path.join(root, '.git'))) return [];

  const candidates = new Map();
  for (const entry of markupEntries) {
    if (entry.exists === false) continue;
    let content = entry.content;
    if (content == null) {
      const abs = path.resolve(root, entry.rel);
      const relCheck = path.relative(root, abs);
      if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) continue;
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > 512 * 1024) continue;
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
    }
    extractHooksFromText(content, entry.rel, candidates);
  }
  if (!candidates.size) return [];

  const ref = options.ref || 'HEAD';
  let localeDocLoaded = false;
  let localeDoc = null;
  const resolveI18n = (i18nKey) => {
    if (!options.locale || !i18nKey) return null;
    if (!localeDocLoaded) {
      localeDocLoaded = true;
      try {
        const absLoc = path.resolve(root, options.locale);
        const rawLoc = fs.existsSync(absLoc) ? fs.readFileSync(absLoc, 'utf8') : git(root, ['show', `${ref}:${String(options.locale).replace(/\\/g, '/')}`]);
        localeDoc = JSON.parse(rawLoc || 'null');
      } catch {
        localeDoc = null;
      }
    }
    return lookupLocaleKey(localeDoc, i18nKey);
  };

  const prepared = [];
  const needleSet = new Set();
  for (const h of candidates.values()) {
    if (h.name === 'aria-label') {
      const text = h.value != null ? h.value : resolveI18n(h.i18nKey);
      if (!text || text.length < 3) continue;
      needleSet.add(text);
      prepared.push({ ...h, ariaText: text });
    } else {
      const token = h.value != null ? h.value : h.prefix;
      needleSet.add(token != null ? token : h.name);
      prepared.push({ ...h, token });
    }
  }
  if (!prepared.length || !needleSet.size) return [];

  const allNeedles = [...needleSet];
  const testLines = [];
  const seenLine = new Set();
  const prefix = `${ref}:`;
  for (let i = 0; i < allNeedles.length; i += 80) {
    const chunk = allNeedles.slice(i, i + 80);
    const args = ['grep', '-n', '-I', '-F'];
    for (const n of chunk) args.push('-e', n);
    args.push(ref);
    for (const rawLine of git(root, args).split(/\r?\n/)) {
      if (!rawLine) continue;
      const stripped = rawLine.startsWith(prefix) ? rawLine.slice(prefix.length) : rawLine;
      if (seenLine.has(stripped)) continue;
      const m = /^(.+?):(\d+):(.*)$/.exec(stripped);
      if (!m || !TEST_PATH_RE.test(m[1])) continue;
      const cleanBody = stripMarkupComments(m[3]);
      if (!cleanBody.trim()) continue;
      seenLine.add(stripped);
      testLines.push({ file: m[1], line: stripped, body: cleanBody });
    }
  }
  if (!testLines.length) return [];

  const findings = [];
  for (const h of prepared) {
    if (h.name === 'aria-label') {
      const readers = testLines.filter((t) => t.body.includes(h.ariaText) && ARIA_READER_RE.test(t.body));
      if (!readers.length) continue;
      findings.push({
        hook: `aria-label="${h.ariaText}"${h.i18nKey ? ` (${h.i18nKey})` : ''}`,
        file: h.file,
        files: h.files,
        readers: readers.slice(0, 12).map((t) => t.line.slice(0, 200)),
        readers_total: readers.length,
      });
      continue;
    }
    const reqNeedles = h.name === 'data-testid' && h.token != null ? [h.token] : h.token != null ? [h.name, h.token] : [h.name];
    let readers = testLines.filter((t) => reqNeedles.every((n) => t.body.includes(n)));
    if (h.name === 'data-testid' && h.token != null) readers = readers.filter((t) => TESTID_READER_RE.test(t.body));
    if (!readers.length) continue;
    findings.push({
      hook: `${h.name}${h.token != null ? `=${h.token}${h.prefix != null ? '…' : ''}` : ''}`,
      file: h.file,
      files: h.files,
      readers: readers.slice(0, 12).map((t) => t.line.slice(0, 200)),
      readers_total: readers.length,
    });
  }
  return findings;
}

function activeHooksLesson(root, files, options = {}) {
  const found = hooksReadInFiles(root, files, options);
  if (!found.length) return null;
  const shown = found.slice(0, 12).map((f) => `${f.hook} (${f.files && f.files.length > 1 ? f.files.slice(0, 2).join(', ') : f.file})`).join(', ');
  const more = found.length > 12 ? ` e +${found.length - 12}` : '';
  return `Contratos de DOM/acessibilidade nos arquivos desta tarefa lidos por testes (${found.length}): ${shown}${more} — preserve esses atributos/nomes na marcação (o checkpoint recusa a remoção de um atributo/nome que um teste ainda lê; se a remoção for intencional, ajuste o teste no escopo da tarefa)`;
}

function message(findings) {
  return findings.map((f) => `${f.hook} (removido de ${f.removed_in}) ainda é lido por ${f.readers_total} linha(s) de teste — ${f.readers.slice(0, 3).map((r) => r.split(':').slice(0, 2).join(':')).join(', ')}${f.readers_total > 3 ? ', …' : ''}`).join('; ');
}

/**
 * OxeSpace 15/11 (Celular F3, #856): tasks wrote strings straight into a GENERATED file (strings.xml, generated from
 * shared/locales/*\/mobile.json); the generator's test failed first in the PR. Config `generated_files`:
 * [{ file, source, test? }] (globs). A commit that changes a generated file without changing any of its sources is
 * refused — the edit goes in the source, then the generator runs.
 */
function globRe(glob) {
  const g = String(glob).replace(/\\/g, '/');
  // `**/` keeps the directory boundary (mobile/android/**/strings.xml never matches not-strings.xml)
  return new RegExp(`^${g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.+/)?').replace(/\u0000/g, '.*')}$`);
}

/**
 * @param {string[]} changedPaths the paths the commit really changed
 * @param {object[]} rules config generated_files
 * @param {{ scope?: string[], regenerated?: (rule) => boolean }} [options] scope: the task's files (a source outside
 *   them → scope_insufficient); regenerated(rule): the source changed AFTER the last generation (an earlier task's
 *   edit) — then this commit regenerating the file is legitimate
 */
function generatedEdits(changedPaths, rules, options = {}) {
  const changed = (changedPaths || []).map((p) => String(p).replace(/\\/g, '/'));
  const scope = Array.isArray(options.scope) ? options.scope.map((p) => String(p).replace(/\\/g, '/')) : null;
  const out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || !r.file || !r.source) continue;
    const sources = Array.isArray(r.source) ? r.source : [r.source];
    const fileRes = (Array.isArray(r.file) ? r.file : [r.file]).map(globRe);
    const srcRes = sources.map(globRe);
    const edited = changed.filter((p) => fileRes.some((re) => re.test(p)));
    if (!edited.length) continue;
    if (changed.some((p) => srcRes.some((re) => re.test(p)))) continue; // the source changed too: the generator ran
    if (typeof options.regenerated === 'function' && options.regenerated(r)) continue;
    // a source the task cannot touch (outside its files): a plan matter, not something a retry can fix
    // a directory in the task files ("shared/locales/") covers the sources under it
    const outside = scope ? !sources.some((s) => scope.some((p) => p === s || globRe(s).test(p) || globRe(p).test(String(s).replace(/\*.*$/, 'x')) || String(s).startsWith(`${p.replace(/\/+$/, '')}/`))) : false;
    out.push({ files: edited, source: sources, test: r.test || null, generator: r.generator || null, source_outside_scope: outside });
  }
  return out;
}

function generatedMessage(found) {
  return found.map((g) => `${g.files.join(', ')} é gerado de ${g.source.join(', ')}: edite a fonte e rode o gerador${g.generator ? ` (${g.generator})` : ''}${g.test ? `; o teste ${g.test} compara a saída com o arquivo commitado` : ''}`).join('; ');
}

// ── G14 / G48 (OXB-C1 Adendo 2, OQ T13 / OXE-223): CSS classes guard ──────────────────────────────────────────────

const CSS_FILE_RE = /\.(?:css|scss|sass|less)$/i;
const CSS_CLASS_SELECTOR_RE = /(?<![\w-])\.([a-zA-Z_-][a-zA-Z0-9_-]{2,})(?![\w-])/g;
const PRODUCT_CLASS_READER_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|astro)$/i;

function extractCssClassesFromLine(lineText) {
  const cleaned = stripMarkupComments(lineText)
    .replace(/url\([^)]*\)/gi, ' ')
    .replace(/@import\s+[^;]+;?/gi, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
  const out = [];
  for (const m of cleaned.matchAll(CSS_CLASS_SELECTOR_RE)) {
    const cls = m[1];
    // Ignore numeric-like decimals or CSS file extensions if any slipped past string stripping
    if (/^\d/.test(cls) || /^(?:css|scss|less|svg|png|woff2?|ttf)$/i.test(cls)) continue;
    out.push(cls);
  }
  return out;
}

/**
 * Extracts CSS class names removed (`-`) vs added (`+`) in a unified diff of `.css`/`.scss` files.
 */
function removedCssClasses(diffText) {
  const removed = new Map();
  const addedInSameFile = new Set();
  let file = null;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line === '--- /dev/null') { file = null; continue; }
    const hdr = /^(?:\+\+\+ b\/|--- a\/)(.+)$/.exec(line) || /^(?:\+\+\+ "b\/|--- "a\/)(.+)"$/.exec(line);
    if (hdr) {
      if (line.startsWith('---')) file = unquoteGitPath(line.startsWith('--- "') ? `"${hdr[1]}"` : hdr[1]);
      continue;
    }
    if (!file || !CSS_FILE_RE.test(file) || TEST_PATH_RE.test(file)) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      for (const cls of extractCssClassesFromLine(line.slice(1))) {
        addedInSameFile.add(`${file}::${cls}`);
      }
      continue;
    }
    if (!line.startsWith('-') || line.startsWith('---')) continue;
    for (const cls of extractCssClassesFromLine(line.slice(1))) {
      const key = `${file}::${cls}`;
      if (!removed.has(key)) removed.set(key, { className: cls, file });
    }
  }
  return [...removed.entries()]
    .filter(([key]) => !addedInSameFile.has(key))
    .map(([, v]) => v);
}

function isCssClassDefinedInTree(root, ref, className) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selRe = new RegExp(`(?<![\\w-])\\.${esc}(?![\\w-])`);
  if (ref) {
    const raw = git(root, ['grep', '-n', '-I', '-F', `-e`, `.${className}`, ref]);
    const prefix = `${ref}:`;
    for (const l of raw.split(/\r?\n/)) {
      if (!l) continue;
      const stripped = l.startsWith(prefix) ? l.slice(prefix.length) : l;
      const m = /^(.+?):(\d+):(.*)$/.exec(stripped);
      if (!m || !CSS_FILE_RE.test(m[1]) || TEST_PATH_RE.test(m[1])) continue;
      if (extractCssClassesFromLine(m[3]).includes(className) && selRe.test(stripMarkupComments(m[3]))) return true;
    }
    return false;
  }
  // Working-tree scan via git grep (untracked/dirty tracked CSS files on disk)
  const raw = git(root, ['grep', '-n', '-I', '-F', '-e', `.${className}`]);
  for (const l of raw.split(/\r?\n/)) {
    if (!l) continue;
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    if (!m || !CSS_FILE_RE.test(m[1]) || TEST_PATH_RE.test(m[1])) continue;
    if (extractCssClassesFromLine(m[3]).includes(className) && selRe.test(stripMarkupComments(m[3]))) return true;
  }
  return false;
}

function findProductReadersOfCssClass(root, ref, className) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = new RegExp(`(?<![\\w/.$-])${esc}(?![\\w-])`);
  const args = ref ? ['grep', '-n', '-I', '-F', '-e', className, ref] : ['grep', '-n', '-I', '-F', '-e', className];
  const raw = git(root, args);
  const prefix = ref ? `${ref}:` : '';
  const readers = [];
  for (const l of raw.split(/\r?\n/)) {
    if (!l) continue;
    const stripped = prefix && l.startsWith(prefix) ? l.slice(prefix.length) : l;
    const m = /^(.+?):(\d+):(.*)$/.exec(stripped);
    if (!m) continue;
    const file = m[1];
    if (!PRODUCT_CLASS_READER_RE.test(file) || TEST_PATH_RE.test(file) || NON_DOM_RE.test(file) || CSS_FILE_RE.test(file)) continue;
    const cleanBody = stripMarkupComments(m[3]);
    if (!tokenRe.test(cleanBody)) continue;
    // Ignore import paths (`from './oq-primary'`)
    if (/^\s*(?:import|export)\b.*\bfrom\s+['"]/.test(cleanBody) && !/className|class\s*=/.test(cleanBody)) continue;
    readers.push(`${file}:${m[2]}: ${cleanBody.trim().slice(0, 160)}`);
  }
  return readers;
}

/**
 * Checkpoint check (commit `sha` vs `parent`): CSS classes removed from `.css`/`.scss` files that are no longer
 * defined anywhere in the stylesheet tree, yet still referenced in product code (`src/`, `electron/`, etc.).
 */
function orphanCssClasses(root, parent, sha, options = {}) {
  const diff = git(root, ['diff', '--unified=0', '--no-color', parent, sha, '--', ...(options.paths || [])]);
  const removed = removedCssClasses(diff);
  if (!removed.length) return [];
  const seen = new Set();
  const findings = [];
  for (const r of removed) {
    if (seen.has(r.className)) continue;
    seen.add(r.className);
    if (isCssClassDefinedInTree(root, sha, r.className)) continue;
    const readers = findProductReadersOfCssClass(root, sha, r.className);
    if (!readers.length) continue;
    findings.push({
      hook: `.${r.className}`,
      className: r.className,
      removed_in: r.file,
      readers: readers.slice(0, 12),
      readers_total: readers.length,
    });
  }
  return findings;
}

/**
 * Working-tree pre-commit check (for `runtime commit-task` and attempt verify): checks uncommitted `.css`/`.scss` diffs against HEAD.
 */
function orphanCssClassesInWorkingTree(root, changedPaths = []) {
  const cssChanged = (changedPaths || []).map((p) => String(p || '').replace(/\\/g, '/')).filter((p) => CSS_FILE_RE.test(p));
  if (!cssChanged.length) return [];
  const diff = git(root, ['diff', '--unified=0', '--no-color', 'HEAD', '--', ...cssChanged]);
  const removed = removedCssClasses(diff);
  if (!removed.length) return [];
  const seen = new Set();
  const findings = [];
  for (const r of removed) {
    if (seen.has(r.className)) continue;
    seen.add(r.className);
    if (isCssClassDefinedInTree(root, null, r.className)) continue;
    const readers = findProductReadersOfCssClass(root, null, r.className);
    if (!readers.length) continue;
    findings.push({
      hook: `.${r.className}`,
      className: r.className,
      removed_in: r.file,
      readers: readers.slice(0, 12),
      readers_total: readers.length,
    });
  }
  return findings;
}

/**
 * Discovers any repo CSS-classes guard suite (e.g. `tests/unit/css-classes-guard.test.ts`).
 */
function findCssGuardTests(root) {
  const raw = git(root, ['ls-files']);
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\\/g, '/'))
    .filter((f) => TEST_PATH_RE.test(f) && /css[-_.]?class.*guard|class[-_.]?guard.*css/i.test(f));
}

/**
 * G48 (`plan lint`): warns when a pending task deletes a `.css`/`.scss` file or explicitly states removing `.class-name`
 * while product files outside `task.files` still reference that class.
 */
function lintPlanCssRemovals(root, planDoc) {
  if (!planDoc || !Array.isArray(planDoc.tasks) || !fs.existsSync(path.join(root, '.git'))) return [];
  const findings = [];
  for (const task of planDoc.tasks) {
    if (!task || task.done === true || task.superseded || task.status === 'superseded' || task.merged_into) continue;
    const taskScope = new Set((task.files || []).map((f) => String(typeof f === 'string' ? f : f.path).replace(/\\/g, '/')));
    const removedCssFiles = (task.removed_paths || [])
      .map((f) => String(f || '').replace(/\\/g, '/'))
      .filter((f) => CSS_FILE_RE.test(f));
    const candidateClasses = new Map();
    for (const cssFile of removedCssFiles) {
      let txt = null;
      try { txt = fs.readFileSync(path.join(root, cssFile), 'utf8'); } catch { txt = null; }
      if (!txt) continue;
      for (const line of txt.split(/\r?\n/)) {
        for (const cls of extractCssClassesFromLine(line)) {
          if (!candidateClasses.has(cls)) candidateClasses.set(cls, cssFile);
        }
      }
    }
    const prose = `${task.title || ''}\n${task.notes || ''}`;
    const hasRemoveVerb = /\b(?:remov\w*|tir\w*|exclu\w*|apag\w*|drop\w*|delet\w*|retir\w*)\b/i.test(prose);
    if (hasRemoveVerb) {
      const taskCss = [...taskScope].filter((f) => CSS_FILE_RE.test(f));
      for (const m of prose.matchAll(/(?<![\w/-])\.([a-zA-Z_-][a-zA-Z0-9_-]{2,})(?![\w.-])/g)) {
        const cls = m[1];
        if (!/^(?:ts|tsx|js|jsx|css|scss|mjs|cjs|json|md)$/i.test(cls) && !candidateClasses.has(cls)) {
          candidateClasses.set(cls, taskCss[0] || 'CSS');
        }
      }
    }
    for (const [cls, fromCss] of candidateClasses) {
      const readers = findProductReadersOfCssClass(root, null, cls);
      const outOfScopeReaders = readers.filter((r) => !taskScope.has(r.split(':')[0]));
      if (outOfScopeReaders.length) {
        findings.push({
          task: task.id,
          className: cls,
          from: fromCss,
          readers: outOfScopeReaders.slice(0, 8),
          readers_total: outOfScopeReaders.length,
        });
      }
    }
  }
  return findings;
}

function cssRemovalLintMessages(findings, options = {}) {
  const level = options.level === 'error' ? 'error' : 'warn';
  const msgs = (findings || []).map((f) => {
    const files = [...new Set(f.readers.map((r) => r.split(':').slice(0, 2).join(':')))].slice(0, 4).join(', ');
    return `${f.task}: [G48] classe CSS \`.${f.className}\` (${f.from}) ainda tem ${f.readers_total} uso(s) fora de ${f.task}.files (${files}) — inclua os consumidores no escopo para migrar a classe ou mantenha a regra CSS`;
  });
  return { errors: level === 'error' ? msgs : [], warnings: level === 'error' ? [] : msgs };
}

module.exports = {
  removedHooks,
  hooksStillRead,
  hooksReadInFiles,
  activeHooksLesson,
  message,
  localeText,
  globRe,
  generatedEdits,
  generatedMessage,
  removedCssClasses,
  orphanCssClasses,
  orphanCssClassesInWorkingTree,
  findCssGuardTests,
  lintPlanCssRemovals,
  cssRemovalLintMessages,
  MARKUP_RE,
  CSS_FILE_RE,
  TEST_PATH_RE,
  stripMarkupComments,
};
