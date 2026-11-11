'use strict';

/**
 * OXB-136: seam review at the phase close — defects BETWEEN tasks that no task's verify sees. Over the phase diff
 * (base..HEAD), deterministically:
 *   (a) files changed by more than one task (OXE-Task trailers), and exports that changed with consumers in another
 *       task's files (a prop removed in one file breaking a consumer of another task: F1's CR-10);
 *   (b) duplicated helpers: the same function body (normalized, ≥ 4 lines) in different files of the diff;
 *   (c) files that grew above the limit summing every task (`close.seams.grow_limit_lines`, default 300);
 *   (d) the previous phase's retro actions (`RA-<fase>-<n>`) still without evidence;
 *   (e) criteria whose check says the flow runs end to end, without a recorded behavior run.
 * The report goes to the dossier (`seams.md`). (d) and (e) open block the close when
 * `close.seams.require_behavior_run` / `require_retro` are on; (a)–(c) inform the review.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java|py|go|rs)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;

function filesByTask(root, base) {
  const map = new Map(); // file → Set(task)
  const log = git(root, ['log', '--format=%x00%B%x01', '--name-only', `${base}..HEAD`]).stdout || '';
  for (const chunk of log.split('\0').filter(Boolean)) {
    const [body, files] = chunk.split('\x01');
    const m = /^OXE-Task: (?:F\d+\/)?(T\d+)\s*$/m.exec(body || '');
    if (!m) continue;
    for (const f of String(files || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      if (!map.has(f)) map.set(f, new Set());
      map.get(f).add(m[1]);
    }
  }
  return map;
}

function bodiesOf(text) {
  const out = [];
  const src = String(text || '');
  const re = /\b(?:function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}') { depth -= 1; if (!depth) { end = i; break; } } }
    if (end < 0) continue;
    const body = src.slice(open + 1, end);
    const lines = body.split('\n').filter((l) => l.trim()).length;
    if (lines < 4) continue;
    const normalized = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    out.push({ name: m[1] || m[2], hash: crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12), lines });
  }
  return out;
}

function seamsReport(root, base, ctx = {}) {
  const cfg = (ctx.config && ctx.config.close && ctx.config.close.seams) || {};
  const growLimit = Number(cfg.grow_limit_lines) > 0 ? Number(cfg.grow_limit_lines) : 300;
  const report = { shared_files: [], export_consumers: [], duplicate_helpers: [], grown_files: [], retro_open: [], behavior_missing: [] };
  const byTask = filesByTask(root, base);
  for (const [file, tasks] of byTask) if (tasks.size > 1) report.shared_files.push({ file, tasks: [...tasks].sort() });
  // (a) changed/removed exports with consumers in other tasks' files
  try {
    const api = require('./oxe-api-surface.cjs').apiDiff(root, base, null);
    for (const x of [...api.removed, ...api.changed]) {
      if (!x.key.startsWith('export:')) continue;
      const name = x.key.slice(7);
      const owner = byTask.get(x.file) || new Set();
      const consumers = [];
      for (const [file, tasks] of byTask) {
        // a seam: the export's file was changed by a task that did not touch this consumer
        if (file === x.file || ![...owner].some((t) => !tasks.has(t))) continue;
        let text = '';
        try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
        if (new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(text)) consumers.push({ file, tasks: [...tasks] });
      }
      if (consumers.length) report.export_consumers.push({ file: x.file, export: name, change: x.after ? 'mudou' : 'removido', consumers });
    }
  } catch { /* */ }
  // (b) duplicated helpers, (c) growth
  const diffFiles = (git(root, ['diff', '--numstat', base, 'HEAD', '--']).stdout || '').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const seen = new Map();
  for (const [add, , file] of diffFiles) {
    if (!file) continue;
    if (Number(add) > growLimit) report.grown_files.push({ file, added: Number(add), limit: growLimit });
    if (!CODE_RE.test(file) || TEST_RE.test(file)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const b of bodiesOf(text)) {
      const prev = seen.get(b.hash);
      if (prev && prev.file !== file) report.duplicate_helpers.push({ a: `${prev.file}#${prev.name}`, b: `${file}#${b.name}`, lines: b.lines });
      else if (!prev) seen.set(b.hash, { file, name: b.name });
    }
  }
  // (d) retro actions of earlier phases without evidence
  for (const a of ctx.retroActions || []) if (!a.evidence && a.status !== 'done' && a.status !== 'dropped' && a.phase !== ctx.phase) report.retro_open.push(a);
  // (e) end-to-end flows required by the criteria
  for (const c of ctx.behaviorCriteria || []) if (!(ctx.behaviorRuns || []).some((r) => (r.criteria || []).includes(c))) report.behavior_missing.push(c);
  return report;
}

/** Criteria whose "Como verificar" says the flow runs end to end. */
function behaviorCriteriaFromSpec(specText, phaseCriteria) {
  const out = [];
  for (const line of String(specText || '').split(/\r?\n/)) {
    const m = /^\|\s*(A\d+(?:\.\d+)?)\s*\|[^|]*\|([^|]*)\|/.exec(line);
    if (m && (!phaseCriteria || phaseCriteria.includes(m[1])) && /ponta a ponta|end[- ]to[- ]end|\be2e\b|executar o fluxo|fluxo completo/i.test(m[2])) out.push(m[1]);
  }
  return out;
}

function renderSeams(r, phase) {
  const L = ['# Revisão de costura', '', `Fase ${phase || '—'}`, ''];
  const sec = (t, list, fmt) => { L.push(`## ${t} (${list.length})`, ''); if (!list.length) L.push('—'); for (const x of list) L.push(`- ${fmt(x)}`); L.push(''); };
  sec('Arquivos mexidos por mais de uma tarefa', r.shared_files, (x) => `${x.file} — ${x.tasks.join(', ')}`);
  sec('Exports alterados com consumidor em outra tarefa', r.export_consumers, (x) => `\`${x.export}\` (${x.file}, ${x.change}) — usado em ${x.consumers.map((c) => `${c.file} [${c.tasks.join(',')}]`).join('; ')}`);
  sec('Helpers duplicados', r.duplicate_helpers, (x) => `${x.a} = ${x.b} (${x.lines} linhas)`);
  sec('Arquivos que cresceram demais', r.grown_files, (x) => `${x.file}: +${x.added} linhas (limite ${x.limit})`);
  sec('Ações da retro anterior sem evidência', r.retro_open, (x) => `${x.id}: ${x.action}`);
  sec('Fluxos de ponta a ponta não executados', r.behavior_missing, (x) => `${x}: registre com oxe-cc runtime seams --behavior-ran ${x} --evidence <relatório>`);
  return `${L.join('\n')}\n`;
}

module.exports = { seamsReport, renderSeams, behaviorCriteriaFromSpec, filesByTask, bodiesOf };
