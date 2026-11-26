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

const COMPLEXITY_RANK = { XS: 1, S: 2, M: 3, L: 4, XL: 5 };
const KIND_RANK = { verify_only: 1, 'test-only': 2, 'config-only': 2, remove: 3, move: 4, add: 4, code: 5, spike: 5, external_delivery: 5 };
const MODEL_HINT_RANK = { fast: 1, balanced: 2, powerful: 3 };

const pathStr = (f) => (typeof f === 'string' ? f.trim() : f && typeof f.path === 'string' ? f.path.trim() : '');
const uniq = (list) => [...new Set(list.filter((v) => v != null && String(v).trim() !== '').map((v) => (typeof v === 'string' ? v.trim() : v)))];
const uniqPaths = (list) => uniq((Array.isArray(list) ? list : []).map(pathStr).filter(Boolean));

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
        g = { key: k, order: groups.size, title: null, roles: [], files: [], edited_paths: [], removed_paths: [], symbols_removed: [], decisions: [], gates: [], verify: [], acceptance: [], deps: [], notes: [], kind: null, blocked_by: [], complexity: null, max_turns: null, budget_usd: null, model_hint: null, proves: [], ids: [] };
        groups.set(k, g);
      }
      if (!g.roles.includes(role)) g.roles.push(role);
      if (task.id) g.ids.push(`${role}:${task.id}`);
      if (!g.title && typeof task.title === 'string' && task.title.trim()) g.title = task.title.trim();
      else if (typeof task.title === 'string' && task.title.trim() && task.title.trim() !== g.title) g.notes.push(`${role}: ${task.title.trim()}`);
      g.files.push(...uniqPaths(task.files));
      g.edited_paths.push(...uniqPaths(task.edited_paths));
      g.removed_paths.push(...uniqPaths(task.removed_paths));
      if (Array.isArray(task.symbols_removed)) g.symbols_removed.push(...task.symbols_removed.map(String));
      if (Array.isArray(task.decisions)) g.decisions.push(...task.decisions.map(String));
      if (Array.isArray(task.gates)) g.gates.push(...task.gates.map(String));
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
        if (g.kind && g.kind !== task.kind) {
          const prevKind = g.kind;
          if ((KIND_RANK[task.kind] || 0) > (KIND_RANK[g.kind] || 0)) g.kind = task.kind;
          warnings.push(`${k}: kind diferente entre papéis (${prevKind} × ${task.kind}) — fica ${g.kind}`);
        } else g.kind = task.kind;
      }
      if (Array.isArray(task.blocked_by)) g.blocked_by.push(...task.blocked_by);
      if (task.complexity) {
        if (!g.complexity || (COMPLEXITY_RANK[task.complexity] || 0) > (COMPLEXITY_RANK[g.complexity] || 0)) g.complexity = task.complexity;
      }
      if (Number.isInteger(task.max_turns) && task.max_turns > 0) g.max_turns = Math.max(g.max_turns || 0, task.max_turns);
      // OXB-C24-1: the role file's per-task budget reaches PLAN.json (largest of the group, like max_turns)
      if (Number.isFinite(Number(task.budget_usd)) && Number(task.budget_usd) > 0) g.budget_usd = Math.max(g.budget_usd || 0, Number(task.budget_usd));
      if (task.model_hint && (!g.model_hint || (MODEL_HINT_RANK[task.model_hint] || 0) > (MODEL_HINT_RANK[g.model_hint] || 0))) g.model_hint = task.model_hint;
      if (task.proves && typeof task.proves === 'object' && !Array.isArray(task.proves)) g.proves.push({ role, map: task.proves, at });
      else if (Array.isArray(task.proves) && task.proves.length) warnings.push(`${at} (${k}): "proves" em lista na tarefa — use acceptance_tests[] ou { arquivo: [títulos] }; ignorado`);
    });
    for (const entry of Array.isArray(doc.acceptance_tests) ? doc.acceptance_tests : []) tests.push({ ...entry, _from: name });
  }

  // OXB-203: depends_on may name a task by its role id (`FE-AP1`, or `frontend:FE-AP1`) instead of the key (`A24`).
  const aliases = new Map();
  const ambiguous = new Set();
  for (const { file, doc } of inputs) {
    if (!doc || !Array.isArray(doc.tasks)) continue;
    const role = String(doc.role || path.basename(file, path.extname(file))).trim();
    for (const task of doc.tasks) {
      const k = task && task[key] != null ? String(task[key]).trim() : '';
      if (!k || task.id == null) continue;
      for (const alias of [String(task.id).trim(), `${role}:${String(task.id).trim()}`]) {
        if (!alias || groups.has(alias)) continue;
        if (aliases.has(alias) && aliases.get(alias) !== k) ambiguous.add(alias);
        else aliases.set(alias, k);
      }
    }
  }
  const resolveDep = (dep) => {
    const d = String(dep).trim();
    if (groups.has(d)) return d;
    if (ambiguous.has(d)) { errors.push(`depends_on "${d}" é ambíguo — o id aponta para mais de um ${key}; use o ${key}`); return null; }
    return aliases.has(d) ? aliases.get(d) : d;
  };
  for (const g of groups.values()) g.deps = uniq(g.deps.map(resolveDep).filter(Boolean));

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
  // Stable ids: a task that already has an id in the current PLAN.json (same merge key) keeps it; a new task (a CR's)
  // takes the next free id. The execution order comes from the dependencies, never from the id — and the executor
  // gives interrupted work back by id, so a shifted id would hand one task's partial edits to another (F2 CR-36).
  const previous = new Map();
  for (const t of (options.existing && Array.isArray(options.existing.tasks) ? options.existing.tasks : [])) if (t && t.id && t[key] != null) previous.set(String(t[key]), t);
  const idOf = new Map();
  if (previous.size) {
    let next = Math.max(0, ...[...previous.values()].map((t) => Number(String(t.id).replace(/^T/, '')) || 0)) + 1;
    for (const k of ordered) idOf.set(k, previous.has(k) ? String(previous.get(k).id) : `T${next++}`);
  } else ordered.forEach((k, i) => idOf.set(k, `T${i + 1}`));
  const dropped = [...previous.keys()].filter((k) => !groups.has(k));
  if (dropped.length) warnings.push(`tarefa(s) do PLAN.json atual que nenhum papel trouxe: ${dropped.map((k) => `${previous.get(k).id} (${k})`).join(', ')} — o id delas fica reservado (não é reaproveitado)`);

  // Acceptance tests: union, deduplicated by criterion + files + command; proves merged.
  const testKey = (t) => JSON.stringify([t.criterion || t.id || null, uniqPaths(t.files).sort(), String(t.command || '').trim()]);
  const merged = new Map();
  for (const t of tests) {
    const { _from, ...entry } = t;
    if (entry.proves && !Array.isArray(entry.proves)) { errors.push(`${_from}: acceptance_tests com "proves" que não é lista — use ["título", …]`); continue; }
    const k = testKey(entry);
    const cur = merged.get(k);
    if (cur) cur.proves = uniq([...(cur.proves || []), ...(entry.proves || [])]);
    else merged.set(k, { ...entry, files: uniqPaths(entry.files), ...(entry.proves ? { proves: uniq(entry.proves) } : {}) });
  }
  const acceptanceTests = [...merged.values()];
  // proves as { file: [titles] } (BACKEND's shape) → into the entry that already freezes that file, or a new one.
  for (const k of ordered) {
    const g = groups.get(k);
    for (const { map, at } of g.proves) {
      for (const [file, titles] of Object.entries(map)) {
        const list = (Array.isArray(titles) ? titles : [titles]).map(String).filter(Boolean);
        const norm = file.replace(/\\/g, '/');
        const hit = acceptanceTests.find((t) => (t.files || []).some((f) => pathStr(f).replace(/\\/g, '/') === norm));
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
    const editedPaths = uniqPaths(g.edited_paths);
    const removedPaths = uniqPaths(g.removed_paths);
    const symbolsRemoved = uniq(g.symbols_removed);
    const decisions = uniq(g.decisions);
    const gates = uniq(g.gates);
    const task = {
      id: idOf.get(k),
      title: g.title || k,
      wave: depth.get(k),
      [key]: k,
      roles: g.roles,
      ...(deps.length ? { depends_on: deps } : {}),
      files: uniqPaths(g.files),
      ...(editedPaths.length ? { edited_paths: editedPaths } : {}),
      ...(removedPaths.length ? { removed_paths: removedPaths } : {}),
      ...(symbolsRemoved.length ? { symbols_removed: symbolsRemoved } : {}),
      ...(decisions.length ? { decisions } : {}),
      ...(gates.length ? { gates } : {}),
      ...(uniq(g.verify).length ? { verify: { commands: uniq(g.verify) } } : {}),
      ...(uniq(g.acceptance).length ? { acceptance: uniq(g.acceptance) } : {}),
      ...(g.kind ? { kind: g.kind } : {}),
      ...(g.blocked_by.length ? { blocked_by: dedupeBlocked(g.blocked_by) } : {}),
      ...(g.complexity ? { complexity: g.complexity } : {}),
      ...(g.max_turns ? { max_turns: g.max_turns } : {}),
      ...(g.budget_usd ? { budget_usd: g.budget_usd } : {}),
      ...(g.model_hint ? { model_hint: g.model_hint } : {}),
      ...(g.notes.length ? { notes: uniq(g.notes).join('\n') } : {}),
    };
    const hasScopedPaths = task.files.length > 0 || editedPaths.length > 0 || removedPaths.length > 0;
    if (!hasScopedPaths && !['external_delivery', 'verify_only', 'spike'].includes(task.kind)) warnings.push(`${k}: nenhum papel declarou files`);
    // a task already done (with its commit or status: 'done') stays done: a re-merge never reopens it in silence
    const prev = previous.get(k);
    if (prev) {
      for (const [f, v] of Object.entries(prev)) if (/^done/.test(f) && task[f] === undefined) task[f] = v;
      if (prev.status === 'done' && task.status === undefined) task.status = 'done';
    }
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
