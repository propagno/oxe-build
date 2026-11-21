'use strict';

/**
 * OXB-185: the turns of an attempt, sized to the task. A task's own `max_turns` (PLAN.json) wins; else its size —
 * `size: S|M|L` declared, or estimated from the scope (files + pack symbols; a glob counts as 3) — maps to
 * `execute.turns` (default S 15, M 30, L 60). A retry after `turns_exhausted` gets the next size up. The provider's
 * `runtime.provider.maxTurns` (or --max-turns) stays the global upper bound.
 */

const DEFAULT_TURNS = Object.freeze({ S: 15, M: 30, L: 60 });
const ORDER = ['S', 'M', 'L'];

const COMPLEXITY_TO_SIZE = Object.freeze({ XS: 'S', S: 'S', M: 'M', L: 'L', XL: 'L' });

function estimateSize(task, packEntry) {
  if (task && ORDER.includes(String(task.size || '').toUpperCase())) return String(task.size).toUpperCase();
  // OXB-C21 #3: respect explicit `complexity` (XS|S|M|L|XL) declared in PLAN.json instead of overriding M as L.
  const comp = task && task.complexity ? COMPLEXITY_TO_SIZE[String(task.complexity).toUpperCase()] : null;
  if (comp) return comp;
  const files = Array.isArray(task && task.files) ? task.files : [];
  const weight = files.reduce((n, f) => n + (String(f).includes('*') ? 3 : 1), 0) + Math.ceil((((packEntry && packEntry.symbols) || []).length) / 2);
  return weight <= 2 ? 'S' : weight <= 6 ? 'M' : 'L';
}

function positiveInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function createTurnSizer(config, tasksById, packById) {
  const table = { ...DEFAULT_TURNS, ...((config && config.execute && config.execute.turns) || {}) };
  return (taskId, attempt, lastFailureClass) => {
    const task = tasksById.get(taskId);
    if (!task) return null;
    if (Number.isInteger(task.max_turns) && task.max_turns > 0) return lastFailureClass === 'turns_exhausted' ? task.max_turns * 2 : task.max_turns;
    const size = estimateSize(task, packById.get(taskId));
    const base = positiveInt(table[size], DEFAULT_TURNS[size]);
    if (lastFailureClass !== 'turns_exhausted') return base;
    const idx = ORDER.indexOf(size);
    if (idx < ORDER.length - 1) {
      const nextSize = ORDER[idx + 1];
      return positiveInt(table[nextSize], DEFAULT_TURNS[nextSize]);
    }
    // Already at largest tier (`L`): escalate to configured `XL` or 1.5× `L` so retry actually gets more turns!
    return positiveInt(table.XL, Math.ceil(base * 1.5));
  };
}

/** Lint: tasks whose size needs more turns than the global cap allows. */
function turnWarnings(doc, pack, config) {
  const cap = config && config.runtime && config.runtime.provider && Number(config.runtime.provider.maxTurns);
  const table = { ...DEFAULT_TURNS, ...((config && config.execute && config.execute.turns) || {}) };
  const packById = new Map(((pack && pack.tasks) || []).map((x) => [x.id || x.task, x]));
  const out = [];
  for (const t of (doc && doc.tasks) || []) {
    if (!t || t.done || t.status === 'done' || t.status === 'superseded' || t.superseded || t.merged_into) continue;
    const sz = estimateSize(t, packById.get(t.id));
    const need = Number.isInteger(t.max_turns) && t.max_turns > 0 ? t.max_turns : positiveInt(table[sz], DEFAULT_TURNS[sz]);
    if (cap && cap < need) out.push(`${t.id}: tarefa ${sz} pede ${need} turnos, mas runtime.provider.maxTurns=${cap} limita — a tentativa termina em turns_exhausted (suba o teto, declare max_turns ou divida a tarefa)`);
  }
  return out;
}

module.exports = { DEFAULT_TURNS, estimateSize, createTurnSizer, turnWarnings };
