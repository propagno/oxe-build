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
const RUNNER_RE = /(^|\/)scripts\/(?:test-[^/]+|remote-verify)\.[cm]?[jt]s$/i;
const PATH_TOKEN_RE = /[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]{1,5}\b/g;
const PASCAL_TOKEN_RE = /(?<![/@.\w])[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const SENTENCE_SPLIT_RE = /(?<!\b(?:e\.g|i\.e|p\.ex|ex|etc|vs|cf)\.)(?<=[.;!?])\s+|\r?\n/i;
// R51 + G44-fp (1): scope-boundary sentences and "use/reuse these primitives/components" lists are read-only / excluded
const NOT_IN_SCOPE = /\b(?:n[aã]o\s+(?:tocar|alterar|mexer|editar|mudar|incluir)|sem\s+(?:tocar|alterar|mexer|editar)|fora\s+d[eo]\s+escopo|do\s+not\s+(?:touch|edit|modify|change)|don'?t\s+(?:touch|edit|modify|change)|out\s+of\s+scope|leave\s+(?:\S+\s+)?(?:as\s+is|untouched))\b/i;
const USE_COMPONENTS = /\b(?:primitives\s+only|(?:use|uses|using|reuse|reuses|reusing|usar|usando|reusar|reutilizar)\b[^.;!?\n]*\b(?:primitives?|primitivas?|components?|componentes?)|(?:primitives?|primitivas?|components?|componentes?)\b[^.;!?\n]*\b(?:only|apenas|somente)|a\s+partir\s+d[eao]s?|from\b[^.;!?\n]*\b(?:primitives?|primitivas?))\b/i;
// G44-fp (2): reference clauses ("names are the … of X", "never a … name of Y", "generated ones of", "conforme", "ver", "see", "per", "according to") count as reads
const REF_CLAUSE_RE = /(?:\b(?:names?\s+(?:are|is)\s+the\b[^;!?\n]*?\bof|never\s+an?\b[^;!?\n]*?\bnames?\s+of|generated\s+ones?\s+of|according\s+to|conforme|vide)\b|(?:^|[\s(,;:])(?:ver|veja|see|per)\b)\s+([^;!?\n]+?)(?=,?\s+\b(?:ajustar|alterar|mudar|criar|adicionar|editar|update|change|modify|add|create|edit)\b|$)/gi;
// G44-fp (4): in a frozen test header, a cited module/component only counts when the header sentence states a change
const CHANGE_VERB_RE = /\b(?:muda\w*|altera\w*|adiciona\w*|cria\w*|passa\s+a\b|nov[oa]s?|chang(?:e|es|ed|ing)|add(?:s|ed|ing)?|creat(?:e|es|ed|ing)|new|now)\b/i;
const norm = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');
// Web / JS builtins with two humps a repo may shim (ResizeObserver.ts) and the prose names as the platform type
const BUILTINS = new Set(['ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'PerformanceObserver', 'AbortController', 'AbortSignal', 'EventEmitter', 'EventTarget', 'FormData', 'WebSocket', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'TextEncoder', 'TextDecoder', 'ReadableStream', 'WritableStream', 'TransformStream', 'BroadcastChannel', 'MessageChannel', 'MessagePort', 'SharedWorker', 'WeakMap', 'WeakSet', 'WeakRef', 'ArrayBuffer', 'DataView', 'BigInt', 'TypeScript', 'JavaScript', 'GitHub', 'GitLab', 'PowerShell']);

/** The leading comment block and the describe/test titles of a test file (what the planner wrote about it). */
function testHeader(text) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/);
  const head = [];
  let inBlock = false;
  let inImport = false;
  for (const l of lines) {
    // R51: a block comment spans lines without a leading "*"; a multi-line import is skipped as a whole
    if (inBlock) { head.push(l); if (/\*\//.test(l)) inBlock = false; continue; }
    if (inImport) { if (/\bfrom\s*['"]|['"]\s*\)?\s*;?\s*$/.test(l)) inImport = false; continue; }
    if (/^\s*\/\*/.test(l)) { head.push(l); if (!/\*\//.test(l)) inBlock = true; continue; }
    if (/^\s*(\/\/|\*|#)/.test(l) || !l.trim()) { head.push(l); continue; }
    if (/^\s*(import|const|let|var|require|from|package|using)\b/.test(l)) { if (/^\s*import\b/.test(l) && !/\bfrom\b|^\s*import\s*['"]/.test(l)) inImport = true; continue; }
    break;
  }
  // a title may hold the other quote ("ChangesPanel's skeleton") and escapes (R51)
  const titles = [...src.matchAll(/\b(?:describe|test|it)(?:\.\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\]){2,200})\1/g)].map((m) => m[2]);
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
  const accept = planDoc && Array.isArray(planDoc.acceptance_tests) ? planDoc.acceptance_tests : planDoc && Array.isArray(planDoc.acceptanceTests) ? planDoc.acceptanceTests : [];
  const out = [];
  for (const t of pending) {
    const scope = scopeOf(t);
    const inScope = (f) => scope.some((s) => testScope.covers(s, f));
    const entries = accept.filter((a) => a && (a.task === t.id || (!a.task && (t.acceptance || []).includes(a.criterion))));
    const frozen = entries.flatMap((a) => (a.files || []).map(norm)).filter(Boolean);
    // R51: a frozen test bound only by criterion is shared by the criterion's tasks — a file another of them already
    // owns is not this task's gap
    const siblingScopes = new Map();
    for (const a of entries.filter((x) => !x.task)) {
      for (const f of (a.files || []).map(norm)) {
        // R52: a sibling already done still owns its files (a plan lint mid-phase), and two entries may share a file
        const sibs = all.filter((o) => o.id !== t.id && !o.superseded && !o.merged_into && (o.acceptance || []).includes(a.criterion)).flatMap((o) => scopeOf(o));
        siblingScopes.set(f, [...(siblingScopes.get(f) || []), ...sibs]);
      }
    }
    const ownFiles = (t.files || []).map(norm).filter(Boolean);
    // G44-fp (1): PascalCase resolves only within the task's platform tree (1st path segment); root files or empty files stay unrestricted
    const platformRoots = ownFiles.length && ownFiles.every((f) => f.includes('/'))
      ? new Set(ownFiles.map((f) => f.split('/')[0]))
      : null;
    const resolvePascal = (ident) => {
      if (BUILTINS.has(ident)) return null;
      const list = (byBase.get(ident) || []).filter((f) => !platformRoots || (f.includes('/') && platformRoots.has(f.split('/')[0])));
      return list.length === 1 ? list[0] : null;
    };
    const extractRefs = (fragment) => {
      const refs = [];
      for (const m of String(fragment || '').matchAll(PATH_TOKEN_RE)) {
        const p = norm(m[0]);
        if (trackedSet.has(p)) refs.push({ file: p, cited: m[0] });
      }
      for (const m of String(fragment || '').matchAll(PASCAL_TOKEN_RE)) {
        const file = resolvePascal(m[0]);
        if (file) refs.push({ file, cited: m[0] });
      }
      return refs;
    };
    // G44-fp (3): files invoked by the task's verify / acceptance test commands (and scripts/test-*.mjs) never count
    const verifyCmds = [
      ...(typeof t.verify === 'string' ? [t.verify] : Array.isArray(t.verify) ? t.verify : t.verify ? [t.verify.command, ...(t.verify.commands || [])] : []),
      t.verifyCommand,
      ...entries.map((a) => a && a.command),
    ].filter(Boolean).join('\n');
    const implicitReads = new Set();
    for (const m of verifyCmds.matchAll(PATH_TOKEN_RE)) {
      const p = norm(m[0]);
      if (trackedSet.has(p)) implicitReads.add(p);
    }
    const prepareText = (rawText, requireChangeVerb) => {
      const sentences = String(rawText || '').split(SENTENCE_SPLIT_RE);
      const kept = [];
      for (const s of sentences) {
        if (!s.trim() || NOT_IN_SCOPE.test(s) || USE_COMPONENTS.test(s)) continue;
        const clean = s.replace(/[.;!?]+\s*$/, '');
        for (const rm of clean.matchAll(REF_CLAUSE_RE)) {
          for (const r of extractRefs(rm[1])) implicitReads.add(r.file);
        }
        if (requireChangeVerb && !CHANGE_VERB_RE.test(s)) continue;
        kept.push(s);
      }
      return kept.join('\n');
    };
    const notesText = [t.title, Array.isArray(t.notes) ? t.notes.join('\n') : t.notes, t.description].filter(Boolean).join('\n');
    const sources = [
      { where: 'title/notes', text: prepareText(notesText, false), isFrozenHeader: false },
      ...frozen.map((f) => ({ where: f, text: prepareText(testHeader(read(f)), true), siblings: siblingScopes.get(f) || [], isFrozenHeader: true })),
    ];
    const seen = new Set();
    for (const src of sources) {
      if (!src.text) continue;
      const hits = extractRefs(src.text);
      for (const h of hits) {
        if (frozen.includes(h.file) || TEST_RE.test(h.file) || RUNNER_RE.test(h.file) || implicitReads.has(h.file) || inScope(h.file) || seen.has(h.file)) continue;
        if (src.isFrozenHeader && /\.md$/i.test(h.file)) continue;
        if ((src.siblings || []).some((s) => testScope.covers(s, h.file))) continue;
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
