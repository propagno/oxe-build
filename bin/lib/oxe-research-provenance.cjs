'use strict';

/**
 * OXB-134: research with provenance. A research note (`.oxe/research/*.md`) separates
 *   ## Afirmações   — every item carries `[fonte: arquivo:linha | URL | saída de comando]`
 *   ## Suposições   — items with an id: `- S1: …`
 * The lint points at each claim without a source (outside Suposições). A task that relies on an assumption cites it
 * (PLAN.json task `assumptions: ["S1"]`, or names S1 in its title/description); each such assumption needs a plan risk
 * (`risks: [{ id, assumption: "S1", mitigation: "T7" | "spike:T9" | "…" }]`) — else `assumption_without_risk`.
 * A note with neither section (older format) gets one warning, never an error.
 */

const fs = require('fs');
const path = require('path');

const SRC_RE = /\[fonte:\s*[^\]]+\]/i;

function sections(text) {
  const out = new Map();
  let cur = null;
  let inFence = false;
  for (const ln of String(text || '').split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(ln)) { inFence = !inFence; if (cur) out.get(cur).push(ln); continue; }
    if (!inFence) {
      const h = /^#{2,3}\s+(.+?)\s*$/.exec(ln);
      if (h) {
        cur = h[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\d+[.)]\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (!out.has(cur)) out.set(cur, []);
        continue;
      }
    }
    if (cur) out.get(cur).push(ln);
  }
  return out;
}

function items(lines) {
  const out = [];
  let inFence = false;
  for (const l of lines || []) {
    if (/^\s*(?:```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*(?:[-*]|\d+\.)\s+\S/.test(l)) {
      out.push(l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim());
    } else if (out.length && /^\s{2,}\S/.test(l)) {
      out[out.length - 1] = `${out[out.length - 1]} ${l.trim()}`;
    }
  }
  return out;
}

function parseNote(text) {
  const s = sections(text);
  const claims = s.has('afirmacoes') ? items(s.get('afirmacoes')).map((t) => ({ text: t, sourced: SRC_RE.test(t) })) : null;
  const assumptions = s.has('suposicoes') ? items(s.get('suposicoes')).map((t) => {
    const m = /^(?:\*\*|`|\*)?(?:\[(S\d+)\]|(S\d+))(?:\*\*|`|\*)?\s*[:—–-]\s*(?:\*\*|\*)?\s*(.+)$/.exec(t);
    return m ? { id: m[1] || m[2], text: m[3] } : { id: null, text: t };
  }) : null;
  return { claims, assumptions, structured: claims != null || assumptions != null };
}

function lintResearch(projectRoot, doc) {
  const warnings = [];
  const dir = path.join(projectRoot, '.oxe', 'research');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { names = []; }
  const known = new Map();
  for (const n of names) {
    const note = parseNote(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (!note.structured) { warnings.push(`research/${n}: nota sem as seções "## Afirmações" e "## Suposições" — afirmação e suposição não estão separadas (formato antigo)`); continue; }
    for (const c of note.claims || []) if (!c.sourced) warnings.push(`research/${n}: afirmação sem fonte — "${c.text.slice(0, 90)}" (acrescente [fonte: arquivo:linha|URL|comando] ou mova para Suposições)`);
    for (const a of note.assumptions || []) {
      if (!a.id) warnings.push(`research/${n}: suposição sem id — "${a.text.slice(0, 60)}" (use "- S1: …")`);
      else known.set(a.id, { ...a, note: n });
    }
  }
  const risks = Array.isArray(doc && doc.risks) ? doc.risks : [];
  const covered = new Set();
  for (const r of risks) {
    if (!r) continue;
    if (r.assumption) covered.add(String(r.assumption));
    for (const a of Array.isArray(r.assumptions) ? r.assumptions : []) if (a) covered.add(String(a));
  }
  for (const t of (doc && doc.tasks) || []) {
    if (!t || t.done === true || t.status === 'done' || t.superseded || t.merged_into) continue;
    const prose = `${t.title || ''} ${t.description || ''} ${t.notes || ''}`;
    const cited = new Set([...(Array.isArray(t.assumptions) ? t.assumptions : []), ...[...prose.matchAll(/\b(S\d+)\b/g)].map((m) => m[1])]);
    for (const id of cited) {
      if (!known.has(id)) continue;
      if (!covered.has(id)) warnings.push(`assumption_without_risk: ${t.id} usa a suposição ${id} ("${known.get(id).text.slice(0, 70)}", research/${known.get(id).note}) e o plano não tem risco para ela — PLAN.json risks: [{ "assumption": "${id}", "mitigation": "<tarefa ou spike>" }]`);
    }
  }
  return warnings;
}

module.exports = { parseNote, lintResearch };
