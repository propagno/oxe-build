'use strict';

/**
 * OXB-154 (rest): `oxe-cc plan skeleton [--tasks T3,T5] [--dry-run]` — the skeleton the frozen tests of a compiled
 * language need to COMPILE before the tasks run (otherwise one task's tests fail to compile on another task's missing
 * symbols). From each pending task's pack `symbols` that carry a `signature`, it writes a stub at the symbol's path —
 * only when the file or the symbol is missing — with a TODO body that names the task, so the test compiles and fails
 * for the right reason (`missing_target`):
 *   Kotlin  fun f(a: Int): Int            → fun f(a: Int): Int = TODO("T3: …")
 *   TS/JS   export function f(a: number)  → export function f(a: number) { throw new Error('TODO T3: …'); }
 *   TS      export const X: T             → export const X: T = undefined as unknown as T;
 *   JS      export const X                → export const X = undefined;
 *   Python  def f(a)                      → def f(a):\n    raise NotImplementedError("T3: …")
 *   Java    public int f(int a)           → in `class <File>` → public int f(int a) { throw new UnsupportedOperationException("TODO T3"); }
 *   class / interface / data class / type / enum signatures are written as declared (an empty body when none).
 * A symbol without a `signature` is reported: a generated stub would not compile against the tests.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { definesSymbol } = require('./oxe-stub-check.cjs');

const LANG = (p) => {
  const s = String(p || '');
  if (/\.kts?$/i.test(s)) return 'kotlin';
  if (/\.(?:c|m)?tsx?$/i.test(s)) return 'ts';
  if (/\.cjs$/i.test(s)) return 'cjs';
  if (/\.m?jsx?$/i.test(s)) return 'js';
  if (/\.py$/i.test(s)) return 'python';
  if (/\.java$/i.test(s)) return 'java';
  return null;
};

const DECL_RE = /^\s*(export\s+(?:default\s+)?)?(declare\s+)?(public\s+|internal\s+|private\s+)?(abstract\s+|sealed\s+|open\s+|data\s+|const\s+)?(class|interface|enum|type|object|record)\b/;
const VAR_RE = /^\s*(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(.*)$/s;

/**
 * Finds the index of a top-level `=` assignment (outside `()`, `[]`, `{}`, `<>` and strings; ignores `=>`, `==`, `!=`, `<=`, `>=`).
 */
function findTopLevelEquals(str) {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '=' && str[i + 1] === '>') { i += 1; continue; }
    if ((ch === '=' || ch === '!' || ch === '<' || ch === '>') && str[i + 1] === '=') { i += 1; continue; }
    if (ch === '(') paren += 1;
    else if (ch === ')' && paren > 0) paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']' && bracket > 0) bracket -= 1;
    else if (ch === '{') brace += 1;
    else if (ch === '}' && brace > 0) brace -= 1;
    else if (ch === '<') angle += 1;
    else if (ch === '>' && angle > 0) angle -= 1;
    else if (ch === '=' && paren === 0 && bracket === 0 && brace === 0 && angle === 0) return i;
  }
  return -1;
}

/**
 * True when `sig` ends with a balanced `{ ... }` block body at top level (not a `{ ... }` inside `<T extends { ... }>`
 * or a `: { ... }` return-type literal).
 */
function hasDeclarationBody(sig) {
  const s = String(sig || '').trim();
  if (!s.endsWith('}')) return false;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;
  let quote = null;
  let prevNonSpace = '';
  let bodyStart = -1;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; prevNonSpace = ch; continue; }
    if (ch === '=' && s[i + 1] === '>') { i += 1; prevNonSpace = '>'; continue; }
    if ((ch === '=' || ch === '!' || ch === '<' || ch === '>') && s[i + 1] === '=') { i += 1; prevNonSpace = '='; continue; }
    if (ch === '(') paren += 1;
    else if (ch === ')' && paren > 0) paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']' && bracket > 0) bracket -= 1;
    else if (ch === '<') angle += 1;
    else if (ch === '>' && angle > 0) angle -= 1;
    else if (ch === '{') {
      if (paren === 0 && bracket === 0 && brace === 0 && angle === 0 && ![':', '|', '&', '='].includes(prevNonSpace)) {
        bodyStart = i;
      }
      brace += 1;
    } else if (ch === '}' && brace > 0) {
      brace -= 1;
      if (brace === 0 && bodyStart >= 0 && i < s.length - 1) bodyStart = -1;
    }
    if (!/\s/.test(ch)) prevNonSpace = ch;
  }
  return bodyStart >= 0 && brace === 0;
}

function splitVarSignature(raw) {
  const m = VAR_RE.exec(raw);
  if (!m) return null;
  const kw = m[1];
  const ident = m[2];
  const rest = m[3].trim();
  if (!rest) return { kw, ident, typeAnnotation: null, initializer: null };
  if (rest.startsWith(':')) {
    const afterColon = rest.slice(1);
    const eq = findTopLevelEquals(afterColon);
    if (eq < 0) return { kw, ident, typeAnnotation: afterColon.trim() || null, initializer: null };
    return {
      kw,
      ident,
      typeAnnotation: afterColon.slice(0, eq).trim() || null,
      initializer: afterColon.slice(eq + 1).trim() || null,
    };
  }
  if (rest.startsWith('=')) {
    return { kw, ident, typeAnnotation: null, initializer: rest.slice(1).trim() || null };
  }
  return null;
}

function ensureTsJsExport(sig) {
  return /^\s*(?:export|declare)\b/.test(sig) ? sig : `export ${sig}`;
}

function stub(lang, signature, task) {
  const raw = String(signature || '').trim().replace(/;+\s*$/, '');
  if (!raw) return null;
  const hasBody = hasDeclarationBody(raw);
  const sig = hasBody ? raw : raw.replace(/\s*\{\s*$/, '');
  const todo = `${task.id}: ${String((task && task.title) || '').replace(/["'`\\]/g, '').slice(0, 60)}`;

  const declMatch = DECL_RE.exec(sig);
  if (declMatch) {
    const declKind = declMatch[5];
    if ((lang === 'ts' || lang === 'js') && declKind === 'type') {
      if (lang === 'js') return null;
      const exported = ensureTsJsExport(sig);
      return findTopLevelEquals(exported) >= 0 ? `${exported};` : `${exported} = unknown; // TODO ${todo}`;
    }
    if (lang === 'python') return `${sig.replace(/:$/, '')}:\n    pass  # TODO ${todo}`;
    if (lang === 'kotlin' && /\bdata\s+class\b/.test(sig)) return sig; // data class needs its constructor, kept as declared
    if (lang === 'ts' || lang === 'js') {
      if (lang === 'js' && declKind === 'interface') return null;
      const exported = ensureTsJsExport(sig);
      return hasBody ? exported : `${exported} {\n  // TODO ${todo}\n}`;
    }
    if (lang === 'cjs') {
      if (declKind !== 'class') return null;
      const cleanCls = sig.replace(/^\s*export\s+(?:default\s+)?/, '');
      const clsName = nameOf(cleanCls);
      const clsBody = hasBody ? cleanCls : `${cleanCls} {\n  // TODO ${todo}\n}`;
      return clsName ? `${clsBody}\nexports.${clsName} = ${clsName};` : clsBody;
    }
    return hasBody ? sig : `${sig} {\n  // TODO ${todo}\n}`;
  }

  if (lang === 'ts' || lang === 'js' || lang === 'cjs') {
    const v = splitVarSignature(sig);
    if (v) {
      if (v.initializer === null) {
        if (lang === 'ts') {
          return v.typeAnnotation
            ? `export ${v.kw} ${v.ident}: ${v.typeAnnotation} = undefined as unknown as ${v.typeAnnotation};`
            : `export ${v.kw} ${v.ident} = undefined;`;
        }
        if (lang === 'js') return `export ${v.kw} ${v.ident} = undefined;`;
        return `${v.kw} ${v.ident} = undefined;\nexports.${v.ident} = ${v.ident};`;
      }
      if (/=>\s*$/.test(v.initializer)) {
        if (lang === 'ts') {
          const typed = v.typeAnnotation ? `: ${v.typeAnnotation}` : '';
          return `export ${v.kw} ${v.ident}${typed} = ${v.initializer} {\n  throw new Error('TODO ${todo}');\n};`;
        }
        if (lang === 'js') return `export ${v.kw} ${v.ident} = () => {\n  throw new Error('TODO ${todo}');\n};`;
        return `${v.kw} ${v.ident} = () => {\n  throw new Error('TODO ${todo}');\n};\nexports.${v.ident} = ${v.ident};`;
      }
      if (lang === 'ts') {
        const typed = v.typeAnnotation ? `: ${v.typeAnnotation}` : '';
        return `export ${v.kw} ${v.ident}${typed} = ${v.initializer};`;
      }
      if (lang === 'js') return `export ${v.kw} ${v.ident} = ${v.initializer};`;
      return `${v.kw} ${v.ident} = ${v.initializer};\nexports.${v.ident} = ${v.ident};`;
    }
  }

  if (lang === 'kotlin') return /\)\s*:\s*Unit\s*$/.test(sig) || !/\)\s*:/.test(sig) ? `${sig} { TODO("${todo}") }` : `${sig} = TODO("${todo}")`;
  if (lang === 'ts' || lang === 'js') {
    const exported = ensureTsJsExport(sig);
    return hasBody ? exported : `${exported} {\n  throw new Error('TODO ${todo}');\n}`;
  }
  if (lang === 'cjs') {
    const cleanFn = sig.replace(/^\s*export\s+(?:default\s+)?/, '');
    const fnName = nameOf(cleanFn);
    const fnBody = hasBody ? cleanFn : `${cleanFn} {\n  throw new Error('TODO ${todo}');\n}`;
    return fnName ? `${fnBody}\nexports.${fnName} = ${fnName};` : fnBody;
  }
  if (lang === 'python') return `${sig.replace(/:$/, '')}:\n    raise NotImplementedError("${todo}")`;
  if (lang === 'java') return hasBody ? `  ${sig}` : `  ${sig} {\n    throw new UnsupportedOperationException("TODO ${todo}");\n  }`;
  return null;
}

function skipLeadingTypeParams(str) {
  const s = String(str || '').trimStart();
  if (!s.startsWith('<')) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '<') depth += 1;
    else if (s[i] === '>') {
      depth -= 1;
      if (depth === 0) return s.slice(i + 1).trimStart();
    }
  }
  return s;
}

function skipKotlinReceiver(str) {
  const s = String(str || '').trimStart();
  let i = 0;
  if (!/[A-Za-z_$]/.test(s[0] || '')) return s;
  while (i < s.length && /[\w$.]/.test(s[i])) {
    if (s[i] === '.') {
      const rest = s.slice(i + 1).trimStart();
      if (/^[A-Za-z_$][\w$]*\s*(?:<|\(|=|:|$)/.test(rest)) return rest;
    }
    i += 1;
  }
  if (s[i] === '<') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '<') depth += 1;
      else if (s[i] === '>') {
        depth -= 1;
        if (depth === 0) { i += 1; break; }
      }
      i += 1;
    }
  }
  while (i < s.length && (s[i] === '?' || /\s/.test(s[i]))) i += 1;
  if (s[i] === '.') return s.slice(i + 1).trimStart();
  return s;
}

function nameOf(sig) {
  const s = String(sig || '');
  const kw = /\b(fun|function\s*\*?|def|class|interface|typealias|enum|type|object|record|struct|trait|func|protocol)\s+/.exec(s);
  if (kw) {
    let afterKw = skipLeadingTypeParams(s.slice(kw.index + kw[0].length));
    if (kw[1] === 'fun') afterKw = skipKotlinReceiver(afterKw);
    const id = /^([A-Za-z_$][\w$]*)/.exec(afterKw);
    if (id) return id[1];
  }
  const v = /\b(?:const\s+val|const|let|var|val)\s+([A-Za-z_$][\w$]*)/.exec(s);
  if (v) return v[1];
  const fn = /([A-Za-z_$][\w$]*)\s*(?:<[^;{}()]*>)?\s*\(/.exec(s);
  return fn ? fn[1] : null;
}

function plan(root, doc, pack, options = {}) {
  const only = options.tasks ? new Set(String(options.tasks).split(',').map((x) => x.trim().toUpperCase())) : null;
  const byPath = new Map();
  const missingSignature = [];
  const isDone = (x) => Boolean(x && (x.done === true || x.status === 'done'));
  for (const t of ((doc && doc.tasks) || []).filter((x) => x && !isDone(x) && (!only || only.has(x.id)))) {
    const entry = ((pack && pack.tasks) || []).find((x) => x && (x.id === t.id || x.task === t.id));
    for (const s of (entry && entry.symbols) || []) {
      const p = String(s.path || s.file || '').replace(/\\/g, '/');
      const lang = LANG(p);
      if (!p || !lang) continue;
      if (!s.signature) { missingSignature.push(`${t.id}: ${s.name} (${p}) sem signature no pack — o esqueleto não compilaria contra os testes`); continue; }
      const abs = path.join(root, p);
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const name = s.name || nameOf(s.signature);
      if (text && name && definesSymbol(text, name)) continue;
      const body = stub(lang, s.signature, t);
      if (!body) continue;
      if (!byPath.has(p)) byPath.set(p, { path: p, lang, exists: Boolean(text), stubs: [], _seen: new Set() });
      const bucket = byPath.get(p);
      if (name && bucket._seen.has(name)) continue;
      if (name) bucket._seen.add(name);
      bucket.stubs.push({ task: t.id, name, body });
    }
  }
  const files = [...byPath.values()].map(({ _seen, ...rest }) => rest);
  return { files, missing_signature: missingSignature };
}

function headerFor(lang, p) {
  if (lang === 'kotlin') {
    const m = /(?:^|\/)(?:src\/(?:main|test)\/(?:kotlin|java)\/)(.+)\/[^/]+$/.exec(p);
    return m ? `package ${m[1].replace(/\//g, '.')}\n\n` : '';
  }
  if (lang === 'java') {
    const m = /(?:^|\/)(?:src\/(?:main|test)\/java\/)(.+)\/[^/]+$/.exec(p);
    return m ? `package ${m[1].replace(/\//g, '.')};\n\n` : '';
  }
  return '';
}

function renderFile(root, plannedFile) {
  const abs = path.join(root, plannedFile.path);
  const bodies = (plannedFile.stubs || []).map((s) => s.body);
  if (plannedFile.lang === 'java') {
    const cls = path.basename(plannedFile.path, '.java');
    if (plannedFile.exists && fs.existsSync(abs)) {
      const cur = fs.readFileSync(abs, 'utf8');
      const at = cur.lastIndexOf('}');
      return at >= 0 ? `${cur.slice(0, at).replace(/\s*$/, '\n')}\n${bodies.join('\n\n')}\n}\n` : `${cur}\n${bodies.join('\n\n')}\n`;
    }
    return `${headerFor('java', plannedFile.path)}public class ${cls} {\n${bodies.join('\n\n')}\n}\n`;
  }
  const cur = plannedFile.exists && fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8').replace(/\s*$/, '\n\n')
    : headerFor(plannedFile.lang, plannedFile.path);
  return `${cur}${bodies.join('\n\n')}\n`;
}

function write(root, planned) {
  const written = [];
  for (const f of planned.files) {
    const abs = path.join(root, f.path);
    const text = renderFile(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    written.push({ path: f.path, stubs: f.stubs.map((s) => `${s.task}:${s.name}`) });
  }
  return written;
}

function formatVmError(file, err) {
  const raw = String((err && err.stack) || (err && err.message) || err);
  const lineMatch = /:(\d+)\r?\n/.exec(raw);
  const msg = String((err && err.message) || err).trim();
  return lineMatch ? `${file}:${lineMatch[1]}: SyntaxError: ${msg}` : `${file}: SyntaxError: ${msg}`;
}

function checkEsmWithNode(file, code) {
  const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: code,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (res.status === 0) return null;
  const stderr = String(res.stderr || '');
  const lineMatch = /^\[stdin\]:(\d+)/m.exec(stderr);
  const errLine = /^(SyntaxError:[^\r\n]+)/m.exec(stderr);
  const detail = errLine ? errLine[1].trim() : (stderr.trim().split(/\r?\n/)[0] || 'erro de sintaxe');
  return lineMatch ? `${file}:${lineMatch[1]}: ${detail}` : `${file}: ${detail}`;
}

function gitWorktreeMainRoot(startDir) {
  let cur = path.resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    const dotGit = path.join(cur, '.git');
    try {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) return null;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
        if (!m) return null;
        const gitdir = path.resolve(cur, m[1].trim());
        const commondirFile = path.join(gitdir, 'commondir');
        const commonGitDir = fs.existsSync(commondirFile)
          ? path.resolve(gitdir, fs.readFileSync(commondirFile, 'utf8').trim())
          : (/[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) ? path.resolve(gitdir, '..', '..') : null);
        if (commonGitDir && path.basename(commonGitDir) === '.git') return path.dirname(commonGitDir);
        return null;
      }
    } catch {
      // keep walking up
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function resolveProjectTypescript(file, opts) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'tsModule')) return opts.tsModule;
  const searchPaths = [];
  if (opts && typeof opts.root === 'string' && opts.root) searchPaths.push(path.resolve(opts.root));
  else if (file && path.isAbsolute(file)) searchPaths.push(path.dirname(file));
  else searchPaths.push(process.cwd());
  const wtRoot = gitWorktreeMainRoot(searchPaths[0]);
  if (wtRoot && !searchPaths.includes(wtRoot)) searchPaths.push(wtRoot);
  try {
    const resolved = require.resolve('typescript', { paths: searchPaths });
    return require(resolved);
  } catch {
    return null;
  }
}

/**
 * Validates the syntax of a generated stub (without typechecking external imports):
 *   - `.cjs`: CommonJS syntax via `new vm.Script`
 *   - `.mjs` / `.js`: `new vm.Script` (fast CJS path for `.js`) or `node --input-type=module --check`
 *   - `.ts` / `.tsx` / `.mts` / `.cts` / `.jsx`: project's own `typescript` (`transpileModule` syntactic diagnostics);
 *     if `typescript` is absent in the project's `node_modules`, emits a warning (`ok: true`, `checked: false`).
 */
function checkStubSyntax(file, text, options = {}) {
  const opts = typeof options === 'string' ? { root: options } : (options || {});
  const f = String(file || '').replace(/\\/g, '/') || 'stub';
  const code = String(text ?? '');

  if (/\.cjs$/i.test(f)) {
    try {
      new vm.Script(code, { filename: f });
      return { ok: true, checked: true, lang: 'cjs', errors: [], warnings: [] };
    } catch (err) {
      return { ok: false, checked: true, lang: 'cjs', errors: [formatVmError(f, err)], warnings: [] };
    }
  }

  if (/\.mjs$/i.test(f)) {
    const esmErr = checkEsmWithNode(f, code);
    return esmErr
      ? { ok: false, checked: true, lang: 'mjs', errors: [esmErr], warnings: [] }
      : { ok: true, checked: true, lang: 'mjs', errors: [], warnings: [] };
  }

  if (/\.js$/i.test(f)) {
    try {
      new vm.Script(code, { filename: f });
      return { ok: true, checked: true, lang: 'js', errors: [], warnings: [] };
    } catch {
      const esmErr = checkEsmWithNode(f, code);
      return esmErr
        ? { ok: false, checked: true, lang: 'js', errors: [esmErr], warnings: [] }
        : { ok: true, checked: true, lang: 'js', errors: [], warnings: [] };
    }
  }

  if (/\.(?:(?:c|m)?tsx?|jsx)$/i.test(f)) {
    const lang = /\.jsx$/i.test(f) ? 'js' : 'ts';
    const ts = resolveProjectTypescript(file, opts);
    if (!ts || typeof ts.transpileModule !== 'function') {
      return {
        ok: true,
        checked: false,
        lang,
        errors: [],
        warnings: [`${f}: typescript não encontrado em node_modules do projeto — validação de sintaxe do stub pulada`],
      };
    }
    const isJsx = /\.(?:tsx|jsx)$/i.test(f);
    const res = ts.transpileModule(code, {
      fileName: path.basename(f) || (isJsx ? 'stub.tsx' : 'stub.ts'),
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget ? ts.ScriptTarget.ESNext : 99,
        module: ts.ModuleKind ? ts.ModuleKind.ESNext : 99,
        ...(isJsx && ts.JsxEmit ? { jsx: ts.JsxEmit.Preserve } : {}),
      },
    });
    const errCat = ts.DiagnosticCategory ? ts.DiagnosticCategory.Error : 1;
    const diags = (res.diagnostics || []).filter((d) => d && d.category === errCat);
    if (!diags.length) return { ok: true, checked: true, lang, errors: [], warnings: [] };
    const errors = diags.map((d) => {
      const msg = typeof ts.flattenDiagnosticMessageText === 'function'
        ? ts.flattenDiagnosticMessageText(d.messageText, ' ')
        : String(d.messageText || 'erro de sintaxe');
      if (d.file && typeof d.start === 'number' && typeof d.file.getLineAndCharacterOfPosition === 'function') {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        return `${f}:${pos.line + 1}:${pos.character + 1}: TS${d.code} ${msg}`;
      }
      return `${f}: TS${d.code || ''} ${msg}`.trim();
    });
    return { ok: false, checked: true, lang, errors, warnings: [] };
  }

  return { ok: true, checked: false, lang: LANG(f), errors: [], warnings: [] };
}

module.exports = { stub, nameOf, plan, renderFile, write, checkStubSyntax, LANG };
