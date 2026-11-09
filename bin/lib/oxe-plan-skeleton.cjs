'use strict';

/**
 * OXB-154 (rest): `oxe-cc plan skeleton [--tasks T3,T5] [--dry-run]` — the skeleton the frozen tests of a compiled
 * language need to COMPILE before the tasks run (otherwise one task's tests fail to compile on another task's missing
 * symbols). From each pending task's pack `symbols` that carry a `signature`, it writes a stub at the symbol's path —
 * only when the file or the symbol is missing — with a TODO body that names the task, so the test compiles and fails
 * for the right reason (`missing_target`):
 *   Kotlin  fun f(a: Int): Int            → fun f(a: Int): Int = TODO("T3: …")
 *   TS/JS   export function f(a: number)  → export function f(a: number) { throw new Error('TODO T3: …'); }
 *   Python  def f(a)                      → def f(a):\n    raise NotImplementedError("T3: …")
 *   Java    public int f(int a)           → in `class <File>` → public int f(int a) { throw new UnsupportedOperationException("TODO T3"); }
 *   class / interface / data class / type / enum signatures are written as declared (an empty body when none).
 * A symbol without a `signature` is reported: a generated stub would not compile against the tests.
 */

const fs = require('fs');
const path = require('path');

const LANG = (p) => (/\.kts?$/.test(p) ? 'kotlin' : /\.(c|m)?[jt]sx?$/.test(p) ? 'ts' : /\.py$/.test(p) ? 'python' : /\.java$/.test(p) ? 'java' : null);
const DECL_RE = /^\s*(export\s+)?(public\s+|internal\s+|private\s+)?(abstract\s+|sealed\s+|open\s+|data\s+)?(class|interface|enum|type|object|record)\b/;

function stub(lang, signature, task) {
  const sig = String(signature).trim().replace(/\s*[{;]\s*$/, '');
  const todo = `${task.id}: ${String(task.title || '').replace(/["'`\\]/g, '').slice(0, 60)}`;
  if (DECL_RE.test(sig)) {
    if (lang === 'ts' && /\btype\b/.test(sig)) return /=/.test(sig) ? `${sig};` : `${sig} = unknown; // TODO ${todo}`;
    if (lang === 'python') return `${sig.replace(/:$/, '')}:\n    pass  # TODO ${todo}`;
    if (lang === 'kotlin' && /\bdata\s+class\b/.test(sig)) return sig; // data class needs its constructor, kept as declared
    return `${sig} {\n  // TODO ${todo}\n}`;
  }
  if (lang === 'kotlin') return /\)\s*:\s*Unit\s*$/.test(sig) || !/\)\s*:/.test(sig) ? `${sig} { TODO("${todo}") }` : `${sig} = TODO("${todo}")`;
  if (lang === 'ts') return `${sig.startsWith('export') ? sig : `export ${sig}`} {\n  throw new Error('TODO ${todo}');\n}`;
  if (lang === 'python') return `${sig.replace(/:$/, '')}:\n    raise NotImplementedError("${todo}")`;
  if (lang === 'java') return `  ${sig} {\n    throw new UnsupportedOperationException("TODO ${todo}");\n  }`;
  return null;
}

function nameOf(sig) {
  const m = /(?:fun|function|def|class|interface|enum|type|object|record)\s+(?:<[^>]+>\s*)?([A-Za-z_$][\w$]*)/.exec(sig) || /([A-Za-z_$][\w$]*)\s*\(/.exec(sig);
  return m ? m[1] : null;
}

function plan(root, doc, pack, options = {}) {
  const only = options.tasks ? new Set(String(options.tasks).split(',').map((x) => x.trim().toUpperCase())) : null;
  const byPath = new Map();
  const missingSignature = [];
  for (const t of ((doc && doc.tasks) || []).filter((x) => x && !x.done && (!only || only.has(x.id)))) {
    const entry = ((pack && pack.tasks) || []).find((x) => x && (x.id === t.id || x.task === t.id));
    for (const s of (entry && entry.symbols) || []) {
      const p = String(s.path || s.file || '').replace(/\\/g, '/');
      const lang = LANG(p);
      if (!p || !lang) continue;
      if (!s.signature) { missingSignature.push(`${t.id}: ${s.name} (${p}) sem signature no pack — o esqueleto não compilaria contra os testes`); continue; }
      const abs = path.join(root, p);
      const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const name = s.name || nameOf(s.signature);
      if (text && name && new RegExp(`\\b${name}\\b`).test(text)) continue;
      const body = stub(lang, s.signature, t);
      if (!body) continue;
      if (!byPath.has(p)) byPath.set(p, { path: p, lang, exists: Boolean(text), stubs: [] });
      byPath.get(p).stubs.push({ task: t.id, name, body });
    }
  }
  return { files: [...byPath.values()], missing_signature: missingSignature };
}

function headerFor(lang, p, root) {
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

function write(root, planned) {
  const written = [];
  for (const f of planned.files) {
    const abs = path.join(root, f.path);
    const bodies = f.stubs.map((s) => s.body);
    let text;
    if (f.lang === 'java') {
      const cls = path.basename(f.path, '.java');
      if (f.exists) {
        const cur = fs.readFileSync(abs, 'utf8');
        const at = cur.lastIndexOf('}');
        text = at >= 0 ? `${cur.slice(0, at).replace(/\s*$/, '\n')}\n${bodies.join('\n\n')}\n}\n` : `${cur}\n${bodies.join('\n\n')}\n`;
      } else text = `${headerFor('java', f.path, root)}public class ${cls} {\n${bodies.join('\n\n')}\n}\n`;
    } else {
      const cur = f.exists ? fs.readFileSync(abs, 'utf8').replace(/\s*$/, '\n\n') : headerFor(f.lang, f.path, root);
      text = `${cur}${bodies.join('\n\n')}\n`;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    written.push({ path: f.path, stubs: f.stubs.map((s) => `${s.task}:${s.name}`) });
  }
  return written;
}

module.exports = { stub, nameOf, plan, write, LANG };
