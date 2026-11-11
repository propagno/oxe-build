#!/usr/bin/env node
'use strict';

/**
 * OXB-119: tool guards for the program's agent sessions — they block BEFORE the action, instead of a rule living only
 * in prose. Installed per project, opt-in (`oxe-cc install --guards`), as the host's pre-tool hook. The hook receives the
 * tool call as JSON on stdin ({ tool_name, tool_input, cwd }) and blocks with exit code 2 and the reason on stderr.
 *
 *   (a) a write (Write / Edit / MultiEdit / NotebookEdit, or a shell redirection/`tee`) outside the project root
 *       (or the task worktree the session runs in);
 *   (b) a read of a `policy_rules` path rule's `deny_read` glob by ANY tool that puts content in the conversation:
 *       Read, Grep, Glob, and the shell (cat/type/less/head/tail/grep/rg, `git show ref:path`, `$( … )`, `bash -c`);
 *   (c) a command matching a `policy_rules` command rule's `deny` regex;
 *   (d) a heavy command (`guards.heavy`, regexes) not wrapped by `guards.heavy_wrapper`;
 *   and a mutating git command (checkout / switch / stash / reset / clean / restore) inside `guards.protected_checkouts`.
 *
 * Fails closed: an internal error blocks and says so. Every block is a `PolicyBlocked` event in .oxe/OXE-EVENTS.ndjson.
 */

const fs = require('fs');
const path = require('path');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Shell']);

const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
const inside = (root, p) => { const r = norm(root); const x = norm(p); return x === r || x.startsWith(`${r}/`); };

function globRe(glob) {
  let re = '';
  const g = String(glob).replace(/\\/g, '/').toLowerCase();
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i += 1; if (g[i + 1] === '/') i += 1; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`(^|/)${re}($|/)`, 'i');
}

function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.oxe'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start || process.cwd());
    dir = up;
  }
}

function loadConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.oxe', 'config.json'), 'utf8')); } catch { return {}; }
}

/** Path-like tokens of a shell command (incl. `git show ref:path`, quoted args, inside $( ) and bash -c "…"). */
function shellPaths(cmd) {
  const out = new Set();
  const text = String(cmd || '');
  for (const m of text.matchAll(/(?:^|[\s'"=(:])((?:[A-Za-z]:)?[\w.~@-]*[\\/][^\s'"`;|&)<>]+|[\w.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s'"`;|&)<>])/g)) out.add(m[1]);
  for (const m of text.matchAll(/git\s+show\s+[^\s:]+:([^\s'"`;|&]+)/g)) out.add(m[1]);
  return [...out];
}

function writeTargetsOfShell(cmd) {
  const out = [];
  for (const m of String(cmd || '').matchAll(/(?:^|[^>&0-9])>>?\s*["']?([^\s"'`;|&]+)/g)) if (!/^&?\d$/.test(m[1]) && m[1] !== '/dev/null' && m[1].toLowerCase() !== 'nul') out.push(m[1]);
  for (const m of String(cmd || '').matchAll(/\btee\s+(?:-a\s+)?["']?([^\s"'`;|&]+)/g)) out.push(m[1]);
  return out;
}

/**
 * The decision for one tool call. @returns {{ block: boolean, rule?: string, reason?: string }}
 */
function decide(call, ctx) {
  const tool = String(call.tool_name || '');
  const input = call.tool_input || {};
  const cwd = call.cwd || ctx.root;
  const rules = Array.isArray(ctx.config.policy_rules) ? ctx.config.policy_rules.filter((r) => r && typeof r === 'object') : [];
  const guards = ctx.config.guards || {};
  const root = guards.root ? path.resolve(ctx.root, guards.root) : ctx.root;
  const denyRead = rules.filter((r) => r.kind === 'path' && r.deny_read).map((r) => ({ id: r.id || r.deny_read, re: globRe(r.deny_read), message: r.message || r.deny_read }));
  const denyWrite = rules.filter((r) => r.kind === 'path' && r.deny_write).map((r) => ({ id: r.id || r.deny_write, re: globRe(r.deny_write), message: r.message || r.deny_write }));
  const denyCmd = rules.filter((r) => r.kind === 'command' && r.deny).map((r) => ({ id: r.id || r.deny, re: new RegExp(r.deny, 'i'), message: r.message || r.deny }));
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));
  // a directory path ("…/oxespace") must match "…/oxespace/**" too
  const forms = (p) => { const a = norm(abs(p)); const b = String(p).replace(/\\/g, '/').toLowerCase(); return [a, `${a}/`, b, `${b}/`]; };
  const matchPath = (list, p) => list.find((r) => forms(p).some((x) => r.re.test(x)));

  if (WRITE_TOOLS.has(tool)) {
    const target = input.file_path || input.notebook_path || input.path;
    if (target) {
      if (!inside(root, abs(target))) return { block: true, rule: 'write_outside_root', reason: `escrita fora da raiz do projeto/worktree (${root}): ${target}` };
      const w = matchPath(denyWrite, target);
      if (w) return { block: true, rule: w.id, reason: `regra ${w.id}: escrita proibida em ${target} — ${w.message}` };
    }
  }
  if (READ_TOOLS.has(tool)) {
    for (const p of [input.file_path, input.path, input.pattern && tool === 'Glob' ? input.pattern : null].filter(Boolean)) {
      const r = matchPath(denyRead, p);
      if (r) return { block: true, rule: r.id, reason: `regra ${r.id}: leitura proibida de ${p} — ${r.message}` };
    }
  }
  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(input.command || '');
    const c = denyCmd.find((r) => r.re.test(cmd));
    if (c) return { block: true, rule: c.id, reason: `regra ${c.id}: comando proibido — ${c.message}` };
    for (const p of shellPaths(cmd)) {
      const r = matchPath(denyRead, p);
      if (r) return { block: true, rule: r.id, reason: `regra ${r.id}: o comando lê ${p} — ${r.message}` };
    }
    for (const t of writeTargetsOfShell(cmd)) {
      if (!inside(root, abs(t))) return { block: true, rule: 'write_outside_root', reason: `o comando escreve fora da raiz (${root}): ${t}` };
    }
    for (const prot of guards.protected_checkouts || []) {
      if (inside(path.resolve(ctx.root, prot), cwd) && /\bgit\s+(checkout|switch|stash|reset|clean|restore)\b/.test(cmd)) {
        return { block: true, rule: 'protected_checkout', reason: `checkout protegido (${prot}): git ${/\bgit\s+(\w+)/.exec(cmd)[1]} não é permitido aqui` };
      }
    }
    if (/\bgit\s+push\b/.test(cmd) && !/\b--delete\b/.test(cmd)) {
      const ic = require('./oxe-integration-checks.cjs');
      const parked = ic.findTrackedParkedAcceptance(cwd);
      if (parked.length) {
        return { block: true, rule: 'parked_acceptance_tracked', reason: ic.formatParkedAcceptanceError(parked) };
      }
    }
    const heavy = (guards.heavy || []).find((h) => { try { return new RegExp(h, 'i').test(cmd); } catch { return false; } });
    if (heavy && guards.heavy_wrapper && !cmd.trim().startsWith(guards.heavy_wrapper)) {
      return { block: true, rule: 'heavy_without_lock', reason: `comando pesado (${heavy}) sem o wrapper de lock — rode: ${guards.heavy_wrapper} ${cmd.trim()}` };
    }
  }
  return { block: false };
}

function recordBlock(root, call, d) {
  try {
    const file = path.join(root, '.oxe', 'OXE-EVENTS.ndjson');
    fs.appendFileSync(file, `${JSON.stringify({ type: 'PolicyBlocked', timestamp: new Date().toISOString(), payload: { tool: call.tool_name, rule: d.rule, reason: d.reason } })}\n`);
  } catch { /* the block still holds */ }
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--project');
  try {
    const call = JSON.parse(raw || '{}');
    const root = pi >= 0 ? path.resolve(argv[pi + 1]) : findProjectRoot(call.cwd);
    const config = loadConfig(root);
    if (config.guards && config.guards.enabled === false) process.exit(0);
    const d = decide(call, { root, config });
    if (d.block) {
      recordBlock(root, call, d);
      process.stderr.write(`OXE guard: ${d.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    // fail closed
    process.stderr.write(`OXE guard: erro interno, ação bloqueada por segurança (${err && err.message ? err.message : err})\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { decide, shellPaths, writeTargetsOfShell, globRe, findProjectRoot };
