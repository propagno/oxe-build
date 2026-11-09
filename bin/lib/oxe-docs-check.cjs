'use strict';

/**
 * OXB-183: what the CLOSED documents claim about the code, checked against today's tree. From each closed artifact —
 * the decisions and dossiers of closed phases, `.oxe/codebase/*.md` — the paths and `path#symbol` it cites as current
 * state are checked in the repository: "não existe mais", "mudou de lugar" (the symbol exists in another file), and the
 * `check` of every active decision of a closed phase is run again ("check falhou"). What was planned as a file to
 * create is not a claim (the line says criar / novo / new / create / "a criar"). It reports; it never fixes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLANNED_RE = /\b(criar|cria|criado|novo arquivo|nova|novo|a criar|ser criado|new file|to create|will create|create|add(?:ed)? file)\b/i;
const CITE_RE = /`?((?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,8})(?:#([A-Za-z_$][\w$]*))?`?/g;

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

/** Claims of one text: [{ file, symbol, line }]; planned-to-create lines are skipped. */
function claimsOf(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((ln, i) => {
    if (PLANNED_RE.test(ln)) return;
    for (const m of ln.matchAll(CITE_RE)) {
      const file = m[1].replace(/^\.\//, '');
      if (/^https?:/i.test(file) || file.startsWith('.oxe/') || file.includes('*') || file.includes('..')) continue;
      out.push({ file, symbol: m[2] || null, line: i + 1 });
    }
  });
  return out;
}

function symbolDefinedIn(root, symbol) {
  const r = spawnSync('git', ['grep', '-l', '-E', `(function|class|const|let|var|def|interface|type|enum|export)[[:space:]]+${symbol}\\b|${symbol}[[:space:]]*[:=][[:space:]]*(async[[:space:]]*)?(function|\\()`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

function checkClaim(root, c, cache) {
  const abs = path.join(root, c.file);
  const exists = fs.existsSync(abs);
  if (!c.symbol) return exists ? null : { why: 'não existe mais' };
  const text = exists ? (cache.get(c.file) ?? (cache.set(c.file, readText(abs) || ''), cache.get(c.file))) : '';
  if (exists && new RegExp(`\\b${c.symbol}\\b`).test(text)) return null;
  const elsewhere = symbolDefinedIn(root, c.symbol).filter((f) => f !== c.file);
  if (elsewhere.length) return { why: 'mudou de lugar', now: elsewhere.slice(0, 3) };
  return { why: 'não existe mais' };
}

/**
 * ctx: { programDir, dossierRoot, codebaseDir, program (PROGRAM.json), decisions, phase?, runCheck(cmd) → {ok, tail} }
 */
function check(root, ctx) {
  const closed = new Set(((ctx.program && ctx.program.phases) || []).filter((p) => p.status === 'closed').map((p) => p.id));
  const only = ctx.phase ? String(ctx.phase).toUpperCase() : null;
  const artifacts = [];
  for (const d of ctx.decisions || []) {
    if (!d.phase || !closed.has(d.phase) || (only && d.phase !== only)) continue;
    if (d.status && d.status !== 'active') continue;
    artifacts.push({ artifact: `decision:${d.id}`, text: `${d.title || ''}\n${d.text || ''}`, decision: d });
  }
  for (const ph of closed) {
    if (only && ph !== only) continue;
    const dir = path.join(ctx.dossierRoot, ph);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { names = []; }
    for (const n of names) artifacts.push({ artifact: `dossier/${ph}/${n}`, text: readText(path.join(dir, n)) });
  }
  if (!only && ctx.codebaseDir) {
    let names = [];
    try { names = fs.readdirSync(ctx.codebaseDir).filter((n) => n.endsWith('.md')); } catch { names = []; }
    for (const n of names) artifacts.push({ artifact: `codebase/${n}`, text: readText(path.join(ctx.codebaseDir, n)) });
  }
  const cache = new Map();
  const report = [];
  for (const a of artifacts) {
    const seen = new Set();
    for (const c of claimsOf(a.text)) {
      const k = `${c.file}#${c.symbol || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const bad = checkClaim(root, c, cache);
      if (bad) report.push({ artifact: a.artifact, cite: c.symbol ? `${c.file}#${c.symbol}` : c.file, line: c.line, ...bad });
    }
    if (a.decision && a.decision.check && typeof ctx.runCheck === 'function') {
      const r = ctx.runCheck(a.decision.check);
      if (!r.ok) report.push({ artifact: a.artifact, cite: a.decision.check, why: 'check falhou', tail: r.tail });
    }
  }
  return { artifacts: artifacts.length, divergences: report, resolve: ['oxe-cc decision status <id> --status superseded --reason "…"', 'uma nota no artefato', 'oxe-cc runtime feedback --class spec_gap …'] };
}

function render(out) {
  const lines = ['# DOCS-CHECK', '', `${out.artifacts} artefato(s) fechado(s) lidos · ${out.divergences.length} divergência(s)`, ''];
  const by = new Map();
  for (const d of out.divergences) { if (!by.has(d.artifact)) by.set(d.artifact, []); by.get(d.artifact).push(d); }
  for (const [a, ds] of by) {
    lines.push(`## ${a}`, '');
    for (const d of ds) lines.push(`- \`${d.cite}\`: ${d.why}${d.now ? ` (agora em ${d.now.join(', ')})` : ''}${d.tail ? ` — ${String(d.tail).split(/\r?\n/).filter(Boolean).slice(-1)[0] || ''}` : ''}`);
    lines.push('');
  }
  if (out.divergences.length) lines.push('Resolver: marcar a decisão como substituída, registrar uma nota no artefato ou abrir um CR. Nada é corrigido sozinho.', '');
  return lines.join('\n');
}

module.exports = { claimsOf, check, render };
