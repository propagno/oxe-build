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

/** Exported names of a module: the compiled runtime's reader when available, else a regex fallback. */
function moduleExports(abs) {
  try {
    const runtime = require(path.join(__dirname, '..', '..', 'lib', 'runtime'));
    if (runtime && typeof runtime.readModuleExports === 'function') {
      const names = runtime.readModuleExports(abs);
      if (Array.isArray(names)) return names.map((n) => (typeof n === 'string' ? n : n && n.name)).filter(Boolean);
    }
  } catch { /* fallback below */ }
  const text = fs.readFileSync(abs, 'utf8');
  const out = new Set();
  for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  for (const m of text.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]);
  for (const m of text.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(':')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n); }
  return [...out];
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

module.exports = { removalOf, checkRemoval, checkCommand, moduleExports };
