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
// data-* / cmdk-* attributes in markup: name, then an optional static value ("x", 'x', {"x"}, {`x-${…}`} → prefix)
const ATTR_RE = /(?<![\w-])((?:data|cmdk)-[a-z0-9-]+)(?:\s*=\s*(?:"([^"{}]*)"|'([^'{}]*)'|\{\s*["'`]([^"'`$]*)(\$\{)?[^}]*\}))?/gi;

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** Hooks on removed (`-`) lines of a unified diff of markup files: [{ name, value, prefix, file }]. */
function removedHooks(diffText) {
  const out = new Map();
  let file = null;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line) || /^--- a\/(.+)$/.exec(line);
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
  }
  return [...out.values()];
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
    const token = h.value != null ? h.value : h.prefix;
    const productNeedles = token != null ? [token] : [h.name];
    // still in the product (another component keeps it): not removed
    // conservative: the token anywhere in a non-test file (a markup attribute, an id list that builds it) counts as kept
    const inProduct = grepAll(root, sha, productNeedles).filter((l) => !TEST_PATH_RE.test(l.split(':')[0]));
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

module.exports = { removedHooks, hooksStillRead, message, MARKUP_RE, TEST_PATH_RE };
