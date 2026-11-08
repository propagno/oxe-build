'use strict';

/**
 * OXB-086: one PLAN.json from per-role plans (BACKEND, FRONTEND, …) that describe the same work by a shared key
 * (`rid`, e.g. "R5" for "remove AI Memory").
 *
 * Role plan (oxe/schemas/role-plan.schema.json):
 *   { "role": "backend", "tasks": [ { "rid": "R5", "title", "files": [], "verify": { "commands": [] } | "verify": [],
 *     "depends_on": ["R3"] (keys), "acceptance" | "criteria": ["A12"], "proves": { "<test file>": ["title"] },
 *     "notes", "kind", "blocked_by", "complexity" } ], "acceptance_tests": [ … as in PLAN.json … ] }
 *
 * Merge: tasks with the same key become one task — files, verify commands, acceptance and notes are unions (the role
 * is kept as a prefix in notes); depends_on keys become T ids; waves come from the dependency depth; ids are T1…Tn
 * by wave then first appearance. Prose in criteria moves to notes (warned). `proves` as a { file: [titles] } map is
 * folded into the acceptance_tests entry of that file (or a new one, when the task has one A id and a verify
 * command that names the file).
 */

const fs = require('fs');
const path = require('path');

const ACCEPT_RE = require('./oxe-plan-json.cjs').ACCEPT_RE;

const uniq = (list) => [...new Set(list.filter((v) => v != null && String(v).trim() !== '').map((v) => (typeof v === 'string' ? v.trim() : v)))];

function verifyCommands(task) {
  const v = task.verify;
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === 'object' && Array.isArray(v.commands)) return v.commands.map(String);
  if (typeof v === 'string') return [v];
  if (Array.isArray(task.verify_commands)) return task.verify_commands.map(String);
  return [];
}

/**
 * @param {Array<{ file: string, doc: object }>} inputs
 * @param {{ key?: string }} options
 * @returns {{ plan: object, errors: string[], warnings: string[], map: Record<string, string> }}
 */
function mergeRolePlans(inputs, options = {}) {
  const key = options.key || 'rid';
  const errors = [];
  const warnings = [];
  /** @type {Map<string, any>} */
  const groups = new Map();
  const tests = [];
  for (const { file, doc } of inputs) {
    const name = path.basename(file);
    if (!doc || !Array.isArray(doc.tasks)) { errors.push(`${name}: sem "tasks" (lista)`); continue; }
    const role = String(doc.role || path.basename(file, path.extname(file))).trim();
    doc.tasks.forEach((task, i) => {
      const at = `${name}: tasks[${i}]`;
      const k = task && task[key] != null ? String(task[key]).trim() : '';
      if (!k) { errors.push(`${at}: sem "${key}" — a chave que junta as tarefas dos papéis (ex.: "${key}": "R5")`); return; }
      let g = groups.get(k);
      if (!g) {
        g = { key: k, order: groups.size, title: null, roles: [], files: [], verify: [], acceptance: [], deps: [], notes: [], kind: null, blocked_by: [], complexity: null, proves: [], ids: [] };
        groups.set(k, g);
      }
      if (!g.roles.includes(role)) g.roles.push(role);
      if (task.id) g.ids.push(`${role}:${task.id}`);
      if (!g.title && typeof task.title === 'string' && task.title.trim()) g.title = task.title.trim();
      else if (typeof task.title === 'string' && task.title.trim() && task.title.trim() !== g.title) g.notes.push(`${role}: ${task.title.trim()}`);
      g.files.push(...(Array.isArray(task.files) ? task.files : []));
      g.verify.push(...verifyCommands(task));
      for (const c of [...(Array.isArray(task.acceptance) ? task.acceptance : []), ...(Array.isArray(task.criteria) ? task.criteria : typeof task.criteria === 'string' ? [task.criteria] : [])]) {
        const v = String(c).trim();
        if (ACCEPT_RE.test(v)) g.acceptance.push(v);
        else if (v) {
          g.notes.push(`${role} (critério em prosa): ${v}`);
          warnings.push(`${at} (${k}): critério em prosa movido para notes — "${v.slice(0, 60)}" (critérios são ids A<n>)`);
        }
      }
      g.deps.push(...(Array.isArray(task.depends_on) ? task.depends_on.map(String) : []));
      if (typeof task.notes === 'string' && task.notes.trim()) g.notes.push(`${role}: ${task.notes.trim()}`);
      else if (Array.isArray(task.notes)) g.notes.push(...task.notes.map((n) => `${role}: ${n}`));
      if (task.kind) {
        if (g.kind && g.kind !== task.kind) warnings.push(`${k}: kind diferente entre papéis (${g.kind} × ${task.kind}) — fica ${g.kind}`);
        else g.kind = task.kind;
      }
      if (Array.isArray(task.blocked_by)) g.blocked_by.push(...task.blocked_by);
      if (task.complexity && !g.complexity) g.complexity = task.complexity;
      if (task.proves && typeof task.proves === 'object' && !Array.isArray(task.proves)) g.proves.push({ role, map: task.proves, at });
      else if (Array.isArray(task.proves) && task.proves.length) warnings.push(`${at} (${k}): "proves" em lista na tarefa — use acceptance_tests[] ou { arquivo: [títulos] }; ignorado`);
    });
    for (const entry of Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []) tests.push({ ...entry, _from: name });
  }

  // Dependencies by key → depth → waves.
  const keys = [...groups.keys()];
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (k, chain = []) => {
    if (depth.has(k)) return depth.get(k);
    if (visiting.has(k)) { errors.push(`ciclo de dependência: ${[...chain, k].join(' → ')}`); return 1; }
    visiting.add(k);
    let d = 1;
    for (const dep of uniq(groups.get(k).deps)) {
      if (!groups.has(dep)) { errors.push(`${k}: depends_on "${dep}" não existe em nenhum plano (use o ${key} da tarefa)`); continue; }
      d = Math.max(d, depthOf(dep, [...chain, k]) + 1);
    }
    visiting.delete(k);
    depth.set(k, d);
    return d;
  };
  for (const k of keys) depthOf(k);
  const ordered = keys.slice().sort((a, b) => depth.get(a) - depth.get(b) || groups.get(a).order - groups.get(b).order);
  const idOf = new Map(ordered.map((k, i) => [k, `T${i + 1}`]));

  // Acceptance tests: union, deduplicated by criterion + files + command; proves merged.
  const testKey = (t) => JSON.stringify([t.criterion || t.id || null, uniq(t.files || []).sort(), String(t.command || '').trim()]);
  const merged = new Map();
  for (const t of tests) {
    const { _from, ...entry } = t;
    if (entry.proves && !Array.isArray(entry.proves)) { errors.push(`${_from}: acceptance_tests com "proves" que não é lista — use ["título", …]`); continue; }
    const k = testKey(entry);
    const cur = merged.get(k);
    if (cur) cur.proves = uniq([...(cur.proves || []), ...(entry.proves || [])]);
    else merged.set(k, { ...entry, files: uniq(entry.files || []), ...(entry.proves ? { proves: uniq(entry.proves) } : {}) });
  }
  const acceptanceTests = [...merged.values()];
  // proves as { file: [titles] } (BACKEND's shape) → into the entry that already freezes that file, or a new one.
  for (const k of ordered) {
    const g = groups.get(k);
    for (const { map, at } of g.proves) {
      for (const [file, titles] of Object.entries(map)) {
        const list = (Array.isArray(titles) ? titles : [titles]).map(String).filter(Boolean);
        const norm = file.replace(/\\/g, '/');
        const hit = acceptanceTests.find((t) => (t.files || []).some((f) => f.replace(/\\/g, '/') === norm));
        if (hit) { hit.proves = uniq([...(hit.proves || []), ...list]); continue; }
        const ids = uniq(g.acceptance);
        const base = path.posix.basename(norm);
        const command = uniq(g.verify).find((c) => c.includes(norm) || c.includes(base));
        if (ids.length !== 1 || !command) {
          errors.push(`${at} (${k}): proves de ${file} sem acceptance_tests correspondente — declare-o em acceptance_tests[] (critério e comando)${ids.length !== 1 ? `; a tarefa tem ${ids.length} critério(s), não dá para escolher` : '; nenhum verify cita o arquivo'}`);
          continue;
        }
        acceptanceTests.push({ criterion: ids[0], files: [norm], command, proves: uniq(list) });
      }
    }
  }

  const tasks = ordered.map((k) => {
    const g = groups.get(k);
    const deps = uniq(g.deps).filter((d) => groups.has(d)).map((d) => idOf.get(d));
    const task = {
      id: idOf.get(k),
      title: g.title || k,
      wave: depth.get(k),
      [key]: k,
      roles: g.roles,
      ...(deps.length ? { depends_on: deps } : {}),
      files: uniq(g.files),
      ...(uniq(g.verify).length ? { verify: { commands: uniq(g.verify) } } : {}),
      ...(uniq(g.acceptance).length ? { acceptance: uniq(g.acceptance) } : {}),
      ...(g.kind ? { kind: g.kind } : {}),
      ...(g.blocked_by.length ? { blocked_by: dedupeBlocked(g.blocked_by) } : {}),
      ...(g.complexity ? { complexity: g.complexity } : {}),
      ...(g.notes.length ? { notes: uniq(g.notes).join('\n') } : {}),
    };
    if (!task.files.length && !['external_delivery', 'verify_only', 'spike'].includes(task.kind)) warnings.push(`${k}: nenhum papel declarou files`);
    return task;
  });
  const plan = { schema_version: 1, merged_from: inputs.map((i) => path.basename(i.file)), merge_key: key, tasks, ...(acceptanceTests.length ? { acceptance_tests: acceptanceTests } : {}) };
  return { plan, errors, warnings, map: Object.fromEntries(ordered.map((k) => [k, idOf.get(k)])) };
}

function dedupeBlocked(list) {
  const seen = new Set();
  return list.filter((e) => { const s = JSON.stringify(e); if (seen.has(s)) return false; seen.add(s); return true; });
}

function readRolePlan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); } catch (err) { throw new Error(`${path.basename(file)}: JSON inválido (${err.message})`); }
}

module.exports = { mergeRolePlans, readRolePlan };
