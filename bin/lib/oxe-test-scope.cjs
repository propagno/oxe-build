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

const CODE_IMPORT_RE = /\.(?:[cm]?[jt]sx?)$/i;
const MAX_REEXPORT_DEPTH = 6;

/** Strips // and closed /* *\/ comments while keeping strings, templates, regex literals and newlines intact. */
function stripCodeComments(raw) {
  const src = String(raw || '');
  let out = '';
  let prevSig = '(';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        const c = src[i];
        out += c;
        if (c === '\\' && i + 1 < src.length) { out += src[++i]; }
        else if (c === quote) break;
        i += 1;
      }
      prevSig = quote;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
      if (i < src.length) out += '\n';
    } else if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close === -1) { out += ch; prevSig = ch; continue; }
      for (let k = i; k < close + 2; k += 1) out += src[k] === '\n' ? '\n' : ' ';
      i = close + 1;
    } else if (ch === '/' && /[=(,:!&|?[{;+\-~*%<>^\n]/.test(prevSig)) {
      out += ch;
      let inClass = false;
      i += 1;
      while (i < src.length && src[i] !== '\n') {
        const c = src[i];
        out += c;
        if (c === '\\' && i + 1 < src.length && src[i + 1] !== '\n') { out += src[++i]; }
        else if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i += 1;
      }
      prevSig = '/';
    } else {
      out += ch;
      if (!/[ \t\r]/.test(ch)) prevSig = ch;
    }
  }
  return out;
}

function resolveModuleSpec(projectRoot, fromDir, rawSpec) {
  const clean = String(rawSpec || '').replace(/\?.*$/, '');
  if (!clean) return null;
  if (/^\.{1,2}(\/|$)/.test(clean)) {
    const joined = path.posix.normalize(path.posix.join(fromDir, clean));
    if (joined.startsWith('..') || SKIP_DIRS.test(joined)) return null;
    return resolveLike(projectRoot, joined);
  }
  return resolveAliasedImport(projectRoot, fromDir, clean);
}

function unquoteIdent(tok) {
  return String(tok || '').trim().replace(/^['"]|['"]$/g, '');
}

function narrowedNamespaceMembers(cleanText, ident) {
  const esc = ident.replace(/\$/g, '\\$');
  const totalUses = [...cleanText.matchAll(new RegExp(`\\b${esc}\\b`, 'g'))].length;
  const memberMatches = [...cleanText.matchAll(new RegExp(`\\b${esc}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g'))];
  // 1 declaration + N dot-member accesses: if every other reference is `ns.prop`, only those symbols are used.
  if (memberMatches.length > 0 && totalUses === 1 + memberMatches.length) {
    return memberMatches.map((m) => m[1]);
  }
  return ['*'];
}

/** Extracts imported specifiers and the exported symbol names requested from each (`'*'` when open/unknown). */
function extractImports(cleanText) {
  const bySpec = new Map();
  const addSyms = (spec, syms) => {
    if (!spec) return;
    if (!bySpec.has(spec)) bySpec.set(spec, new Set());
    const set = bySpec.get(spec);
    if (set.has('*')) return;
    for (const s of syms) {
      if (!s) continue;
      if (s === '*') { set.clear(); set.add('*'); return; }
      set.add(s);
    }
  };

  // Static ESM/TS imports (single or multi-line clauses, never crossing statements)
  const importStmtRe = /\bimport\s+(?:type\s+)?((?:\*\s*as\s+[A-Za-z_$][\w$]*|\{[^;{}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\*\s*as\s+[A-Za-z_$][\w$]*|\{[^;{}]*\}))?))\s*from\s*['"]([^'"\n]+)['"]/g;
  for (const m of cleanText.matchAll(importStmtRe)) {
    const clause = m[1].trim();
    const spec = m[2];
    const syms = [];
    const braceStart = clause.indexOf('{');
    const head = (braceStart >= 0 ? clause.slice(0, braceStart) : clause).replace(/,\s*$/, '').trim();
    if (head) {
      const nsMatch = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(head);
      if (nsMatch) syms.push(...narrowedNamespaceMembers(cleanText, nsMatch[1]));
      else {
        const parts = head.split(',').map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          const ns2 = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(p);
          if (ns2) syms.push(...narrowedNamespaceMembers(cleanText, ns2[1]));
          else syms.push('default');
        }
      }
    }
    if (braceStart >= 0) {
      const inner = clause.slice(braceStart + 1, clause.lastIndexOf('}'));
      for (const item of inner.split(',')) {
        const trimmed = item.trim().replace(/^(?:type|typeof)\s+/, '').trim();
        if (!trimmed) continue;
        const asParts = trimmed.split(/\s+as\s+/);
        syms.push(unquoteIdent(asParts[0]));
      }
    }
    addSyms(spec, syms.length ? syms : ['*']);
  }

  // Destructured require / dynamic import: const { a, b: localB } = require('...')
  const destructRe = /\b(?:const|let|var)\s+\{([^;{}]*)\}\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  for (const m of cleanText.matchAll(destructRe)) {
    const inner = m[1];
    const spec = m[2];
    if (inner.includes('...')) { addSyms(spec, ['*']); continue; }
    const syms = [];
    for (const item of inner.split(',')) {
      const prop = item.split(':')[0].split('=')[0].trim();
      if (prop) syms.push(unquoteIdent(prop));
    }
    addSyms(spec, syms.length ? syms : ['*']);
  }

  // Namespace require / dynamic import: const svc = require('...')
  const nsReqRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)(?!\s*\.)/g;
  for (const m of cleanText.matchAll(nsReqRe)) {
    addSyms(m[2], narrowedNamespaceMembers(cleanText, m[1]));
  }

  // Direct member access: require('...').foo
  for (const m of cleanText.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    addSyms(m[1], [m[2]]);
  }

  // Fallback scanner for side-effect imports, vi.mock/jest.mock, require.resolve, standalone import(), etc.
  const fallbackRe = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire(?:\.resolve)?\s*\(\s*|\bvi\.(?:mock|importActual)\s*(?:<[^>]*>)?\s*\(\s*|\bjest\.(?:mock|requireActual)\s*\(\s*)['"]([^'"\n]+)['"]/g;
  for (const m of cleanText.matchAll(fallbackRe)) {
    if (!bySpec.has(m[1])) addSyms(m[1], ['*']);
  }
  return bySpec;
}

const exportCache = new Map();

function parseModuleExports(projectRoot, fileRel) {
  if (!CODE_IMPORT_RE.test(fileRel)) return null;
  const abs = path.join(projectRoot, fileRel);
  let st = null;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > 512_000) return null;
  const cacheKey = `${abs}\0${st.mtimeMs}:${st.size}`;
  const hit = exportCache.get(cacheKey);
  if (hit) return hit;

  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const clean = stripCodeComments(raw);
  const localExports = new Set();
  const namedReexports = new Map();
  const wildcardReexports = [];
  const wildcardWithDefault = new Set();
  const addNamedRe = (exported, spec, orig) => {
    if (!exported || !spec) return;
    if (!namedReexports.has(exported)) namedReexports.set(exported, []);
    namedReexports.get(exported).push({ spec, orig: orig || exported });
  };

  // ESM: export { a, b as c } from './mod'
  for (const m of clean.matchAll(/\bexport\s+(?:type\s+)?\{([^;{}]*)\}\s*from\s*['"]([^'"\n]+)['"]/g)) {
    const spec = m[2];
    for (const item of m[1].split(',')) {
      const trimmed = item.trim().replace(/^(?:type|typeof)\s+/, '').trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const orig = unquoteIdent(parts[0]);
      const exported = unquoteIdent(parts[1] || parts[0]);
      addNamedRe(exported, spec, orig);
    }
  }
  // ESM: export * as ns from './mod'
  for (const m of clean.matchAll(/\bexport\s*\*\s*as\s+([A-Za-z_$][\w$]*|'[^']+'|"[^"]+")\s+from\s*['"]([^'"\n]+)['"]/g)) {
    addNamedRe(unquoteIdent(m[1]), m[2], '*');
  }
  // ESM: export * from './mod'
  for (const m of clean.matchAll(/\bexport\s+(?:type\s+)?\*\s*from\s*['"]([^'"\n]+)['"]/g)) {
    if (!wildcardReexports.includes(m[1])) wildcardReexports.push(m[1]);
  }
  // ESM: local export declarations
  if (/\bexport\s+default\b/.test(clean)) localExports.add('default');
  for (const m of clean.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|abstract\s+class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) {
    localExports.add(m[1]);
  }
  for (const m of clean.matchAll(/\bexport\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    localExports.add(m[1]);
  }
  for (const m of clean.matchAll(/\bexport\s+(?:declare\s+)?(?:const|let|var)\s+\{([^;{}]*)\}/g)) {
    for (const item of m[1].split(',')) {
      const segs = item.split('=')[0].trim().split(':').map((s) => s.trim()).filter(Boolean);
      const localName = segs[segs.length - 1];
      if (localName && /^[A-Za-z_$][\w$]*$/.test(localName)) localExports.add(localName);
    }
  }
  // ESM: local export { a, b as c } (without `from`)
  for (const m of clean.matchAll(/\bexport\s+(?:type\s+)?\{([^;{}]*)\}(?!\s*from\b)/g)) {
    for (const item of m[1].split(',')) {
      const trimmed = item.trim().replace(/^(?:type|typeof)\s+/, '').trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      localExports.add(unquoteIdent(parts[1] || parts[0]));
    }
  }

  // CJS: module.exports = require('./mod')
  for (const m of clean.matchAll(/\bmodule\.exports\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
    if (!wildcardReexports.includes(m[1])) wildcardReexports.push(m[1]);
    wildcardWithDefault.add(m[1]);
    localExports.delete('default');
  }
  // CJS: Object.assign(module.exports, require('./a'), require('./b'))
  for (const m of clean.matchAll(/\bObject\.assign\s*\(\s*(?:module\.)?exports\s*,([^)]*)\)/g)) {
    for (const r of m[1].matchAll(/\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
      if (!wildcardReexports.includes(r[1])) wildcardReexports.push(r[1]);
    }
  }
  // CJS: exports.foo = require('./mod')(.bar)?
  const cjsReexportedProps = new Set();
  for (const m of clean.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
    cjsReexportedProps.add(m[1]);
    addNamedRe(m[1], m[2], m[3] || '*');
  }
  for (const m of clean.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    if (!cjsReexportedProps.has(m[1])) localExports.add(m[1]);
  }
  // CJS: module.exports = { ...require('./a'), foo: require('./b').bar, localFn }
  for (const m of clean.matchAll(/\bmodule\.exports\s*=\s*\{([^}]*)\}/g)) {
    const body = m[1];
    for (const sp of body.matchAll(/\.\.\.\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
      if (!wildcardReexports.includes(sp[1])) wildcardReexports.push(sp[1]);
    }
    const propReq = new Set();
    for (const pr of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
      propReq.add(pr[1]);
      addNamedRe(pr[1], pr[2], pr[3] || '*');
    }
    for (const item of body.split(',')) {
      const t = item.trim();
      if (!t || t.startsWith('...')) continue;
      const key = /^([A-Za-z_$][\w$]*)(?:\s*:|\s*\(|$)/.exec(t);
      if (key && !propReq.has(key[1])) localExports.add(key[1]);
    }
  }

  const info = { localExports, namedReexports, wildcardReexports, wildcardWithDefault };
  exportCache.set(cacheKey, info);
  return info;
}

function collectPureBarrelTargets(projectRoot, curResolved, depth = 0, visited = new Set()) {
  if (!curResolved || !validRel(curResolved.path) || depth > MAX_REEXPORT_DEPTH) return [];
  if (visited.has(curResolved.path)) return [];
  visited.add(curResolved.path);
  if (!curResolved.exists) return [curResolved];
  const exp = parseModuleExports(projectRoot, curResolved.path);
  if (!exp) return [curResolved];
  const curDir = normDir(path.posix.dirname(curResolved.path));
  const nextSpecs = [
    ...[...exp.namedReexports.values()].flatMap((arr) => arr.map((e) => e.spec)),
    ...exp.wildcardReexports,
  ];
  if (!nextSpecs.length) return [curResolved];
  const out = exp.localExports.size > 0 ? [curResolved] : [];
  for (const s of new Set(nextSpecs)) {
    const target = resolveModuleSpec(projectRoot, curDir, s);
    if (!target || !validRel(target.path)) continue;
    const sub = collectPureBarrelTargets(projectRoot, target, depth + 1, visited);
    out.push(...(sub.length ? sub : [target]));
  }
  return out;
}

function findSymbolDefinitions(projectRoot, curResolved, sym, depth = 0, visited = new Set()) {
  if (!curResolved || !validRel(curResolved.path) || depth > MAX_REEXPORT_DEPTH) return [];
  const key = `${curResolved.path}\0${sym}`;
  if (visited.has(key)) return [];
  visited.add(key);
  if (!curResolved.exists) return [curResolved];
  const exp = parseModuleExports(projectRoot, curResolved.path);
  if (!exp) return [curResolved];
  if (exp.localExports.has(sym)) return [curResolved];
  const curDir = normDir(path.posix.dirname(curResolved.path));
  if (exp.namedReexports.has(sym)) {
    const found = [];
    for (const edge of exp.namedReexports.get(sym)) {
      const target = resolveModuleSpec(projectRoot, curDir, edge.spec);
      if (!target || !validRel(target.path)) continue;
      if (edge.orig === '*') {
        const sub = collectPureBarrelTargets(projectRoot, target, depth + 1, new Set([curResolved.path]));
        found.push(...(sub.length ? sub : [target]));
      } else {
        found.push(...findSymbolDefinitions(projectRoot, target, edge.orig, depth + 1, visited));
      }
    }
    if (found.length) return found;
  }
  const defs = [];
  for (const wSpec of exp.wildcardReexports) {
    if (sym === 'default' && !exp.wildcardWithDefault.has(wSpec)) continue;
    const target = resolveModuleSpec(projectRoot, curDir, wSpec);
    if (!target || !validRel(target.path)) continue;
    if (!target.exists) defs.push(target);
    else defs.push(...findSymbolDefinitions(projectRoot, target, sym, depth + 1, visited));
  }
  return defs;
}

/** Product paths one test file needs: [{ path, kind: 'import'|'read', exists }]. */
function testRequirements(projectRoot, testFile) {
  let rawText = '';
  try { rawText = fs.readFileSync(path.join(projectRoot, testFile), 'utf8'); } catch { return []; }
  const text = stripCodeComments(rawText);
  const dir = path.posix.dirname(norm(testFile));
  const out = new Map();
  const upsertImport = (r, extra = {}) => {
    if (!r || !validRel(r.path)) return null;
    let entry = out.get(r.path);
    if (!entry) {
      entry = { path: r.path, kind: 'import', exists: r.exists, ...(r.candidates ? { candidates: r.candidates } : {}) };
      out.set(r.path, entry);
    }
    if (extra.directImport) {
      entry.directImport = true;
      delete entry.wildcardOnly;
    }
    if (extra.viaBarrel && !entry.directImport && !entry.viaBarrel && entry.path !== extra.viaBarrel) {
      entry.viaBarrel = extra.viaBarrel;
    }
    if (extra.wildcardOnly) {
      if (!entry.directImport && !entry.symbolMatched) entry.wildcardOnly = true;
    } else if (extra.viaBarrel) {
      entry.symbolMatched = true;
      delete entry.wildcardOnly;
    }
    if (Array.isArray(extra.reexportTargets) && extra.reexportTargets.length) {
      const prev = entry.reexportTargets || [];
      entry.reexportTargets = [...new Set([...prev, ...extra.reexportTargets])];
      entry.barrelForwarded = entry.barrelForwarded === false ? false : Boolean(extra.barrelForwarded);
      if (extra.wildcardBarrel) entry.wildcardBarrel = true;
    } else if (extra.barrelForwarded === false) {
      entry.barrelForwarded = false;
    }
    return entry;
  };
  const addRelRead = (spec, base) => {
    const joined = path.posix.normalize(path.posix.join(base, spec));
    if (joined.startsWith('..') || SKIP_DIRS.test(joined)) return;
    const p = norm(joined);
    if (!validRel(p) || out.has(p)) return;
    out.set(p, { path: p, kind: 'read', exists: fs.existsSync(path.join(projectRoot, joined)) });
  };

  for (const [spec, syms] of extractImports(text)) {
    const direct = resolveModuleSpec(projectRoot, dir, spec);
    if (!direct || !validRel(direct.path)) continue;
    if (!direct.exists) {
      upsertImport(direct, { directImport: true, barrelForwarded: false });
      continue;
    }
    const exp = parseModuleExports(projectRoot, direct.path);
    const hasReexports = Boolean(exp && (exp.namedReexports.size > 0 || exp.wildcardReexports.length > 0));
    if (!hasReexports) {
      upsertImport(direct, { directImport: true, barrelForwarded: false });
      continue;
    }
    if (syms.has('*')) {
      if (exp.localExports.size === 0) {
        const leaves = collectPureBarrelTargets(projectRoot, direct).filter((t) => t.path !== direct.path);
        const leafPaths = [...new Set(leaves.map((t) => t.path))];
        upsertImport(direct, { directImport: true, reexportTargets: leafPaths, barrelForwarded: leafPaths.length > 0, wildcardBarrel: true });
        for (const leaf of leaves) upsertImport(leaf, { viaBarrel: direct.path, wildcardOnly: true });
      } else {
        upsertImport(direct, { directImport: true, barrelForwarded: false });
      }
      continue;
    }
    let allResolved = true;
    const leafMap = new Map();
    for (const sym of syms) {
      const defs = findSymbolDefinitions(projectRoot, direct, sym);
      if (!defs.length) {
        allResolved = false;
      } else {
        for (const d of defs) leafMap.set(d.path, d);
      }
    }
    const externalLeaves = [...leafMap.values()].filter((d) => d.path !== direct.path);
    const needsDirectSelf = !allResolved || leafMap.has(direct.path) || externalLeaves.length === 0;
    upsertImport(direct, {
      directImport: true,
      reexportTargets: externalLeaves.map((d) => d.path),
      barrelForwarded: !needsDirectSelf,
    });
    for (const leaf of externalLeaves) upsertImport(leaf, { viaBarrel: direct.path });
  }

  for (const m of text.matchAll(/\b(?:readFileSync|existsSync|readdirSync|statSync|readFile|lstatSync)\s*\(\s*['"]([^'"\n]+)['"]/g)) {
    const p = m[1];
    if (/^(https?:|[A-Za-z]:|\/)/.test(p)) continue;
    addRelRead(p, p.startsWith('.') ? dir : '');
  }
  for (const m of text.matchAll(/\bpath\.(?:join|resolve)\s*\(\s*(__dirname|process\.cwd\(\))\s*,((?:\s*['"][^'"\n]+['"]\s*,?)+)\s*\)/g)) {
    const parts = [...m[2].matchAll(/['"]([^'"\n]+)['"]/g)].map((x) => x[1]);
    addRelRead(parts.join('/'), m[1] === '__dirname' ? dir : '');
  }
  for (const m of text.matchAll(/new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) addRelRead(m[1], dir);
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
    return { files, ids: seen };
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
  const pendingWriters = tasks.filter((x) => x.done !== true && !['external_delivery', 'verify_only', 'spike'].includes(x.kind));
  const ownedByOtherPending = (ids, r) => {
    const paths = r.exists || !r.candidates ? [r.path] : r.candidates;
    return pendingWriters.some((o) => !ids.has(o.id) && (o.files || []).some((e) => paths.some((p) => covers(e, p))));
  };
  const out = {};
  for (const t of tasks) {
    if (t.done === true || ['external_delivery', 'verify_only', 'spike'].includes(t.kind)) continue;
    const crit = new Set(t.acceptance || t.aceite || []);
    const tests = [...new Set(acceptance.filter((a) => a && (a.task === t.id || (!a.task && crit.has(a.criterion)))).flatMap((a) => (a.files || []).map((f) => norm(typeof f === 'string' ? f : f.path))))];
    if (!tests.length) continue;
    const { files: scope, ids: depIds } = scopeOf(t);
    const detail = [];
    for (const test of tests) {
      const reqs = testRequirements(projectRoot, test);
      const byPath = new Map(reqs.map((r) => [r.path, r]));
      for (const r of reqs) {
        if (r.kind === 'read') {
          if (!inScope(scope, r)) detail.push({ test, path: canonical(r), kind: 'read' });
          continue;
        }
        if (r.wildcardOnly) continue;
        if (r.barrelForwarded && Array.isArray(r.reexportTargets) && r.reexportTargets.length > 0) {
          if (r.wildcardBarrel) {
            const anyCovered = inScope(scope, r) || r.reexportTargets.some((tp) => {
              const tr = byPath.get(tp) || { path: tp, exists: true };
              return inScope(scope, tr);
            });
            if (!anyCovered) detail.push({ test, path: canonical(r), kind: 'import' });
          }
          continue;
        }
        if (!r.directImport && r.viaBarrel && byPath.has(r.viaBarrel)) {
          const barrel = byPath.get(r.viaBarrel);
          if (inScope(scope, r)) continue;
          if (inScope(scope, barrel) && !ownedByOtherPending(depIds, r)) continue;
          detail.push({ test, path: canonical(r), kind: 'import' });
          continue;
        }
        if (!inScope(scope, r)) detail.push({ test, path: canonical(r), kind: 'import' });
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
