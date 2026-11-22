#!/usr/bin/env node
'use strict';

/**
 * lean bench v2 — "no origin, no stop": a deterministic guard for product code written with no origin.
 *
 * Twice in the bench a change request was implemented straight in the conversation — no CR, no frozen test, no commit —
 * and the second time the workflow carried an explicit rule against it that the agent never opened. A rule in a prompt
 * is advice. This is a Stop hook of the host (Claude Code): when the session is about to end and the project has a
 * program, product code modified in the working tree must belong to something — a plan task still open that declares
 * the file, or an open quick. Otherwise the stop is refused once, with the two ways to give it an origin.
 *
 *   node oxe-origin-guard.cjs --project <dir>          (hook: reads the hook JSON on stdin, exit 2 = keep going)
 *   require('./oxe-origin-guard.cjs').check(root)      → { ok, stray, reason }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function dirtyFiles(root) {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '-uall'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) return null;
  const parts = String(res.stdout || '').split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    out.push(norm(parts[i].slice(3)));
    if (code[0] === 'R' || code[0] === 'C') i += 1; // the "from" path of a rename follows
  }
  return out;
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, stray: string[], reason: string|null, covered_by: string|null }}
 */
function check(root) {
  const ok = (coveredBy = null) => ({ ok: true, stray: [], reason: null, covered_by: coveredBy });
  const programFile = path.join(root, '.oxe', 'program', 'PROGRAM.json');
  if (!fs.existsSync(programFile)) return ok('sem programa');
  // only when `root` is the top of its own repository (a folder inside an outer repository is not ours to judge)
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  if (top.status !== 0 || real(top.stdout.trim()).toLowerCase() !== real(root).toLowerCase()) return ok('fora de um repositório próprio');
  const dirty = dirtyFiles(root);
  if (!dirty) return ok('git indisponível');
  const planBuild = require('./oxe-plan-build.cjs');
  const product = dirty.filter((p) => p && !p.startsWith('.oxe/') && planBuild.isProductCode(p));
  if (!product.length) return ok('nenhum código de produto alterado');
  try { if (require('./oxe-quick.cjs').current(root)) return ok('quick aberto'); } catch { /* no quick state */ }
  // an open plan task that declares the file
  const program = readJson(programFile) || {};
  const plan = readJson(path.join(root, '.oxe', 'PLAN.json'));
  const pending = program.active_phase && plan && Array.isArray(plan.tasks)
    ? plan.tasks.filter((t) => t && t.done !== true && (!plan.phase || plan.phase === program.active_phase))
    : [];
  const scope = pending.flatMap((t) => [...(t.files || []), ...(t.edited_paths || []), ...(t.removed_paths || [])].map((f) => norm(typeof f === 'string' ? f : f && f.path)));
  const inScope = (file) => scope.some((s) => s && (file === s || file.startsWith(`${s.replace(/\/+$/, '')}/`)));
  const stray = product.filter((p) => !inScope(p));
  if (!stray.length) return ok('tarefa aberta do plano');
  return {
    ok: false,
    stray,
    covered_by: null,
    reason: `código de produto alterado sem origem: ${stray.slice(0, 6).join(', ')}${stray.length > 6 ? `, +${stray.length - 6}` : ''}. `
      + 'Este projeto tem programa OXE: toda mudança de código pertence a uma tarefa do plano, a um quick ou a um CR. Antes de encerrar, dê origem a ela: '
      + '(a) mudança pequena, sem critério novo: `oxe-cc quick <KEY> "<objetivo>"`, depois `oxe-cc quick commit -m "<tipo>: <resumo>" --all` e `oxe-cc quick done --verify "<comando da suíte>"`; '
      + '(b) mudança de critério, contrato ou escopo: registre o CR com `oxe-cc runtime feedback --class new_scope --summary "…" --by <quem pediu>`, e então abra o quick com a chave do CR (`oxe-cc quick <CR-n> "…"`), commite e feche como em (a). '
      + 'Diga ao usuário qual CR ou quick ficou registrado. Não descarte o trabalho.',
  };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--project');
  const root = path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : process.cwd());
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  let result;
  try { result = check(root); } catch { process.exit(0); } // a guard that breaks never blocks the session
  if (result.ok) process.exit(0);
  const marker = path.join(root, '.oxe', 'ORIGIN-VIOLATION.json');
  // the host says when this stop is already the continuation of a blocked one: do not loop, leave the record
  if (input && input.stop_hook_active) {
    try { fs.writeFileSync(marker, `${JSON.stringify({ at: new Date().toISOString(), stray: result.stray }, null, 2)}\n`); } catch { /* best effort */ }
    process.stderr.write(`OXE: a sessão encerrou com ${result.stray.length} arquivo(s) de produto sem origem (registrado em .oxe/ORIGIN-VIOLATION.json).\n`);
    process.exit(0);
  }
  process.stderr.write(`OXE (guarda de origem): ${result.reason}\n`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = { check, dirtyFiles };
