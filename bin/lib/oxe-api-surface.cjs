'use strict';

/**
 * OXB-116: the phase's API surface diff — exports and their signatures, IPC channels and MCP tools, before (the phase's
 * base) and after (the tree). Written to the phase dossier (`api-surface.md`); a change to an export outside the pack's
 * `symbols` / `symbols_removed` is flagged (an interface nobody planned to change).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CODE_RE = /\.(c|m)?[jt]sx?$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Surface of one file: Map key → signature. Keys: `export:<name>`, `ipc:<channel>`, `mcp:<tool>`. */
function surfaceOf(text) {
  const out = new Map();
  const src = String(text || '');
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(\([^)]*\))\s*(:\s*[^{]+)?/g)) out.set(`export:${m[1]}`, norm(`function ${m[1]}${m[2]}${m[3] || ''}`));
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(:\s*[^=]+)?=\s*(?:async\s*)?(\([^)]*\))?/g)) out.set(`export:${m[1]}`, norm(`const ${m[1]}${m[2] || ''}${m[3] ? ` = ${m[3]} =>` : ''}`));
  for (const m of src.matchAll(/export\s+(?:abstract\s+)?(class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) out.set(`export:${m[2]}`, `${m[1]} ${m[2]}`);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) if (!out.has(`export:${n}`)) out.set(`export:${n}`, `export ${n}`);
  for (const m of src.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\w*\s*)?(\([^)]*\))?/g)) out.set(`export:${m[1]}`, norm(`${m[1]}${m[2] || ''}`));
  for (const m of src.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) for (const n of m[1].split(',').map((x) => x.trim().split(':')[0].trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x))) if (!out.has(`export:${n}`)) out.set(`export:${n}`, `export ${n}`);
  for (const m of src.matchAll(/\bipc(?:Main|Renderer)\.(?:handle|handleOnce|on|once|invoke|send|sendSync)\(\s*['"`]([^'"`]+)['"`]/g)) out.set(`ipc:${m[1]}`, `ipc ${m[1]}`);
  for (const m of src.matchAll(/\b(?:registerTool|server\.tool|addTool)\(\s*['"`]([a-z][\w.-]*)['"`]/g)) out.set(`mcp:${m[1]}`, `mcp ${m[1]}`);
  for (const m of src.matchAll(/\bname\s*:\s*['"`]([a-z][a-z0-9_]*)['"`][\s\S]{0,400}?\binputSchema\b/g)) out.set(`mcp:${m[1]}`, `mcp ${m[1]}`);
  return out;
}

function changedFiles(root, base) {
  const out = new Map();
  for (const l of (git(root, ['diff', '--name-status', base, '--']).stdout || '').split(/\r?\n/)) {
    const m = /^([AMDRC])\d*\t(?:([^\t]+)\t)?(.+)$/.exec(l);
    if (!m) continue;
    if (m[2]) out.set(m[2], 'D');
    out.set(m[3], m[1] === 'D' ? 'D' : 'M');
  }
  for (const l of (git(root, ['ls-files', '--others', '--exclude-standard']).stdout || '').split(/\r?\n/)) if (l.trim()) out.set(l.trim(), 'M');
  return [...out].filter(([f]) => CODE_RE.test(f) && !TEST_RE.test(f));
}

/** @returns {{ added, removed, changed, flagged }} each an array of { file, key, before?, after? } */
function apiDiff(root, base, pack) {
  const declared = new Set();
  for (const t of (pack && Array.isArray(pack.tasks) ? pack.tasks : [])) {
    for (const s of [...(t.symbols || []), ...(t.symbols_removed || [])]) if (s && s.name) declared.add(String(s.name));
  }
  const res = { added: [], removed: [], changed: [], flagged: [] };
  for (const [file, status] of changedFiles(root, base)) {
    const before = surfaceOf(git(root, ['show', `${base}:${file}`]).stdout || '');
    let nowText = '';
    if (status !== 'D') { try { nowText = fs.readFileSync(path.join(root, file), 'utf8'); } catch { nowText = ''; } }
    const after = surfaceOf(nowText);
    for (const [k, sig] of after) {
      if (!before.has(k)) res.added.push({ file, key: k, after: sig });
      else if (before.get(k) !== sig) res.changed.push({ file, key: k, before: before.get(k), after: sig });
    }
    for (const [k, sig] of before) if (!after.has(k)) res.removed.push({ file, key: k, before: sig });
  }
  for (const x of [...res.added, ...res.removed, ...res.changed]) {
    const name = x.key.replace(/^\w+:/, '');
    if (x.key.startsWith('export:') && !declared.has(name)) res.flagged.push({ ...x, why: 'export fora dos symbols/symbols_removed do pack' });
  }
  return res;
}

function renderApiDiff(d, phase, base) {
  const L = ['# Superfície de API da fase', '', `Fase ${phase || '—'} · base ${String(base || '').slice(0, 10)} → árvore`, ''];
  const sec = (title, list, fmt) => { L.push(`## ${title} (${list.length})`, ''); if (!list.length) L.push('—'); for (const x of list) L.push(`- ${fmt(x)}`); L.push(''); };
  sec('Adicionado', d.added, (x) => `\`${x.after}\` — ${x.file}`);
  sec('Removido', d.removed, (x) => `\`${x.before}\` — ${x.file}`);
  sec('Assinatura mudou', d.changed, (x) => `\`${x.before}\` → \`${x.after}\` — ${x.file}`);
  sec('Sinalizado: mudança que o pack não declarou', d.flagged, (x) => `\`${x.key}\` (${x.file}) — ${x.why}`);
  return `${L.join('\n')}\n`;
}

module.exports = { surfaceOf, apiDiff, renderApiDiff };
