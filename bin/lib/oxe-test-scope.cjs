'use strict';

/**
 * OXB-171: what a frozen acceptance test needs from the product — its static relative imports and the literal paths it
 * reads — compared with the task's `files` (and the files of the tasks it depends on). F2's T8 failed 3 attempts on
 * tests/acceptance/f2/r4-removal.test.ts ("its IPC channel groups are gone"): the test imports shared/types/ipc.ts,
 * which was not in T8's files, and 9 more F2 tasks had the same gap with lint green.
 *
 * Static only: relative `import … from` / `import()` / `require()` / `vi.mock()`, `readFileSync|existsSync|
 * readdirSync|statSync|readFile` with a literal, `path.join|resolve(__dirname|process.cwd(), '…')` and
 * `new URL('…', import.meta.url)`. Path aliases (`@/…`) are not resolved.
 */

const fs = require('fs');
const path = require('path');

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.oxe)(\/|$)/;
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/** The tests' own tree of a test file: up to its tests/test/__tests__/spec/e2e dir, else its dir. */
function testRoot(file) {
  const parts = norm(file).split('/');
  const i = parts.slice(0, -1).findIndex((p) => /^(tests?|__tests__|specs?|e2e)$/i.test(p));
  return i >= 0 ? parts.slice(0, i + 1).join('/') : parts.slice(0, -1).join('/');
}

/** The paths node/TS would try for a specifier: the file, extensions, `.js`→`.ts`, then dir/index.*. */
function importCandidates(rel) {
  const stripped = rel.replace(/\.(js|jsx|mjs|cjs)$/, '');
  return [rel, ...EXTS.map((e) => rel + e), ...(stripped !== rel ? EXTS.map((e) => stripped + e) : []), ...EXTS.map((e) => `${rel}/index${e}`)].map(norm);
}

/** Resolves like node/TS against the disk — to a file path or the raw path (with the candidates, for a file still to be created). */
function resolveLike(projectRoot, rel) {
  const isFile = (p) => { try { return fs.statSync(path.join(projectRoot, p)).isFile(); } catch { return false; } };
  const candidates = importCandidates(rel);
  for (const cand of candidates) {
    if (isFile(cand)) return { path: cand, exists: true };
  }
  return { path: norm(rel), exists: false, candidates };
}

/** Product paths one test file needs: [{ path, kind: 'import'|'read', exists }]. */
function testRequirements(projectRoot, testFile) {
  let text = '';
  try { text = fs.readFileSync(path.join(projectRoot, testFile), 'utf8'); } catch { return []; }
  const dir = path.posix.dirname(norm(testFile));
  const out = new Map();
  const addRel = (spec, base, kind) => {
    const joined = path.posix.normalize(path.posix.join(base, spec));
    if (joined.startsWith('..') || SKIP_DIRS.test(joined)) return;
    const r = kind === 'import' ? resolveLike(projectRoot, joined) : { path: norm(joined), exists: fs.existsSync(path.join(projectRoot, joined)) };
    if (!out.has(r.path)) out.set(r.path, { path: r.path, kind, exists: r.exists, ...(r.candidates ? { candidates: r.candidates } : {}) });
  };
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*|\bjest\.mock\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) addRel(m[1], dir, 'import');
  for (const m of text.matchAll(/\b(?:readFileSync|existsSync|readdirSync|statSync|readFile|lstatSync)\s*\(\s*['"]([^'"\n]+)['"]/g)) {
    const p = m[1];
    if (/^(https?:|[A-Za-z]:|\/)/.test(p)) continue;
    addRel(p, p.startsWith('.') ? dir : '', 'read');
  }
  for (const m of text.matchAll(/\bpath\.(?:join|resolve)\s*\(\s*(__dirname|process\.cwd\(\))\s*,((?:\s*['"][^'"\n]+['"]\s*,?)+)\s*\)/g)) {
    const parts = [...m[2].matchAll(/['"]([^'"\n]+)['"]/g)].map((x) => x[1]);
    addRel(parts.join('/'), m[1] === '__dirname' ? dir : '', 'read');
  }
  for (const m of text.matchAll(/new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) addRel(m[1], dir, 'read');
  // the tests' own tree (fixtures, helpers) is not product code
  const root = testRoot(testFile);
  return [...out.values()].filter((r) => !(`${r.path}/`).startsWith(`${root}/`) && r.path !== norm(testFile));
}

function covers(entry, p) {
  const e = norm(entry);
  if (!e) return false;
  if (e === p) return true;
  if (e.endsWith('/') ? p.startsWith(e) : p.startsWith(`${e}/`)) return true;
  if (e.includes('*')) {
    let re = '';
    for (let i = 0; i < e.length; i += 1) {
      const c = e[i];
      if (c === '*') { if (e[i + 1] === '*') { re += '.*'; i += 1; if (e[i + 1] === '/') i += 1; } else re += '[^/]*'; }
      else re += /[.+^${}()|[\]\\?]/.test(c) ? `\\${c}` : c;
    }
    return new RegExp(`^${re}$`).test(p);
  }
  return false;
}

/**
 * Per pending task: the product files its frozen tests need that are outside its scope (its files + those of the
 * tasks it depends on, transitively).
 * @returns {Record<string, { files: string[], tests: string[], detail: Array<{ test: string, path: string, kind: string }> }>}
 */
function scopeGaps(projectRoot, doc) {
  const tasks = (doc && Array.isArray(doc.tasks) ? doc.tasks : []).filter(Boolean);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const scopeOf = (t) => {
    const seen = new Set();
    const files = [];
    const walk = (x) => {
      if (!x || seen.has(x.id)) return;
      seen.add(x.id);
      files.push(...(x.files || []));
      for (const d of x.depends_on || []) walk(byId.get(d));
    };
    walk(t);
    return files;
  };
  const acceptance = Array.isArray(doc && doc.acceptance_tests) ? doc.acceptance_tests : [];
  // A file still to be created is imported without extension ('../src/x/menu' for files: ['src/x/menu.tsx']): it
  // matches a declared path by the same candidates node/TS would try, and is named by that declared path.
  const declared = [...new Set(tasks.flatMap((x) => (x.files || []).map(norm)))];
  const canonical = (r) => (r.exists || !r.candidates ? r.path : declared.find((f) => r.candidates.includes(f)) || r.path);
  const inScope = (scope, r) => {
    const paths = r.exists || !r.candidates ? [r.path] : r.candidates;
    return paths.some((p) => scope.some((e) => covers(e, p)));
  };
  const out = {};
  for (const t of tasks) {
    if (t.done === true || ['external_delivery', 'verify_only', 'spike'].includes(t.kind)) continue;
    const crit = new Set(t.acceptance || t.aceite || []);
    const tests = [...new Set(acceptance.filter((a) => a && (a.task === t.id || (!a.task && crit.has(a.criterion)))).flatMap((a) => (a.files || []).map((f) => norm(typeof f === 'string' ? f : f.path))))];
    if (!tests.length) continue;
    const scope = scopeOf(t);
    const detail = [];
    for (const test of tests) {
      for (const r of testRequirements(projectRoot, test)) {
        if (!inScope(scope, r)) detail.push({ test, path: canonical(r), kind: r.kind });
      }
    }
    if (detail.length) out[t.id] = { files: [...new Set(detail.map((d) => d.path))], tests: [...new Set(detail.map((d) => d.test))], detail };
  }
  return out;
}

/** Lint lines for the gaps: one line per task × test × kind, naming up to 6 paths. */
function scopeGapMessages(gaps) {
  const msgs = [];
  for (const [id, g] of Object.entries(gaps)) {
    const groups = new Map();
    for (const d of g.detail) {
      const k = `${d.test}\0${d.kind}`;
      if (!groups.has(k)) groups.set(k, { test: d.test, kind: d.kind, paths: [] });
      groups.get(k).paths.push(d.path);
    }
    for (const x of groups.values()) {
      const shown = x.paths.slice(0, 6).join(', ') + (x.paths.length > 6 ? ` e mais ${x.paths.length - 6}` : '');
      const one = x.paths.length === 1;
      msgs.push(`${id}: o teste congelado ${x.test} ${x.kind === 'import' ? 'importa' : 'lê'} ${shown}, fora de files — se a asserção depende de mudar ${one ? 'esse arquivo' : 'algum deles'}, inclua-o em files de ${id} (ou de uma tarefa de que ${id} depende); senão o execute para na 1ª tentativa com scope_insufficient`);
    }
  }
  return msgs;
}

module.exports = { testRequirements, scopeGaps, scopeGapMessages, testRoot };
