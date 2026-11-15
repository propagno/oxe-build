'use strict';

/**
 * OXB-171: what a frozen acceptance test needs from the product — its static relative imports and the literal paths it
 * reads — compared with the task's `files` (and the files of the tasks it depends on). F2's T8 failed 3 attempts on
 * tests/acceptance/f2/r4-removal.test.ts ("its IPC channel groups are gone"): the test imports shared/types/ipc.ts,
 * which was not in T8's files, and 9 more F2 tasks had the same gap with lint green.
 *
 * Static only: relative and aliased (`tsconfig`/`jsconfig` `paths` + `baseUrl`, `package.json#imports`)
 * `import … from` / `import()` / `require()` / `vi.mock()`, `readFileSync|existsSync|readdirSync|statSync|readFile`
 * with a literal, `path.join|resolve(__dirname|process.cwd(), '…')` and `new URL('…', import.meta.url)`.
 */

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.oxe)(\/|$)/;
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, '')]));
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const normDir = (d) => { const n = norm(d); return n === '.' ? '' : n.replace(/\/+$/, ''); };
const validRel = (p) => Boolean(p) && p !== '..' && !p.startsWith('../') && !path.posix.isAbsolute(p) && !SKIP_DIRS.test(p);
const normJoin = (base, rel) => {
  const joined = path.posix.normalize(base ? path.posix.join(base, norm(rel)) : norm(rel));
  return joined === '.' ? '' : norm(joined);
};

/** Parses JSONC (tsconfig/jsconfig comments + trailing commas) without corrupting // or /* inside strings. */
function parseJsonc(raw) {
  const src = String(raw || '').replace(/^\uFEFF/, '');
  let noComments = '';
  let inStr = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      noComments += ch;
      if (ch === '\\' && i + 1 < src.length) noComments += src[++i];
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      noComments += ch;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i + 1 < src.length && src[i + 1] !== '\n') i += 1;
    } else if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      noComments += ch;
    }
  }
  let clean = '';
  inStr = false;
  for (let i = 0; i < noComments.length; i += 1) {
    const ch = noComments[i];
    if (inStr) {
      clean += ch;
      if (ch === '\\' && i + 1 < noComments.length) clean += noComments[++i];
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      clean += ch;
    } else if (ch === ',') {
      let k = i + 1;
      while (k < noComments.length && /\s/.test(noComments[k])) k += 1;
      if (noComments[k] !== '}' && noComments[k] !== ']') clean += ch;
    } else {
      clean += ch;
    }
  }
  try { return JSON.parse(clean); } catch { return null; }
}

function compileAliasTable(entries) {
  const rules = [];
  for (const { pattern, targets } of entries) {
    if (typeof pattern !== 'string' || !pattern || !targets.length) continue;
    const star = pattern.indexOf('*');
    if (star !== pattern.lastIndexOf('*')) continue;
    const hasStar = star >= 0;
    const prefix = hasStar ? pattern.slice(0, star) : pattern;
    const suffix = hasStar ? pattern.slice(star + 1) : '';
    rules.push({ pattern, hasStar, prefix, suffix, targets });
  }
  rules.sort((a, b) => {
    if (a.hasStar !== b.hasStar) return a.hasStar ? 1 : -1;
    if (b.prefix.length !== a.prefix.length) return b.prefix.length - a.prefix.length;
    return b.suffix.length - a.suffix.length;
  });
  return rules;
}

function matchAliasTable(rules, spec) {
  for (const rule of rules) {
    if (!rule.hasStar) {
      if (spec !== rule.pattern) continue;
      const paths = [...new Set(rule.targets.map(({ target, baseDir }) => normJoin(baseDir, target)).filter(validRel))];
      return paths.length ? { isCatchAll: false, paths } : null;
    }
    if (!spec.startsWith(rule.prefix) || !spec.endsWith(rule.suffix) || spec.length < rule.prefix.length + rule.suffix.length) continue;
    const mid = spec.slice(rule.prefix.length, spec.length - rule.suffix.length);
    const paths = [...new Set(rule.targets.map(({ target, baseDir }) => normJoin(baseDir, target.includes('*') ? target.replace('*', () => mid) : target)).filter(validRel))];
    return paths.length ? { isCatchAll: rule.prefix === '' && rule.suffix === '', paths } : null;
  }
  return null;
}

function resolveConfigPath(projectRoot, relCandidate) {
  if (!relCandidate || path.posix.isAbsolute(relCandidate) || relCandidate.startsWith('..') || SKIP_DIRS.test(relCandidate)) return null;
  const tries = [relCandidate, `${relCandidate}.json`, normJoin(relCandidate, 'tsconfig.json')];
  for (const cand of tries) {
    try {
      if (fs.statSync(path.join(projectRoot, cand)).isFile()) return norm(cand);
    } catch { /* */ }
  }
  return null;
}

function loadTsConfigChain(projectRoot, cfgRel, visited = new Set(), sigFiles = new Set()) {
  const resolved = resolveConfigPath(projectRoot, cfgRel);
  if (!resolved || visited.has(resolved)) return null;
  visited.add(resolved);
  sigFiles.add(resolved);
  let raw = '';
  try { raw = fs.readFileSync(path.join(projectRoot, resolved), 'utf8'); } catch { return null; }
  const parsed = parseJsonc(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const cfgDir = normDir(path.posix.dirname(resolved));
  let baseUrlDir = null;
  const pathMap = new Map();
  const refConfigs = [];
  const extList = Array.isArray(parsed.extends) ? parsed.extends : (typeof parsed.extends === 'string' ? [parsed.extends] : []);
  for (const ext of extList) {
    if (typeof ext !== 'string') continue;
    const extRel = ext.startsWith('.') ? normJoin(cfgDir, ext) : norm(ext);
    const parent = loadTsConfigChain(projectRoot, extRel, visited, sigFiles);
    if (!parent) continue;
    if (parent.baseUrlDir != null) baseUrlDir = parent.baseUrlDir;
    for (const [k, v] of parent.pathMap) pathMap.set(k, v);
    refConfigs.push(...parent.refConfigs);
  }
  const co = parsed.compilerOptions && typeof parsed.compilerOptions === 'object' ? parsed.compilerOptions : {};
  if (typeof co.baseUrl === 'string') baseUrlDir = normJoin(cfgDir, co.baseUrl);
  const pathsBase = baseUrlDir != null ? baseUrlDir : cfgDir;
  if (co.paths && typeof co.paths === 'object') {
    for (const [pattern, arr] of Object.entries(co.paths)) {
      if (!Array.isArray(arr)) continue;
      const targets = arr.filter((t) => typeof t === 'string').map((t) => ({ target: t, baseDir: pathsBase }));
      if (targets.length) pathMap.set(pattern, targets);
    }
  }
  if (Array.isArray(parsed.references)) {
    for (const ref of parsed.references) {
      if (ref && typeof ref.path === 'string') refConfigs.push(normJoin(cfgDir, ref.path));
    }
  }
  return { baseUrlDir, pathMap, refConfigs };
}

function flattenImportTargets(val, baseDir, acc = []) {
  if (typeof val === 'string') {
    if (val.startsWith('./') || val.startsWith('../')) acc.push({ target: val, baseDir });
  } else if (Array.isArray(val)) {
    for (const item of val) flattenImportTargets(item, baseDir, acc);
  } else if (val && typeof val === 'object') {
    for (const item of Object.values(val)) flattenImportTargets(item, baseDir, acc);
  }
  return acc;
}

const aliasCache = new Map();

function statSig(projectRoot, files) {
  const parts = [];
  for (const rel of files) {
    try {
      const st = fs.statSync(path.join(projectRoot, rel));
      parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${rel}:-`);
    }
  }
  return parts.join('|');
}

function getAliasContext(projectRoot, startDir) {
  const rootKey = `${path.resolve(projectRoot)}\0${startDir}`;
  const cached = aliasCache.get(rootKey);
  if (cached && statSig(projectRoot, cached.watchFiles) === cached.sig) return cached.ctx;

  const dirs = [];
  let cur = normDir(startDir);
  for (;;) {
    dirs.push(cur);
    if (!cur) break;
    const parent = normDir(path.posix.dirname(cur));
    if (parent === cur) break;
    cur = parent;
  }

  const watchSet = new Set();
  const tsTables = [];
  const baseUrls = [];
  const visitedCfg = new Set();
  const queue = [];
  for (const d of dirs) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const rel = normJoin(d, name);
      watchSet.add(rel);
      if (resolveConfigPath(projectRoot, rel)) queue.push(rel);
    }
  }
  while (queue.length) {
    const nextRel = queue.shift();
    const chain = loadTsConfigChain(projectRoot, nextRel, visitedCfg, watchSet);
    if (!chain) continue;
    if (chain.pathMap.size) {
      tsTables.push(compileAliasTable([...chain.pathMap.entries()].map(([pattern, targets]) => ({ pattern, targets }))));
    }
    if (chain.baseUrlDir != null && validRel(chain.baseUrlDir || '.')) baseUrls.push(chain.baseUrlDir);
    for (const ref of chain.refConfigs) queue.push(ref);
  }

  const pkgTables = [];
  const pkgDeps = new Set();
  for (const d of dirs) {
    const pkgRel = normJoin(d, 'package.json');
    watchSet.add(pkgRel);
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, pkgRel), 'utf8')); } catch { continue; }
    if (!pkg || typeof pkg !== 'object') continue;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[field] && typeof pkg[field] === 'object') {
        for (const dep of Object.keys(pkg[field])) pkgDeps.add(dep);
      }
    }
    if (pkg.imports && typeof pkg.imports === 'object') {
      const entries = [];
      for (const [pattern, val] of Object.entries(pkg.imports)) {
        if (!pattern.startsWith('#')) continue;
        const targets = flattenImportTargets(val, d);
        if (targets.length) entries.push({ pattern, targets });
      }
      if (entries.length) pkgTables.push(compileAliasTable(entries));
    }
  }

  const ctx = { tsTables, pkgTables, baseUrls: [...new Set(baseUrls)], pkgDeps };
  const watchFiles = [...watchSet];
  aliasCache.set(rootKey, { watchFiles, sig: statSig(projectRoot, watchFiles), ctx });
  return ctx;
}

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

function resolveTargetList(projectRoot, relTargets) {
  for (const rel of relTargets) {
    const r = resolveLike(projectRoot, rel);
    if (r.exists) return r;
  }
  const candidates = [...new Set(relTargets.flatMap((rel) => importCandidates(rel)))];
  return { path: norm(relTargets[0]), exists: false, candidates };
}

function resolveAliasedImport(projectRoot, fromDir, rawSpec) {
  const spec = String(rawSpec || '').replace(/\?.*$/, '');
  if (!spec || /^(https?:|data:|file:|node:|[A-Za-z]:|\/)/.test(spec)) return null;
  if (BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0])) return null;
  const ctx = getAliasContext(projectRoot, fromDir);
  if (spec.startsWith('#')) {
    for (const table of ctx.pkgTables) {
      const m = matchAliasTable(table, spec);
      if (m) return resolveTargetList(projectRoot, m.paths);
    }
    return null;
  }
  const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  const isDir = (rel) => { try { return fs.statSync(path.join(projectRoot, rel)).isDirectory(); } catch { return false; } };
  for (const table of ctx.tsTables) {
    const m = matchAliasTable(table, spec);
    if (!m) continue;
    if (!m.isCatchAll) return resolveTargetList(projectRoot, m.paths);
    if (ctx.pkgDeps.has(pkgName)) return null;
    const r = resolveTargetList(projectRoot, m.paths);
    if (r.exists) return r;
    if (spec.includes('/') && m.paths.some((p) => validRel(p.split('/')[0]) && isDir(p.split('/')[0]))) return r;
    return null;
  }
  if (!ctx.pkgDeps.has(pkgName)) {
    for (const baseDir of ctx.baseUrls) {
      const rel = normJoin(baseDir, spec);
      if (!validRel(rel)) continue;
      const r = resolveLike(projectRoot, rel);
      if (r.exists) return r;
      if (spec.includes('/')) {
        const topSeg = normJoin(baseDir, spec.split('/')[0]);
        if (validRel(topSeg) && isDir(topSeg)) return r;
      }
    }
  }
  return null;
}

/** Product paths one test file needs: [{ path, kind: 'import'|'read', exists }]. */
function testRequirements(projectRoot, testFile) {
  let text = '';
  try { text = fs.readFileSync(path.join(projectRoot, testFile), 'utf8'); } catch { return []; }
  const dir = path.posix.dirname(norm(testFile));
  const out = new Map();
  const addResolved = (r, kind) => {
    if (!r || !validRel(r.path)) return;
    if (!out.has(r.path)) out.set(r.path, { path: r.path, kind, exists: r.exists, ...(r.candidates ? { candidates: r.candidates } : {}) });
  };
  const addRel = (spec, base, kind) => {
    const clean = kind === 'import' ? String(spec).replace(/\?.*$/, '') : spec;
    const joined = path.posix.normalize(path.posix.join(base, clean));
    if (joined.startsWith('..') || SKIP_DIRS.test(joined)) return;
    const r = kind === 'import' ? resolveLike(projectRoot, joined) : { path: norm(joined), exists: fs.existsSync(path.join(projectRoot, joined)) };
    addResolved(r, kind);
  };
  for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire(?:\.resolve)?\s*\(\s*|\bvi\.(?:mock|importActual)\s*(?:<[^>]*>)?\s*\(\s*|\bjest\.(?:mock|requireActual)\s*\(\s*)['"]([^'"\n]+)['"]/g)) {
    const spec = m[1];
    if (/^\.{1,2}(\/|$)/.test(spec)) addRel(spec, dir, 'import');
    else addResolved(resolveAliasedImport(projectRoot, dir, spec), 'import');
  }
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
      for (const d of x.depends_on || x.dependsOn || []) walk(byId.get(d));
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

module.exports = { testRequirements, scopeGaps, scopeGapMessages, testRoot, covers };
