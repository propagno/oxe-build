'use strict';

/**
 * OXB-121: the state as a contract. `.oxe/state.json` (contract 1.0.0, every key always present, unknown = null) is
 * written at every projection of STATE.md; `oxe-cc state validate` compares what STATE.md claims with the sources of
 * truth (the run journal, PROGRAM.json, PLAN.json, the CR log) and lists the divergences; `state sync` rewrites the
 * projections from the sources.
 */

const fs = require('fs');
const path = require('path');

const CONTRACT = '1.0.0';

function buildStateJson(src) {
  const w = src.work || {};
  const run = src.run || {};
  const failedRun = Array.isArray(run.failed) ? run.failed : ((run.canonical_state && run.canonical_state.failedWorkItems) || []);
  const done = new Set(w.done || []);
  return {
    contract: CONTRACT,
    active_session: src.activeSession ? String(src.activeSession).trim().replace(/\\/g, '/') : null,
    program: src.program ? { active_phase: src.program.active_phase || null, phases: (src.program.phases || []).map((p) => ({ id: p.id, status: p.status })) } : null,
    phase: src.program && src.program.active_phase ? { id: src.program.active_phase, status: ((src.program.phases || []).find((p) => p.id === src.program.active_phase) || {}).status || null } : null,
    run: run.run_id ? { id: run.run_id, status: run.status || null, verification_status: run.verification_status || null } : null,
    tasks: {
      total: w.total != null ? w.total : null,
      done: w.done || [],
      failed: failedRun.filter((id) => !done.has(id)),
      blocked: Object.keys(w.waiting || {}),
      pending: w.pending || [],
      external: w.external_pending || [],
      checkpoint_failed: src.checkpointFailed || [],
    },
    // the active phase's open CRs (and the phase-less ones); a CR of another phase — an amendment of a pending phase's
    // criterion — is listed apart, never as the active run's (OxeSpace 15/11, OxeChat F3 with CR-F4-1/2)
    open_crs: (src.changes || []).filter((c) => c.status === 'open' && (!src.program || !src.program.active_phase || !c.phase || c.phase === src.program.active_phase)).map((c) => c.id),
    open_crs_other_phases: (src.changes || []).filter((c) => c.status === 'open' && src.program && src.program.active_phase && c.phase && c.phase !== src.program.active_phase).map((c) => ({ id: c.id, phase: c.phase })),
    next: (w.next_steps && w.next_steps[0]) || null,
    updated_at: src.at || new Date().toISOString(),
  };
}

/** Stable comparison: everything but updated_at. */
function sameState(a, b) {
  const strip = (x) => JSON.stringify({ ...x, updated_at: null });
  return strip(a) === strip(b);
}

function writeStateJson(projectRoot, state) {
  const file = path.join(projectRoot, '.oxe', 'state.json');
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { prev = null; }
  if (prev && sameState(prev, state)) return { file, changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return { file, changed: true };
}

/**
 * What STATE.md claims vs the sources. @returns {Array<{ field, claims, truth }>}
 */
function validateStateMd(text, state) {
  const out = [];
  const t = String(text || '');
  const runStatus = state.run && state.run.status;
  const m1 = /- \*\*Status da run:\*\* ([^\n]*)/.exec(t);
  if (m1 && runStatus && m1[1].trim() !== runStatus) out.push({ field: 'Status da run', claims: m1[1].trim(), truth: runStatus });
  const m2 = /- \*\*runtime_status:\*\* ([^\n]*)/.exec(t);
  if (m2 && runStatus && m2[1].trim() !== runStatus) out.push({ field: 'runtime_status', claims: m2[1].trim(), truth: runStatus });
  const m3 = /- \*\*Concluídos \((\d+)\):\*\*/.exec(t);
  if (m3 && state.tasks.total != null && Number(m3[1]) !== state.tasks.done.length) out.push({ field: 'Concluídos', claims: Number(m3[1]), truth: state.tasks.done.length });
  const m4 = /- \*\*Falhos \((\d+)\):\*\* ([^\n]*)/.exec(t);
  if (m4) {
    const listed = m4[2].trim() === '—' ? [] : m4[2].split(',').map((x) => x.trim()).filter(Boolean);
    const wrong = listed.filter((id) => state.tasks.done.includes(id));
    if (wrong.length) out.push({ field: 'Falhos', claims: listed.join(', '), truth: `${wrong.join(', ')} já done` });
  }
  // "completed" claimed anywhere while the run of the same id failed
  if (runStatus === 'failed' && !out.some((d) => /status/i.test(d.field)) && /status:\*?\*?\s*completed\b/i.test(t)) out.push({ field: 'status', claims: 'completed', truth: 'failed' });
  if (state.phase) {
    const m5 = /▶ (F\d+)/.exec(t);
    if (m5 && m5[1] !== state.phase.id) out.push({ field: 'fase ativa', claims: m5[1], truth: state.phase.id });
  }
  return out;
}

/**
 * 1.23.0 (OXB-230-22): Reads the canonical active session pointer from `.oxe/state.json`.
 */
function readActiveSessionPointer(projectRoot) {
  const file = path.join(path.resolve(projectRoot || process.cwd()), '.oxe', 'state.json');
  try {
    if (!fs.existsSync(file)) return null;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const val = doc && typeof doc.active_session === 'string' ? doc.active_session.trim().replace(/\\/g, '/') : '';
    if (!val || /^(nenhuma|none|raiz|-|—)$/i.test(val)) return null;
    return val;
  } catch {
    return null;
  }
}

module.exports = { CONTRACT, buildStateJson, writeStateJson, readActiveSessionPointer, validateStateMd, sameState };
