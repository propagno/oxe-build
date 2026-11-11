#!/usr/bin/env node
'use strict';

/**
 * OXB-049: a reference anchor with `<action>copy</action>` becomes an automatic verify check — what the task copied must
 * match the source. In the oxespace 1.5.0 F1, T5 (icons) passed its frozen test (one module per icon, currentColor,
 * aria-hidden), but 4 icons were Lucide copies without the Mandacaru marks and History was the clock, not the approved
 * scrubber: the approved drawing was in playground/src/components/icons.ts and nothing compared geometry.
 *
 * Anchor attributes (REFERENCE-ANCHORS.md):
 *   path="playground/src/components/icons.ts"   the source (already an anchor attribute)
 *   target="src/design/icons/index.ts"           the file the task writes (OXB-049)
 *   symbols="History,Mic,Send"                   optional: compare these declarations (else the whole file, or snippet_ref)
 *   compare="geometry|exact"                     geometry = SVG geometry (d, points, viewBox, cx, …); exact = normalized
 *                                                text of the declaration body. Default: geometry when the source has SVG
 *                                                geometry, else exact.
 *   snippet_ref="lines 10-30"                    without symbols: those source lines must appear in the target.
 *
 * CLI: node oxe-anchor-copy.cjs --anchors <REFERENCE-ANCHORS.md> --id RA-01 [--root <project>]  → exit 0 | 1
 */

const fs = require('fs');
const path = require('path');

function parseAttrs(fragment) {
  const attrs = {};
  for (const m of String(fragment || '').matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

/** Copy anchors of a REFERENCE-ANCHORS.md: [{ id, task, path, target, symbols[], compare, snippet }]. */
function copyAnchors(text) {
  const root = /<reference_anchors\b[^>]*>([\s\S]*?)<\/reference_anchors>/i.exec(String(text || ''));
  if (!root) return [];
  const out = [];
  for (const m of root[1].matchAll(/<anchor\b([^>]*)>([\s\S]*?)<\/anchor>/gi)) {
    const attrs = parseAttrs(m[1]);
    const action = String(attrs.action || ((/<action>([\s\S]*?)<\/action>/i.exec(m[2]) || [])[1]) || '').trim().toLowerCase();
    if (!/^(copy|copiar)\b/.test(action)) continue;
    out.push({
      id: attrs.id || null,
      task: attrs.task || null,
      path: attrs.path || null,
      target: attrs.target || null,
      symbols: String(attrs.symbols || '').split(',').map((s) => s.trim()).filter(Boolean),
      compare: attrs.compare || null,
      snippet: attrs.snippet_ref || null,
    });
  }
  return out;
}

/** The declaration of `name` (const/let/var/function/class, or an object key), up to its balanced end. */
function extractSymbol(source, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const starts = [
    new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?(?:default\\s+)?(?:const|let|var|function\\*?|class)\\s+${esc}\\b`),
    new RegExp(`(?:^|[\\s,{])['"]?${esc}['"]?\\s*:`),
  ];
  let at = -1;
  for (const re of starts) { const m = re.exec(source); if (m) { at = m.index + (m[0].startsWith('\n') ? 1 : 0); break; } }
  if (at < 0) return null;
  let depth = 0;
  let opened = false;
  let quote = null;
  for (let i = at; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth += 1; opened = true; continue; }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (opened && depth <= 0) {
        // the statement may continue (`) => (`, `= {` …): stop at ; , or a newline that does not continue it
        const rest = source.slice(i + 1);
        const next = /^\s*(\S)/.exec(rest);
        if (!next || /[;,}\n]/.test(next[1]) || !/^[\s]*[=.(?:<&|+\-*/]/.test(rest)) return source.slice(at, i + 1);
      }
      if (depth < 0) return source.slice(at, i);
    }
    if (!opened && (ch === ';' || ch === '\n') && i > at + name.length + 8) return source.slice(at, i);
  }
  return source.slice(at);
}

const GEOMETRY_ATTRS = ['d', 'points', 'viewBox', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'transform'];

/** SVG geometry tokens in order: `attr=value` for JSX/HTML attributes and object keys (`d: '…'`). */
function geometry(text) {
  const out = [];
  const re = new RegExp(`(?:^|[\\s{,(])(${GEOMETRY_ATTRS.join('|')})\\s*[=:]\\s*(?:\\{\\s*)?(["'\`])([^"'\`]*)\\2`, 'g');
  for (const m of String(text || '').matchAll(re)) out.push(`${m[1]}=${m[3].replace(/\s+/g, ' ').replace(/\s*([,MmLlHhVvCcSsQqTtAaZz])\s*/g, '$1').trim()}`);
  return out;
}

const normalize = (text) => String(text || '').replace(/\r\n/g, '\n').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/["'`]/g, '"').replace(/\s+/g, '').replace(/;+/g, ';');
/** The declaration without its leading keyword/export (a copy may rename `const` to `export const`). */
const body = (decl) => normalize(String(decl || '').replace(/^[\s]*(?:export\s+)?(?:default\s+)?(?:const|let|var|function\*?|class)\s+/, ''));

/**
 * @returns {{ ok: boolean, problems: string[], compared: number }}
 */
function checkAnchor(projectRoot, anchor) {
  const problems = [];
  if (!anchor.path || !anchor.target) return { ok: false, problems: [`${anchor.id}: âncora copy sem path/target`], compared: 0 };
  const read = (p) => { try { return fs.readFileSync(path.resolve(projectRoot, p), 'utf8'); } catch { return null; } };
  const source = read(anchor.path);
  const target = read(anchor.target);
  if (source == null) return { ok: false, problems: [`${anchor.id}: fonte ${anchor.path} não encontrada`], compared: 0 };
  if (target == null) return { ok: false, problems: [`${anchor.id}: alvo ${anchor.target} não encontrado (a tarefa copia para ele)`], compared: 0 };
  const mode = anchor.compare || (geometry(source).length ? 'geometry' : 'exact');
  let compared = 0;
  const compareBlocks = (label, a, b) => {
    compared += 1;
    if (mode === 'geometry') {
      const ga = geometry(a);
      const gb = geometry(b);
      if (!ga.length) { problems.push(`${label}: a fonte não tem geometria SVG — use compare="exact"`); return; }
      if (JSON.stringify(ga) !== JSON.stringify(gb)) {
        const firstDiff = ga.findIndex((g, i) => g !== gb[i]);
        problems.push(`${label}: a geometria difere da fonte (${ga.length} traço(s) na fonte, ${gb.length} no alvo; primeiro diferente: ${(ga[firstDiff] || ga[ga.length - 1] || '').slice(0, 80)} × ${(gb[firstDiff] || '—').slice(0, 80)})`);
      }
    } else if (body(a) !== body(b)) {
      problems.push(`${label}: o trecho copiado difere da fonte (compare="exact", espaços e aspas ignorados)`);
    }
  };
  if (anchor.symbols.length) {
    for (const name of anchor.symbols) {
      const a = extractSymbol(source, name);
      const b = extractSymbol(target, name);
      if (!a) { problems.push(`${anchor.id} ${name}: não encontrado na fonte ${anchor.path}`); continue; }
      if (!b) { problems.push(`${anchor.id} ${name}: não encontrado no alvo ${anchor.target}`); continue; }
      compareBlocks(`${anchor.id} ${name}`, a, b);
    }
  } else if (anchor.snippet && /lines?\s+(\d+)\s*-\s*(\d+)/i.test(anchor.snippet)) {
    const [, from, to] = /lines?\s+(\d+)\s*-\s*(\d+)/i.exec(anchor.snippet);
    const snippet = source.replace(/\r\n/g, '\n').split('\n').slice(Number(from) - 1, Number(to)).join('\n');
    compared += 1;
    if (mode === 'geometry' && geometry(snippet).length) {
      const gs = geometry(snippet);
      const gt = geometry(target);
      const ok = gs.every((g) => gt.includes(g));
      if (!ok) problems.push(`${anchor.id}: a geometria das linhas ${from}-${to} da fonte não está no alvo ${anchor.target}`);
    } else if (!normalize(target).includes(normalize(snippet))) {
      problems.push(`${anchor.id}: as linhas ${from}-${to} de ${anchor.path} não estão em ${anchor.target}`);
    }
  } else {
    compareBlocks(`${anchor.id} ${anchor.target}`, source, target);
  }
  return { ok: problems.length === 0, problems, compared };
}

/** The check command a task's verify runs for one anchor (node + this file; quoted for cmd.exe and sh). */
function checkCommand(anchorsFile, anchorId) {
  return `node "${__filename}" --anchors "${anchorsFile}" --id ${anchorId}`;
}

/**
 * Appends the copy checks of REFERENCE-ANCHORS.md (next to PLAN.md) to each bound task's verifyCommand, so the task's
 * own verify (and the phase verify) fails when the copy does not match the source.
 */
function attachAnchorCopyChecks(parsedPlan, planPath) {
  if (!parsedPlan || !Array.isArray(parsedPlan.tasks) || !planPath) return parsedPlan;
  const anchorsFile = path.join(path.dirname(planPath), 'REFERENCE-ANCHORS.md');
  let text = '';
  try { text = fs.readFileSync(anchorsFile, 'utf8'); } catch { return parsedPlan; }
  const anchors = copyAnchors(text).filter((a) => a.task && a.path && a.target && a.id);
  if (!anchors.length) return parsedPlan;
  for (const task of parsedPlan.tasks) {
    if (task.done) continue;
    const mine = anchors.filter((a) => a.task === task.id);
    if (!mine.length) continue;
    const cmds = mine.map((a) => checkCommand(anchorsFile, a.id)).filter((c) => !String(task.verifyCommand || '').includes(c));
    if (!cmds.length) continue;
    task.verifyCommand = [task.verifyCommand, ...cmds].filter(Boolean).join(' && ');
    task.meta = { ...(task.meta || {}), anchor_copy_checks: mine.map((a) => a.id) };
  }
  return parsedPlan;
}

/** Lint: copy anchors that cannot be checked (no target) or whose task is not in the plan. */
function lintCopyAnchors(text, planTaskIds) {
  const warnings = [];
  for (const a of copyAnchors(text)) {
    if (!a.target) warnings.push(`âncora ${a.id || '?'} (copy) sem target="<arquivo que a tarefa escreve>" — o verify não tem como comparar a cópia com ${a.path || 'a fonte'}`);
    else if (a.task && planTaskIds && !planTaskIds.includes(a.task)) warnings.push(`âncora ${a.id || '?'} (copy) aponta para a tarefa ${a.task}, que não está no plano`);
  }
  return warnings;
}

function findProjectRoot(fromFile) {
  let dir = path.dirname(path.resolve(fromFile));
  while (dir && path.basename(dir) !== '.oxe' && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return path.basename(dir) === '.oxe' ? path.dirname(dir) : process.cwd();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const file = get('--anchors');
  const id = get('--id');
  if (!file || !id) { console.error('uso: oxe-anchor-copy --anchors <REFERENCE-ANCHORS.md> --id RA-01 [--root <projeto>]'); process.exit(2); }
  const root = get('--root') || findProjectRoot(file);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { console.error(`${file} não encontrado`); process.exit(2); }
  const anchor = copyAnchors(text).find((a) => a.id === id);
  if (!anchor) { console.error(`âncora ${id} (copy) não encontrada em ${file}`); process.exit(2); }
  const res = checkAnchor(root, anchor);
  if (res.ok) { console.log(`anchor ${id}: cópia confere com ${anchor.path} (${res.compared} trecho(s))`); process.exit(0); }
  for (const p of res.problems) console.error(/não encontrado/.test(p) ? `anchor ${p}` : `AssertionError: anchor ${p}`);
  process.exit(1);
}

module.exports = { copyAnchors, extractSymbol, geometry, checkAnchor, attachAnchorCopyChecks, lintCopyAnchors, checkCommand };
