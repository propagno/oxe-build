'use strict';

const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.oxe', 'dist', 'build', 'coverage', '.next', '.turbo', 'out', 'target']);
const SUPPORTED_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.kt', '.java']);

function walkSourceFiles(root, maxFiles = 400) {
  const results = [];
  const stack = [root];
  while (stack.length && results.length < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) stack.push(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) results.push(path.join(dir, ent.name));
      }
    }
  }
  return results.sort();
}

/** Extract exported/top-level symbols and relative imports from a source file without native deps. */
function extractFileSymbols(content, ext) {
  const symbols = [];
  const imports = [];
  const seenSym = new Set();
  const seenImp = new Set();
  const addSym = (kind, name) => {
    const key = `${kind}:${name}`;
    if (!name || seenSym.has(key)) return;
    seenSym.add(key);
    symbols.push({ kind, name });
  };
  const addImp = (spec) => {
    if (!spec || seenImp.has(spec)) return;
    seenImp.add(spec);
    imports.push(spec);
  };

  if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
    for (const m of content.matchAll(/(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) addSym('fn', m[1]);
    for (const m of content.matchAll(/(?:^|\n)\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/g)) addSym('class', m[1]);
    for (const m of content.matchAll(/(?:^|\n)\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) addSym('type', m[1]);
    for (const m of content.matchAll(/(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) addSym('const', m[1]);
    for (const m of content.matchAll(/(?:import\s+[^'"]*from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) addImp(m[1]);
    }
  } else if (ext === '.py') {
    for (const m of content.matchAll(/(?:^|\n)def\s+([A-Za-z_][\w]*)\s*\(/g)) addSym('fn', m[1]);
    for (const m of content.matchAll(/(?:^|\n)class\s+([A-Za-z_][\w]*)/g)) addSym('class', m[1]);
    for (const m of content.matchAll(/(?:^|\n)from\s+(\.[A-Za-z0-9_.]*)\s+import/g)) addImp(m[1]);
  } else if (ext === '.go') {
    for (const m of content.matchAll(/(?:^|\n)func\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)\s*\(/g)) addSym('fn', m[1]);
    for (const m of content.matchAll(/(?:^|\n)type\s+([A-Z][\w]*)\s+(?:struct|interface)/g)) addSym('type', m[1]);
  } else if (ext === '.rs') {
    for (const m of content.matchAll(/(?:^|\n)\s*pub\s+(?:async\s+)?fn\s+([A-Za-z_][\w]*)/g)) addSym('fn', m[1]);
    for (const m of content.matchAll(/(?:^|\n)\s*pub\s+(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/g)) addSym('type', m[1]);
  } else if (ext === '.kt' || ext === '.java') {
    for (const m of content.matchAll(/(?:^|\n)\s*(?:public\s+|internal\s+)?(?:data\s+|sealed\s+)?(?:class|interface|object|enum)\s+([A-Za-z_][\w]*)/g)) addSym('class', m[1]);
    for (const m of content.matchAll(/(?:^|\n)\s*(?:public\s+|suspend\s+)?fun\s+([A-Za-z_][\w]*)\s*\(/g)) addSym('fn', m[1]);
  }

  return { symbols: symbols.slice(0, 30), imports: imports.slice(0, 20) };
}

/**
 * Build a compact AST-free structural repo map + reverse-import index within a character budget.
 * @param {string} projectRoot
 * @param {{ maxFiles?: number, maxChars?: number, focusPrefixes?: string[] }} [options]
 */
function buildRepoMap(projectRoot, options = {}) {
  const maxFiles = Number(options.maxFiles) > 0 ? Number(options.maxFiles) : 250;
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : 24_000;
  const focus = Array.isArray(options.focusPrefixes) ? options.focusPrefixes.map((p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')) : [];

  const allFiles = walkSourceFiles(projectRoot, maxFiles * 2);
  const files = [];
  const referencedBy = {};

  for (const abs of allFiles) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    if (focus.length && !focus.some((pref) => rel === pref || rel.startsWith(pref))) continue;
    if (files.length >= maxFiles) break;
    let content = '';
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (content.length > 256_000) continue;
    const ext = path.extname(rel).toLowerCase();
    const { symbols, imports } = extractFileSymbols(content, ext);
    files.push({ path: rel, symbols, imports });

    for (const imp of imports) {
      const resolvedBase = path.posix.normalize(path.posix.join(path.posix.dirname(rel), imp));
      if (!referencedBy[resolvedBase]) referencedBy[resolvedBase] = [];
      if (!referencedBy[resolvedBase].includes(rel)) referencedBy[resolvedBase].push(rel);
    }
  }

  const lines = ['# Repo Map (symbols & relative imports)', ''];
  let chars = lines.join('\n').length;
  let truncated = false;
  for (const f of files) {
    if (!f.symbols.length && !f.imports.length) continue;
    const symStr = f.symbols.map((s) => `${s.kind}:${s.name}`).join(', ');
    const impStr = f.imports.length ? ` | imports: ${f.imports.slice(0, 6).join(', ')}` : '';
    const line = `- ${f.path}: ${symStr || '(no exports)'}${impStr}`;
    if (chars + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  if (truncated) lines.push('... (truncated to maxChars budget)');

  return {
    schema_version: 1,
    total_files: files.length,
    truncated,
    files,
    referenced_by: referencedBy,
    markdown: `${lines.join('\n')}\n`,
  };
}

module.exports = {
  buildRepoMap,
  extractFileSymbols,
};
