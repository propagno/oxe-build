'use strict';

/**
 * OXB-115: complexity alarm. For the functions the phase touched (JS/TS/Kotlin/Java), a decision-point count
 * (1 + if / for / while / case / catch / && / || / ?? / ternary) now vs the phase's base. A function above the limit
 * (`complexity.max`, default 15) that is new or grew by ≥ `complexity.max_growth` (default 5) gets a refactoring
 * proposal in `.oxe/REFACTOR-PROPOSALS.md`. Profile `strict` (or `complexity.block: true`) blocks the close.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;
const DECISION_RE = /\b(if|for|while|case|catch)\b|&&|\|\||\?\?|\?(?![.?:])/g;
const START_RES = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*\{/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*\{/g,
  /^\s*(?:public|private|protected|static|async|override|suspend|\s)*\b(?!if\b|for\b|while\b|switch\b|catch\b|return\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm,
  /\bfun\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{=]*\{/g,
];

/** Strings and comments blanked (kept length) so braces and keywords inside them do not count. */
function strip(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** { name, line, complexity } for each function body found. */
function functionsOf(text) {
  const src = strip(text);
  const found = new Map();
  for (const re of START_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const open = src.indexOf('{', m.index + m[0].length - 1);
      if (open < 0) continue;
      let depth = 0;
      let end = -1;
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${m[1]}@${line}`;
      if (found.has(key)) continue;
      const body = src.slice(open, end + 1);
      found.set(key, { name: m[1], line, complexity: 1 + (body.match(DECISION_RE) || []).length });
    }
  }
  // a nested function's decisions also count in its parent: fine for an alarm (the parent is what reads hard)
  return [...found.values()];
}

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function changedFiles(root, base) {
  const out = new Set();
  for (const l of (git(root, ['diff', '--name-only', base, '--']).stdout || '').split(/\r?\n/)) if (l.trim()) out.add(l.trim());
  for (const l of (git(root, ['ls-files', '--others', '--exclude-standard']).stdout || '').split(/\r?\n/)) if (l.trim()) out.add(l.trim());
  return [...out].filter((f) => CODE_RE.test(f) && !TEST_RE.test(f) && fs.existsSync(path.join(root, f)));
}

function settings(cfg) {
  const c = (cfg && cfg.complexity) || {};
  return { max: Number(c.max) > 0 ? Number(c.max) : 15, growth: Number(c.max_growth) > 0 ? Number(c.max_growth) : 5, block: c.block === true || (cfg && cfg.profile === 'strict') };
}

/** @returns {{ alarms: Array<{file,name,line,before,after,reason}>, block: boolean, max, growth }} */
function complexityAlarms(root, base, cfg = {}) {
  const s = settings(cfg);
  const alarms = [];
  for (const file of changedFiles(root, base)) {
    let now = '';
    try { now = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    const beforeText = git(root, ['show', `${base}:${file}`]).stdout || '';
    const before = new Map(functionsOf(beforeText).map((f) => [f.name, f.complexity]));
    for (const f of functionsOf(now)) {
      if (f.complexity <= s.max) continue;
      const prev = before.get(f.name);
      if (prev == null) alarms.push({ file, name: f.name, line: f.line, before: null, after: f.complexity, reason: 'nova acima do limite' });
      else if (f.complexity - prev >= s.growth) alarms.push({ file, name: f.name, line: f.line, before: prev, after: f.complexity, reason: `cresceu ${f.complexity - prev}` });
    }
  }
  return { alarms, block: s.block, max: s.max, growth: s.growth };
}

function writeProposals(root, res, phase) {
  const L = ['# Propostas de refatoração', '', `Fase ${phase || '—'} · limite ${res.max} pontos de decisão · crescimento ${res.growth}${res.block ? ' · modo strict: bloqueia o close' : ''}`, ''];
  if (!res.alarms.length) L.push('Nenhuma função tocada passou do limite.');
  for (const a of res.alarms) {
    L.push(`## \`${a.name}\` — ${a.file}:${a.line}`, '', `- Complexidade: ${a.before == null ? 'nova' : a.before} → **${a.after}** (${a.reason})`, '- Proposta: extraia os ramos em funções nomeadas pelo que decidem, troque cadeias de if/else por uma tabela de casos, e mova validações para um guard no topo.', '');
  }
  fs.mkdirSync(path.join(root, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(root, '.oxe', 'REFACTOR-PROPOSALS.md'), `${L.join('\n')}\n`);
  return '.oxe/REFACTOR-PROPOSALS.md';
}

module.exports = { functionsOf, complexityAlarms, writeProposals, settings };
