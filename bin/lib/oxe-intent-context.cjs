'use strict';

/**
 * OXB-142: what the agent context keeps — intent, not what the code already says.
 *  - `intent` (reason, decision, rejection, rule): delivered in full — the task's decisions (D-* cited or of its
 *    criteria) with their rejected alternatives, the policy_rules whose paths touch the task's files, its criteria text,
 *    and its pack entry's `intent`/`rationale` (each with its source).
 *  - `derivable` (paths, symbols, structure, code): delivered as POINTERS with an observable trigger — "when you edit
 *    <path>", "before calling <symbol> (in <path>)", "run <command>" — never inlined content, never "consult if needed".
 * `oxe-cc runtime context-pack --task T3 --explain` shows each item and why; `plan lint` warns `derivable_inlined`
 * (code copied into PLAN.json / the pack instead of pointed at) and intent without a source.
 */

const INLINE_KEYS = ['snippet', 'code', 'content', 'excerpt', 'body', 'source_code', 'example'];
const FENCE_RE = /```[\s\S]*?```/;

const normPath = (p) => String(typeof p === 'string' ? p : (p && p.path) || '').replace(/\\/g, '/').replace(/^\.\//, '');

function globToRe(g) {
  const s = normPath(g)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '\u0001')
    .replace(/^\*\*\//, '\u0002')
    .replace(/\/\*\*$/, '\u0003')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:/.*/|/)')
    .replace(/\u0002/g, '(?:.*/)?')
    .replace(/\u0003/g, '(?:/.*)?')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${s}$`);
}
const touches = (rulePaths, files) => (rulePaths || []).some((g) => files.some((f) => globToRe(g).test(normPath(f))));

const critMatch = (a, b) => {
  const x = String(a || '').trim().toUpperCase();
  const y = String(b || '').trim().toUpperCase();
  return Boolean(x && y) && (x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`));
};

function lookupCritText(src, id) {
  if (!src) return null;
  const get = (k) => (typeof src.get === 'function' ? src.get(k) : src[k]);
  return get(id) || get(String(id).toUpperCase()) || (String(id).includes('.') ? get(String(id).split('.')[0]) : null) || null;
}

function build(task, ctx = {}) {
  const items = [];
  const files = ((task && task.files) || []).map(normPath).filter(Boolean);
  const crit = [...new Set(((task && task.acceptance) || []).filter(Boolean))];
  for (const d of (ctx.decisions || []).filter((x) => x && (!x.status || x.status === 'active') && (((task && task.decisions) || []).includes(x.id) || (x.criteria || []).some((c) => crit.some((tc) => critMatch(tc, c)))))) {
    items.push({ kind: 'intent', type: 'decision', id: d.id, text: d.title + (d.text ? ` — ${d.text}` : ''), alternatives: d.alternatives || [], source: `decisions.ndjson:${d.id}`, why: ((task && task.decisions) || []).includes(d.id) ? 'citada pela tarefa' : 'do critério da tarefa' });
  }
  for (const r of (ctx.policyRules || []).filter((x) => x && (!x.paths || !x.paths.length || touches(x.paths, files)))) {
    const isGlobal = !r.paths || !r.paths.length;
    items.push({ kind: 'intent', type: 'rule', id: r.id || null, text: r.message || r.reason || r.forbid || r.deny || JSON.stringify(r), source: `config.json policy_rules${r.id ? `:${r.id}` : ''}`, why: isGlobal ? 'regra global' : 'a regra cobre arquivos da tarefa' });
  }
  for (const c of crit) {
    const txt = lookupCritText(ctx.criteriaText, c);
    if (txt) items.push({ kind: 'intent', type: 'criterion', id: c, text: txt, source: `SPEC.md:${c}`, why: 'critério da tarefa' });
  }
  const entry = ctx.packEntry || {};
  for (const k of ['intent', 'rationale', 'why']) if (entry[k]) items.push({ kind: 'intent', type: 'pack_intent', text: String(entry[k]), source: entry.source || entry[`${k}_source`] || null, why: `pack.${k}` });
  for (const f of files) items.push({ kind: 'derivable', type: 'file', pointer: f, trigger: `ao editar ${f}, leia o arquivo atual`, why: 'arquivo do escopo — lido ao vivo' });
  for (const s of entry.symbols || []) {
    const sf = normPath(s.path || s.file);
    items.push({ kind: 'derivable', type: 'symbol', pointer: `${sf}#${s.name}`, trigger: `antes de mudar ou chamar ${s.name}, abra ${sf}`, why: 'símbolo do pack — lido ao vivo' });
  }
  const v = task && task.verify;
  const cmds = Array.isArray(v) ? v : (v && (Array.isArray(v.commands) ? v.commands : v.command ? [v.command] : [])) || [];
  for (const cmd of cmds) items.push({ kind: 'derivable', type: 'command', pointer: cmd, trigger: `rode ${cmd} para conferir`, why: 'verify da tarefa' });
  return items;
}

/** Lint: code inlined in the plan/pack (derivable copied) and pack intent without a source. */
function lint(doc, pack) {
  const out = [];
  for (const t of (doc && doc.tasks) || []) {
    if (!t || t.superseded || t.merged_into) continue;
    for (const k of ['description', 'notes', 'approach']) if (typeof t[k] === 'string' && FENCE_RE.test(t[k])) out.push(`derivable_inlined: ${t.id}.${k} traz um bloco de código — aponte o arquivo e o símbolo em vez de copiar`);
  }
  for (const e of (pack && (pack.tasks || pack.entries)) || []) {
    const id = e && (e.id || e.task);
    for (const k of INLINE_KEYS) if (e && typeof e[k] === 'string' && (e[k].length > 200 || FENCE_RE.test(e[k]))) out.push(`derivable_inlined: pack ${id}.${k} copia ${e[k].length} caracteres do repositório — use um ponteiro (path#símbolo) com gatilho`);
    for (const s of (e && e.symbols) || []) for (const k of INLINE_KEYS) if (s && typeof s[k] === 'string' && (s[k].length > 200 || FENCE_RE.test(s[k]))) out.push(`derivable_inlined: pack ${id} símbolo ${s.name}.${k} copiado — o símbolo basta`);
    for (const k of ['intent', 'rationale']) if (e && e[k] && !(e.source || e[`${k}_source`])) out.push(`intent sem fonte: pack ${id}.${k} — diga de onde vem (decisão D-*, issue, conversa registrada)`);
  }
  return out;
}

/** The pack entry of the task without inlined code (pointers only), for the context pack. */
function stripInlined(entry) {
  if (!entry) return entry;
  const out = { ...entry };
  for (const k of INLINE_KEYS) delete out[k];
  if (Array.isArray(out.symbols)) out.symbols = out.symbols.map((s) => { const c = { ...s }; for (const k of INLINE_KEYS) delete c[k]; return c; });
  return out;
}

module.exports = { build, lint, stripInlined, INLINE_KEYS };
