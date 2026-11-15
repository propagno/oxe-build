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

const { spawnSync } = require('child_process');

const MARKUP_RE = /\.(tsx|jsx|vue|svelte|html?|astro)$/i;
const TEST_PATH_RE = /(^|\/)(e2e|tests?|__tests__|spec|playwright|cypress)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$/i;
const NON_DOM_RE = /\.(css|scss|sass|less|styl|md|mdx|txt|svg|map|lock|ya?ml)$|(^|\/)(docs|\.oxe|\.github)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md)$/i;
// data-* / cmdk-* attributes in markup: name, then an optional static value ("x", 'x', {"x"}, {`x-${…}`} → prefix)
const ATTR_RE = /(?<![\w-])((?:data|cmdk)-[a-z0-9-]+)(?:\s*=\s*(?:"([^"{}]*)"|'([^'{}]*)'|\{\s*["'`]([^"'`$]*)(\$\{)?[^}]*\}))?/gi;
// OxeSpace 15/11 (OxeCode F5 T22): an ACCESSIBLE NAME e2e reads by role + name ("Primary navigation", "Clear search"):
// aria-label="…" static, or aria-label={t('nav.primary')} resolved through the locale file
const ARIA_RE = /(?<![\w-])aria-label\s*=\s*(?:"([^"{}]{3,})"|'([^'{}]{3,})'|\{\s*t\(\s*['"`]([\w.:-]+)['"`][^)]*\)\s*\})/gi;

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** Hooks on removed (`-`) lines of a unified diff of markup files: [{ name, value, prefix, file }]. */
function removedHooks(diffText) {
  const out = new Map();
  let file = null;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line === '--- /dev/null') { file = null; continue; } // an added file: nothing removed from it
    const m = /^\+\+\+ "?b\/(.+?)"?$/.exec(line) || /^--- "?a\/(.+?)"?$/.exec(line);
    if (m) { if (line.startsWith('---')) file = m[1]; continue; }
    if (!file || !MARKUP_RE.test(file) || TEST_PATH_RE.test(file) || !line.startsWith('-') || line.startsWith('---')) continue;
    for (const a of line.slice(1).matchAll(ATTR_RE)) {
      const name = a[1].toLowerCase();
      // an empty value (cmdk-root="") is the attribute alone
      const raw = a[2] != null ? a[2] : a[3] != null ? a[3] : (a[4] != null && !a[5] ? a[4] : null);
      const value = raw === '' ? null : raw;
      const prefix = a[4] != null && a[5] && a[4] !== '' ? a[4] : null;
      if ((value != null && value.length < 2) || (prefix != null && prefix.length < 2)) continue; // too short to search
      const key = `${name}=${value != null ? value : prefix != null ? `${prefix}*` : ''}`;
      if (!out.has(key)) out.set(key, { name, value, prefix, file });
    }
    for (const a of line.slice(1).matchAll(ARIA_RE)) {
      const value = a[1] != null ? a[1] : a[2] != null ? a[2] : null;
      const i18nKey = a[3] || null;
      const key = `aria-label=${value != null ? value : `t:${i18nKey}`}`;
      if (!out.has(key)) out.set(key, { name: 'aria-label', value, prefix: null, i18nKey, file });
    }
  }
  return [...out.values()];
}

/** The text of a dotted i18n key in a locale JSON file at `ref` ({ nav: { primary: "Primary navigation" } }). */
function localeText(root, ref, localeFile, key) {
  if (!localeFile || !key) return null;
  let doc = null;
  try { doc = JSON.parse(git(root, ['show', `${ref}:${String(localeFile).replace(/\\/g, '/')}`]) || 'null'); } catch { doc = null; }
  if (!doc) return null;
  if (typeof doc[key] === 'string') return doc[key]; // flat keys ("nav.primary": "…")
  let cur = doc;
  for (const part of String(key).split(/[.:]/)) { if (!cur || typeof cur !== 'object') return null; cur = cur[part]; }
  return typeof cur === 'string' ? cur : null;
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
  const readers = grepAll(root, sha, [text]).filter((l) => TEST_PATH_RE.test(l.split(':')[0]) && /ByRole|ByLabel|aria-label|AccessibleName|\bname\s*:|toHaveAccessibleName|\btitle\b/i.test(l));
  if (!readers.length) return null;
  return { hook: `aria-label="${text}"${h.i18nKey ? ` (${h.i18nKey})` : ''}`, removed_in: h.file, readers: readers.slice(0, 12).map((l) => l.slice(0, 200)), readers_total: readers.length };
}

/** Lines of the tree at `ref` that contain every needle (git grep -F, all needles on one line), as "file:line: text". */
function grepAll(root, ref, needles) {
  // git grep -e A -e B matches EITHER: the lines holding ALL needles are kept afterwards
  const args = ['grep', '-n', '-I', '-F'];
  for (const n of needles) args.push('-e', n);
  const raw = git(root, [...args, ref]);
  const prefix = `${ref}:`;
  return raw.split(/\r?\n/).filter(Boolean).map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
    .filter((l) => needles.every((n) => l.includes(n)));
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
    if (h.name === 'data-testid' && token != null) readers = readers.filter((l) => /data-testid|getByTestId|testid/i.test(l));
    if (!readers.length) continue;
    findings.push({ hook: `${h.name}${token != null ? `=${token}${h.prefix != null ? '…' : ''}` : ''}`, removed_in: h.file, readers: readers.slice(0, 12).map((l) => l.slice(0, 200)), readers_total: readers.length });
  }
  return findings;
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
    const outside = scope ? !sources.some((s) => scope.some((p) => p === s || globRe(s).test(p) || globRe(p).test(String(s).replace(/\*.*$/, 'x')))) : false;
    out.push({ files: edited, source: sources, test: r.test || null, generator: r.generator || null, source_outside_scope: outside });
  }
  return out;
}

function generatedMessage(found) {
  return found.map((g) => `${g.files.join(', ')} é gerado de ${g.source.join(', ')}: edite a fonte e rode o gerador${g.generator ? ` (${g.generator})` : ''}${g.test ? `; o teste ${g.test} compara a saída com o arquivo commitado` : ''}`).join('; ');
}

module.exports = { removedHooks, hooksStillRead, message, localeText, generatedEdits, generatedMessage, MARKUP_RE, TEST_PATH_RE };
