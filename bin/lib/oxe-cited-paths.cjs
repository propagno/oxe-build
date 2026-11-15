'use strict';

/**
 * G44 (OxeSpace 15/11, OxeCode F6 T34, ~US$ 20 in 3 attempts): T34's notes named "the ChangesPanel wait" and its
 * frozen brd15 case asserted the skeleton from it, but src/components/Changes/ChangesPanel.tsx was not in the
 * task's files — every attempt stopped at 10 of 11. Per pending task: a repo path, or a PascalCase component /
 * module name that resolves to exactly ONE tracked code file, cited in its title, notes or the header of its frozen
 * tests (leading comments, describe/test titles), and not in its scope (its files, its ancestors', or the files it
 * declares read only: `read_only` / `reads`).
 */

const fs = require('fs');
const path = require('path');

const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|java|swift|py|rs|go|vue|svelte)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');

/** The leading comment block and the describe/test titles of a test file (what the planner wrote about it). */
function testHeader(text) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/);
  const head = [];
  for (const l of lines) {
    if (/^\s*(\/\/|\/\*|\*|#)/.test(l) || !l.trim()) { head.push(l); continue; }
    if (/^\s*(import|const|let|var|require|from|package|using)\b/.test(l)) continue;
    break;
  }
  const titles = [...src.matchAll(/\b(?:describe|test|it)(?:\.\w+)*\s*\(\s*(['"`])([^'"`]{2,200})\1/g)].map((m) => m[2]);
  return [...head, ...titles].join('\n');
}

/**
 * @param {string} root
 * @param {object} planDoc
 * @param {{ files?: string[], readText?: (f: string) => string }} [options]
 * @returns {{ task: string, file: string, cited: string, where: string }[]}
 */
function citedPathGaps(root, planDoc, options = {}) {
  const all = (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : []).filter(Boolean);
  const pending = all.filter((t) => !(t.done === true || t.status === 'done') && !t.superseded && !t.merged_into);
  if (!pending.length) return [];
  const tracked = (options.files || require('./oxe-suite-impact.cjs').trackedFiles(root)).map(norm);
  const trackedSet = new Set(tracked);
  // a component name → its file, only when exactly one code file carries that base name
  const byBase = new Map();
  for (const f of tracked) {
    if (!CODE_RE.test(f) || TEST_RE.test(f)) continue;
    const base = path.posix.basename(f).replace(/\.[^.]+$/, '');
    byBase.set(base, [...(byBase.get(base) || []), f]);
  }
  const read = options.readText || ((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } });
  const testScope = require('./oxe-test-scope.cjs');
  const byId = new Map(all.map((t) => [t.id, t]));
  const scopeOf = (t) => {
    const out = [];
    const seen = new Set();
    const stack = [t.id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const x = byId.get(id);
      if (!x) continue;
      for (const f of [...(x.files || []), ...(id === t.id ? [...(x.read_only || []), ...(x.reads || [])] : [])]) { const p = norm(f); if (p) out.push(p); }
      for (const d of x.depends_on || x.dependsOn || []) stack.push(d);
    }
    return out;
  };
  const accept = planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : [];
  const out = [];
  for (const t of pending) {
    const scope = scopeOf(t);
    const inScope = (f) => scope.some((s) => testScope.covers(s, f));
    const frozen = accept.filter((a) => a && (a.task === t.id || (!a.task && (t.acceptance || []).includes(a.criterion)))).flatMap((a) => (a.files || []).map(norm)).filter(Boolean);
    const sources = [
      { where: 'title/notes', text: [t.title, t.notes, t.description].filter(Boolean).join('\n') },
      ...frozen.map((f) => ({ where: f, text: testHeader(read(f)) })),
    ];
    const seen = new Set();
    for (const src of sources) {
      if (!src.text) continue;
      const hits = [];
      for (const m of src.text.matchAll(/[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]{1,5}\b/g)) { const p = norm(m[0]); if (trackedSet.has(p)) hits.push({ file: p, cited: m[0] }); }
      for (const m of src.text.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g)) {
        const files = byBase.get(m[0]);
        if (files && files.length === 1) hits.push({ file: files[0], cited: m[0] });
      }
      for (const h of hits) {
        if (frozen.includes(h.file) || TEST_RE.test(h.file) || inScope(h.file) || seen.has(h.file)) continue;
        seen.add(h.file);
        out.push({ task: t.id, file: h.file, cited: h.cited, where: src.where });
      }
    }
  }
  return out;
}

function citedPathMessages(found, { level = 'warn' } = {}) {
  const lines = found.map((f) => `${f.task} cita ${f.cited === f.file ? f.file : `${f.cited} (${f.file})`} em ${f.where}, e o arquivo está fora do escopo (files, ancestrais ou read_only) — uma tentativa que precisa mudá-lo para no meio (OxeCode F6 T34: 10 de 11 em 3 tentativas). Inclua-o nos files, ou declare read_only: ["${f.file}"] se a tarefa só o lê [G44]`);
  return level === 'error' ? { errors: lines, warnings: [] } : { errors: [], warnings: lines };
}

module.exports = { citedPathGaps, citedPathMessages, testHeader };
