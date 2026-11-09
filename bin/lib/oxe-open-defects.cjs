'use strict';

/**
 * OXB-110: open defects carried between phases — `.oxe/OPEN-DEFECTS.json`. Collected from the phase's diff and the
 * program: stubs in the added code (OXB-108), TODO/FIXME/XXX/HACK added, tests skipped or focused (.skip/.only, xit,
 * @Disabled), done tasks with no verify, open signal CRs (`runtime signal`) and open CRs on the standing criteria (A70).
 * An item stays until it disappears from the source; a waiver (`runtime defects --waive <id> --reason … --by …`) is
 * kept across regenerations. Unwaived items block `program close` (and with it the deploy gate it evaluates).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const FILE = (projectRoot) => path.join(projectRoot, '.oxe', 'OPEN-DEFECTS.json');
const CODE_RE = /\.(c|m)?[jt]sx?$|\.(kt|kts|java|py|go|rs|swift|cs|vue|svelte)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[^/]+$/i;
const TODO_RE = /\b(TODO|FIXME|XXX|HACK)\b/;
const SKIP_RE = /\b(it|test|describe|context|suite)\.(skip|only|todo)\s*\(|\b(xit|xdescribe|fit|fdescribe)\s*\(|@Disabled\b|@Ignore\b|\bpytest\.mark\.skip\b|\bt\.Skip\(/;

const idOf = (kind, key) => `OD-${kind}-${crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 8)}`;

function read(projectRoot) {
  try { return JSON.parse(fs.readFileSync(FILE(projectRoot), 'utf8')); } catch { return null; }
}

function addedLines(projectRoot, base) {
  const out = [];
  const diff = spawnSync('git', ['diff', '-U0', base, '--'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout || '';
  let file = null;
  let ln = 0;
  for (const l of diff.split(/\r?\n/)) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) { ln = Number(h[1]); continue; }
    if (!file || file === '/dev/null') continue;
    if (l.startsWith('+') && !l.startsWith('+++')) { out.push({ file, line: ln, text: l.slice(1) }); ln += 1; }
    else if (!l.startsWith('-') && !l.startsWith('\\')) ln += 1;
  }
  // untracked new files count whole
  const others = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).stdout || '';
  for (const f of others.split(/\r?\n/).filter(Boolean)) {
    try {
      const st = fs.statSync(path.join(projectRoot, f));
      if (st.size > 1_000_000) continue;
      fs.readFileSync(path.join(projectRoot, f), 'utf8').split(/\r?\n/).forEach((text, i) => out.push({ file: f, line: i + 1, text }));
    } catch { /* */ }
  }
  return out;
}

/**
 * Builds the register. ctx: { phase, base (sha), doc (PLAN.json), changes (CR list), standing (criterion ids) }.
 * @returns {{ generated_at, phase, base, items: object[], waivers: object[] }}
 */
function collect(projectRoot, ctx = {}) {
  const items = [];
  const push = (kind, key, data) => items.push({ id: idOf(kind, key), kind, ...data });
  if (ctx.base) {
    for (const a of addedLines(projectRoot, ctx.base)) {
      if (/oxe-defect-ok/.test(a.text)) continue;
      if (CODE_RE.test(a.file) && TODO_RE.test(a.text)) push('todo', `${a.file}|${a.text.trim()}`, { file: a.file, line: a.line, text: a.text.trim().slice(0, 140) });
      if (TEST_RE.test(a.file) && SKIP_RE.test(a.text)) push('test_skip', `${a.file}|${a.text.trim()}`, { file: a.file, line: a.line, text: a.text.trim().slice(0, 140) });
    }
    try {
      for (const f of require('./oxe-stub-check.cjs').stubFindings(projectRoot, { phase: true, since: ctx.base, levels: ['substantive'] })) {
        push('stub', `${f.file}|${f.text || f.why}`, { file: f.file, line: f.line, text: `${f.why}${f.text ? ` — ${f.text}` : ''}` });
      }
    } catch { /* */ }
  }
  for (const t of (ctx.doc && Array.isArray(ctx.doc.tasks) ? ctx.doc.tasks : [])) {
    if (!t || t.done !== true || ['external_delivery', 'verify_only'].includes(t.kind)) continue;
    const cmds = t.verify && Array.isArray(t.verify.commands) ? t.verify.commands.filter((c) => String(c).trim()) : [];
    if (!cmds.length && !(t.verify && t.verify.command)) push('verify_missing', `${ctx.phase || ''}|${t.id}|${t.title}`, { task: t.id, text: `${t.id} concluída sem verify` });
  }
  const standing = new Set(ctx.standing || []);
  for (const cr of ctx.changes || []) {
    if (!cr || cr.status !== 'open') continue;
    if (/^signal/.test(String(cr.by || ''))) push('signal_cr', cr.id, { cr: cr.id, text: cr.summary });
    else if ((cr.criteria || []).some((c) => standing.has(c))) push('standing_cr', cr.id, { cr: cr.id, text: `${cr.summary} (${cr.criteria.join(',')})` });
  }
  // dedupe by id
  const byId = new Map();
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
  const previous = read(projectRoot);
  const waivers = previous && Array.isArray(previous.waivers) ? previous.waivers : [];
  const doc = { schema_version: 1, generated_at: new Date().toISOString(), phase: ctx.phase || null, base: ctx.base || null, items: [...byId.values()], waivers };
  fs.mkdirSync(path.dirname(FILE(projectRoot)), { recursive: true });
  fs.writeFileSync(FILE(projectRoot), `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function open(doc) {
  const waived = new Set((doc && doc.waivers ? doc.waivers : []).map((w) => w.id));
  return (doc && doc.items ? doc.items : []).filter((it) => !waived.has(it.id));
}

function waive(projectRoot, id, options = {}) {
  const doc = read(projectRoot);
  if (!doc) throw new Error('sem .oxe/OPEN-DEFECTS.json — rode oxe-cc runtime defects');
  const reason = String(options.reason || '').trim();
  const by = String(options.by || '').trim();
  if (!by || reason.length < 8) throw new Error('--waive exige --by <papel> e --reason "…" (a exceção fica registrada)');
  if (!doc.items.some((it) => it.id === id)) throw new Error(`${id} não está no registro`);
  doc.waivers = [...(doc.waivers || []).filter((w) => w.id !== id), { id, by, reason, at: new Date().toISOString() }];
  fs.writeFileSync(FILE(projectRoot), `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function describe(it) {
  return `${it.id} [${it.kind}] ${it.file ? `${it.file}${it.line ? `:${it.line}` : ''} ` : ''}${it.text || ''}`.trim();
}

module.exports = { collect, open, waive, read, describe, FILE };
