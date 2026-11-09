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
function sizeOf(text) { const n = String(text || '').split(/\s+/).length; return n <= 10 ? 'curto' : n <= 25 ? 'médio' : 'longo'; }

/** Up to three distinct methods: best match, a seeded random one, one of the criterion's size. */
function chooseMethods(criterion, methods, forced) {
  if (forced && forced.length) return methods.filter((m) => forced.includes(m.id)).slice(0, 3);
  const picked = [];
  const add = (m) => { if (m && !picked.includes(m)) picked.push(m); };
  add([...methods].sort((a, b) => score(b, criterion.text) - score(a, criterion.text))[0]);
  const seed = parseInt(crypto.createHash('sha1').update(criterion.id).digest('hex').slice(0, 8), 16);
  const rest = methods.filter((m) => !picked.includes(m));
  add(rest[seed % rest.length]);
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

function parseChanges(reply) {
  let body = String((reply && reply.text) || '');
  try { const j = JSON.parse(body); if (j && typeof j.result === 'string') body = j.result; } catch { /* texto */ }
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { const j = JSON.parse(body.slice(s, e + 1)); return Array.isArray(j.changes) ? j.changes.filter((c) => c && c.text).slice(0, 3) : null; } catch { return null; }
}

async function stress(root, input) {
  const methods = loadMethods();
  const summary = summaryOf(input.specText);
  const reviewer = input.reviewer || require('./oxe-review.cjs').claudeReviewer({ model: input.model });
  const runId = `stress-${Date.now().toString(36)}`;
  const proposals = [];
  const prompts = [];
  for (const c of input.criteria) {
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
  const doc = { schema: 1, id: runId, summary, at: new Date().toISOString(), proposals };
  fs.writeFileSync(path.join(dir, `${runId}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  return { ...doc, prompts };
}

function readRun(root, id) {
  const dir = path.join(root, '.oxe', 'stress');
  const name = id || (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().pop() : null);
  if (!name) throw new Error('nenhuma rodada de stress (oxe-cc spec stress)');
  const file = path.join(dir, name.endsWith('.json') ? name : `${name}.json`);
  return { file, doc: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

module.exports = { loadMethods, chooseMethods, summaryOf, buildPrompt, parseChanges, stress, readRun };
