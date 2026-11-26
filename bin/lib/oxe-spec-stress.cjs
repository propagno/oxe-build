'use strict';

/**
 * OXB-143: stress test of the spec by independent readers. `oxe-cc spec stress [A<n>|--phase Fn] [--methods …]` picks
 * up to three methods of `oxe/templates/stress-methods.md` per criterion — the one whose keywords best match the
 * criterion's weak point, one at random (seeded by the criterion id, so reproducible) and one of the criterion's size —
 * and runs each in a reader that receives ONLY a short summary of the objective and the criterion's text (a separate
 * process, the same reviewer of OXB-178b). The result is a list of proposed changes, each tagged with its method; the
 * author accepts all or part (`spec stress accept <run> --changes 1,3`), and each accepted one becomes a recorded
 * amendment (the `spec amend` path) with a `spec_edit` record `origin: "stress"`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG = path.join(__dirname, '..', '..', 'oxe', 'templates', 'stress-methods.md');

function loadMethods(file = CATALOG) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const block of text.split(/^## /m).slice(1)) {
    const head = /^([a-z-]+)\s+—\s+(.+)$/m.exec(block);
    if (!head) continue;
    const field = (k) => { const m = new RegExp(`^- ${k}:\\s*(.+)$`, 'm').exec(block); return m ? m[1].trim() : ''; };
    out.push({ id: head[1], name: head[2].trim(), attacks: field('Ataca').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean), size: field('Tamanho'), instruction: field('Instrução') });
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function score(method, text) { const t = norm(text); return method.attacks.filter((k) => t.includes(norm(k))).length; }
function sizeOf(text) { const n = String(text || '').trim().split(/\s+/).filter(Boolean).length; return n <= 10 ? 'curto' : n <= 25 ? 'médio' : 'longo'; }

/** Up to three distinct methods: best match, a seeded random one, one of the criterion's size. */
function chooseMethods(criterion, methods, forced) {
  if (!Array.isArray(methods) || !methods.length) return [];
  if (forced && forced.length) return methods.filter((m) => forced.includes(m.id)).slice(0, 3);
  const picked = [];
  const add = (m) => { if (m && !picked.includes(m)) picked.push(m); };
  add([...methods].sort((a, b) => score(b, criterion.text) - score(a, criterion.text))[0]);
  const seed = parseInt(crypto.createHash('sha1').update(String(criterion.id || '')).digest('hex').slice(0, 8), 16);
  const rest = methods.filter((m) => !picked.includes(m));
  if (rest.length) add(rest[seed % rest.length]);
  add(methods.find((m) => m.size === sizeOf(criterion.text) && !picked.includes(m)));
  return picked.slice(0, 3);
}

function summaryOf(specText) {
  const m = /##\s*Objetivo\s*\r?\n+([\s\S]*?)(?=\r?\n##\s|$)/i.exec(String(specText || ''));
  const text = (m ? m[1] : String(specText || '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|')).slice(0, 3).join(' ')).replace(/\s+/g, ' ').trim();
  return text.slice(0, 400);
}

function buildPrompt(method, summary, criterion) {
  return `${method.instruction}\n\nResponda SOMENTE com JSON: {"changes":[{"text":"a frase a acrescentar ao critério","rationale":"por quê"}]} (no máximo 3; [] se o critério já cobre).\n\nResumo do objetivo: ${summary}\n\nCritério ${criterion.id}: ${criterion.text}`;
}

function balancedJsonObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}' && depth > 0) { depth -= 1; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

function parseChanges(reply) {
  let body = String((reply && reply.text) || '');
  try { const j = JSON.parse(body); if (j && typeof j.result === 'string') body = j.result; } catch { /* texto */ }
  const candidates = [];
  for (const m of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1].trim());
  candidates.push(...balancedJsonObjects(body));
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s >= 0 && e > s) candidates.push(body.slice(s, e + 1));
  for (const cand of candidates) {
    try {
      const j = JSON.parse(cand);
      if (j && Array.isArray(j.changes)) return j.changes.filter((c) => c && c.text).slice(0, 3);
    } catch { /* try next */ }
  }
  return null;
}

async function stress(root, input) {
  const methods = loadMethods();
  const summary = summaryOf(input.specText);
  const reviewer = input.reviewer || require('./oxe-review.cjs').claudeReviewer({ model: input.model });
  const proposals = [];
  const prompts = [];
  for (const c of input.criteria || []) {
    for (const m of chooseMethods(c, methods, input.methods)) {
      const prompt = buildPrompt(m, summary, c);
      prompts.push(prompt);
      const reply = await reviewer(prompt, { role: `stress:${m.id}` });
      const changes = reply && reply.ok ? parseChanges(reply) : null;
      if (!changes) { proposals.push({ criterion: c.id, method: m.id, status: 'not_run', reason: (reply && reply.error) || 'sem resposta válida' }); continue; }
      for (const ch of changes) proposals.push({ n: proposals.filter((p) => p.n).length + 1, criterion: c.id, method: m.id, text: String(ch.text), rationale: String(ch.rationale || '') });
    }
  }
  const dir = path.join(root, '.oxe', 'stress');
  fs.mkdirSync(dir, { recursive: true });
  const baseId = `stress-${Date.now().toString(36)}`;
  let runId = baseId;
  let seq = 2;
  while (fs.existsSync(path.join(dir, `${runId}.json`))) { runId = `${baseId}-${seq}`; seq += 1; }
  const doc = { schema: 1, id: runId, summary, at: new Date().toISOString(), proposals };
  fs.writeFileSync(path.join(dir, `${runId}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  return { ...doc, prompts };
}

function readRun(root, id) {
  const dir = path.resolve(root, '.oxe', 'stress');
  let name = id;
  if (!name && fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
      const fp = path.join(dir, n);
      let ts = 0;
      try { const d = JSON.parse(fs.readFileSync(fp, 'utf8')); ts = Date.parse(d && d.at) || 0; } catch { /* ignore */ }
      if (!ts) { try { ts = fs.statSync(fp).mtimeMs; } catch { ts = 0; } }
      return { n, ts };
    });
    entries.sort((a, b) => a.ts - b.ts || a.n.localeCompare(b.n));
    name = entries.length ? entries[entries.length - 1].n : null;
  }
  if (!name) throw new Error('nenhuma rodada de stress (oxe-cc spec stress)');
  const file = path.resolve(dir, String(name).endsWith('.json') ? String(name) : `${name}.json`);
  const rel = path.relative(dir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`id de stress inválido: ${id}`);
  return { file, doc: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

module.exports = { loadMethods, chooseMethods, summaryOf, buildPrompt, parseChanges, stress, readRun };
