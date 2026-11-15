#!/usr/bin/env node
'use strict';

/**
 * OXB-088: the contract of a removal task is what must NOT exist after it. IMPLEMENTATION-PACK task fields:
 *   removed_paths:   ["electron/main/ai-memory/index.ts", …]   must not exist after the task
 *   symbols_removed: [{ name: "registerMemoryIpc", path: "electron/main/ipc.ts" }]   export absent (or file gone)
 * This file is appended to the task's verify (like the pack's files_exist / exports_expected checks for presence):
 *   node oxe-pack-removed.cjs --pack <IMPLEMENTATION-PACK.json> --task T14 [--root <project>]   → exit 0 | 1
 * Before the task the removals still exist: the right red (an assertion), for the dry-verify too.
 */

const fs = require('fs');
const path = require('path');

function removalOf(entry) {
  const removedPaths = (Array.isArray(entry && entry.removed_paths) ? entry.removed_paths : []).map((p) => String(p || '').trim()).filter(Boolean);
  const symbolsRemoved = (Array.isArray(entry && entry.symbols_removed) ? entry.symbols_removed : [])
    .filter((s) => s && typeof s === 'object' && s.name && s.path)
    .map((s) => ({ name: String(s.name).trim(), path: String(s.path).trim() }));
  return { removedPaths, symbolsRemoved };
}

/** Mask JS/TS comments with spaces and string interiors with spaces (preserving string quotes) in a single pass. */
function maskModuleSource(source) {
  const s = String(source || '');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '/' && s[i + 1] === '/') {
      let end = s.indexOf('\n', i + 2);
      if (end < 0) end = s.length;
      out += ' '.repeat(end - i);
      i = end - 1;
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end < 0 ? s.length : end + 2;
      out += s.slice(i, stop).replace(/[^\r\n]/g, ' ');
      i = stop - 1;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      for (; j < s.length && s[j] !== ch; j += 1) if (s[j] === '\\') j += 1;
      const raw = s.slice(i + 1, j);
      // Keep simple identifier string literals on `exports['foo']` intact while masking everything else
      if (/^[A-Za-z_$][\w$]*$/.test(raw)) out += `${ch}${raw}${j < s.length ? ch : ''}`;
      else out += `${ch}${raw.replace(/[^\r\n]/g, ' ')}${j < s.length ? ch : ''}`;
      i = j;
    } else {
      out += ch;
    }
  }
  return out;
}

function balancedSlice(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

function splitTopLevelCommas(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function topLevelIndexOf(text, target) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === target && depth === 0) return i;
  }
  return -1;
}

function addDestructuredNames(pattern, add) {
  const open = pattern[0];
  const body = balancedSlice(pattern, 0);
  if (body == null) return;
  for (const raw of splitTopLevelCommas(body)) {
    let part = raw.replace(/^\.\.\./, '').trim();
    const eqIdx = topLevelIndexOf(part, '=');
    if (eqIdx >= 0) part = part.slice(0, eqIdx).trim();
    if (!part) continue;
    if (open === '{') {
      const colonIdx = topLevelIndexOf(part, ':');
      if (colonIdx >= 0) {
        let rhs = part.slice(colonIdx + 1).trim();
        const rhsEq = topLevelIndexOf(rhs, '=');
        if (rhsEq >= 0) rhs = rhs.slice(0, rhsEq).trim();
        if (rhs.startsWith('{') || rhs.startsWith('[')) addDestructuredNames(rhs, add);
        else add(rhs);
      } else add(part);
    } else if (part.startsWith('{') || part.startsWith('[')) {
      addDestructuredNames(part, add);
    } else {
      add(part);
    }
  }
}

/** Exported names of a module: single-pass comment/string-safe scanner covering ESM, TS types, destructuring, and CJS. */
function scanModuleExports(source) {
  const text = maskModuleSource(source);
  const out = new Set();
  const add = (name) => { if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name); };

  for (const m of text.matchAll(/\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\bexport\s+default\b/g)) add('default');
  for (const m of text.matchAll(/\bexport\s+(?:declare\s+)?(?:const|let|var)\s*(\{|\[)/g)) {
    addDestructuredNames(text.slice(m.index + m[0].length - 1), add);
  }
  for (const m of text.matchAll(/\bexport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\b/g)) add(m[1]);
  for (const m of text.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const spec = part.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(spec);
      if (alias) add(alias[2] || alias[1]);
    }
  }
  for (const m of text.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
  for (const m of text.matchAll(/\b(?:module\.)?exports\[\s*(['"`])([A-Za-z_$][\w$]*)\1\s*\]\s*=/g)) add(m[2]);
  for (const m of text.matchAll(/\bmodule\.exports\s*=\s*/g)) {
    const rest = text.slice(m.index + m[0].length);
    if (rest.startsWith('{')) {
      const body = balancedSlice(rest, 0);
      if (body == null) continue;
      for (const part of splitTopLevelCommas(body)) {
        if (part.startsWith('...')) continue;
        const method = /^(?:async\s+)?\*?\s*(?:(['"`])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*\(/.exec(part);
        if (method && !part.includes(':')) { add(method[2] || method[3]); continue; }
        const keyed = /^(?:(['"`])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(part);
        if (keyed) add(keyed[2] || keyed[3]);
      }
    } else {
      const named = /^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*;?)/.exec(rest);
      add('default');
      if (named) add(named[1] || named[2] || named[3]);
    }
  }
  return [...out];
}

/** Exported names of a module. */
function moduleExports(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  return scanModuleExports(text);
}

/** @returns {{ ok: boolean, problems: string[] }} */
function checkRemoval(projectRoot, entry) {
  const { removedPaths, symbolsRemoved } = removalOf(entry);
  const problems = [];
  for (const p of removedPaths) if (fs.existsSync(path.resolve(projectRoot, p))) problems.push(`${p} ainda existe (removed_paths)`);
  for (const s of symbolsRemoved) {
    const abs = path.resolve(projectRoot, s.path);
    if (!fs.existsSync(abs)) continue; // the file is gone: so is the export
    let names = [];
    try { names = moduleExports(abs); } catch { names = []; }
    if (names.includes(s.name)) problems.push(`${s.path} ainda exporta ${s.name} (symbols_removed)`);
  }
  return { ok: problems.length === 0, problems };
}

function checkCommand(packPath, taskId) {
  return `node "${__filename}" --pack "${packPath}" --task ${taskId}`;
}

function findProjectRoot(fromFile) {
  let dir = path.dirname(path.resolve(fromFile));
  while (dir && path.basename(dir) !== '.oxe' && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return path.basename(dir) === '.oxe' ? path.dirname(dir) : process.cwd();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const packPath = get('--pack');
  const taskId = get('--task');
  if (!packPath || !taskId) { console.error('uso: oxe-pack-removed --pack <IMPLEMENTATION-PACK.json> --task T14 [--root <projeto>]'); process.exit(2); }
  let pack;
  try { pack = JSON.parse(fs.readFileSync(packPath, 'utf8')); } catch { console.error(`${packPath} ilegível`); process.exit(2); }
  const entry = (pack.tasks || []).find((t) => t && String(t.id || t.task_id) === taskId);
  if (!entry) { console.error(`${taskId} não está em ${packPath}`); process.exit(2); }
  const res = checkRemoval(get('--root') || findProjectRoot(packPath), entry);
  if (res.ok) { console.log(`removal ${taskId}: ${removalOf(entry).removedPaths.length} caminho(s) e ${removalOf(entry).symbolsRemoved.length} export(s) removidos`); process.exit(0); }
  for (const p of res.problems) console.error(`AssertionError: removal ${taskId}: ${p}`);
  process.exit(1);
}

module.exports = { removalOf, checkRemoval, checkCommand, moduleExports, scanModuleExports };
