'use strict';

/**
 * Acceptance criterion ids (1.21.2).
 *
 * - `A<n>`: a SPEC criterion, owned by one program phase.
 * - `A<n>.<m>` (OXB-037): a subcriterion of A<n> (e.g. one screen/state of a UI criterion). It belongs to the phase of
 *   its parent; when the SPEC declares subcriteria of A<n>, covering A<n> means covering each of them.
 * - `G<n>` (OXB-037): a global criterion (contrast, keyboard, 900 px …) that holds for every UI task of every phase.
 *
 * OXB-038: ids count only in structured fields (the SPEC criteria table, the ROADMAP `**Critérios de aceite:**` line
 * outside parentheses and code spans, PLAN.json `acceptance`), never in prose.
 */

const CRITERION_ID_RE = /^(?:A\d+(?:\.\d+)?|G\d+)$/;
const CRITERION_TOKEN_RE = /\b(?:A\d+(?:\.\d+)?|G\d+)\b/g;

const isCriterionId = (id) => CRITERION_ID_RE.test(String(id || '').trim());
const isGlobal = (id) => /^G\d+$/.test(String(id || ''));
const isSub = (id) => /^A\d+\.\d+$/.test(String(id || ''));
/** `A19.3` → `A19`; anything else → itself. */
const parentOf = (id) => String(id || '').replace(/^(A\d+)\.\d+$/, '$1');

/** Ids of a structured field's text: parentheses and code spans are commentary, not ids (OXB-038). */
function idsInField(text) {
  let t = String(text || '').replace(/`[^`]*`/g, ' ');
  // nested parentheses: strip innermost first
  for (let i = 0; i < 5 && /\([^()]*\)/.test(t); i += 1) t = t.replace(/\([^()]*\)/g, ' ');
  return [...new Set(t.match(CRITERION_TOKEN_RE) || [])];
}

/** Whether `ref` belongs to a phase whose acceptance list is `phaseAcceptance` (its own id, its parent's, or a G*). */
function inPhase(ref, phaseAcceptance) {
  const allowed = phaseAcceptance instanceof Set ? phaseAcceptance : new Set(phaseAcceptance || []);
  return allowed.has(ref) || allowed.has(parentOf(ref)) || isGlobal(ref);
}

/** Declared subcriteria of each parent, from the SPEC criteria ids. */
function subcriteriaOf(specIds) {
  const map = new Map();
  for (const id of specIds || []) {
    if (!isSub(id)) continue;
    const p = parentOf(id);
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(id);
  }
  return map;
}

/**
 * Coverage of a list of criteria by a set of referenced ids: a parent with declared subcriteria is covered when every
 * subcriterion is (the missing ones are reported, not the parent).
 * @returns {string[]} the ids still uncovered
 */
function uncovered(criteria, covered, specIds) {
  const subs = subcriteriaOf(specIds);
  const out = [];
  for (const ref of criteria) {
    const own = subs.get(ref);
    if (own && own.length) out.push(...own.filter((s) => !covered.has(s)));
    else if (!covered.has(ref) && !(isSub(ref) && covered.has(parentOf(ref)) && !subs.has(parentOf(ref)))) out.push(ref);
  }
  return [...new Set(out)];
}

const UI_FILE_RE = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$/i;
const isUiTask = (task) => (task && (task.files || [])).some((f) => UI_FILE_RE.test(String(f)));

/**
 * OXB-091: standing criteria (`program.standing_acceptance` in .oxe/config.json, e.g. ["A70"] — the per-phase UI gate
 * "visual totalmente polido"): they hold at EVERY phase close, by a sign-off of that phase with evidence; never "of
 * another phase", never "A* da fase sem tarefa".
 */
function standingAcceptance(projectRoot) {
  try {
    const config = JSON.parse(require('fs').readFileSync(require('path').join(projectRoot, '.oxe', 'config.json'), 'utf8')) || {};
    const list = config.program && Array.isArray(config.program.standing_acceptance) ? config.program.standing_acceptance : [];
    return [...new Set(list.map((v) => String(v).trim().toUpperCase()).filter((v) => CRITERION_ID_RE.test(v)))];
  } catch { return []; }
}

/** OXB-159: CR ids — `CR-07` (program tree) or `CR-F4-1` (scoped to a phase: forked worktrees, adopted renames). */
const CR_ID_RE = /^CR-(?:[A-Z][A-Z0-9.]*-)?\d+$/;

module.exports = {
  CR_ID_RE,
  standingAcceptance, CRITERION_ID_RE, CRITERION_TOKEN_RE, isCriterionId, isGlobal, isSub, parentOf, idsInField, inPhase, subcriteriaOf, uncovered, isUiTask, UI_FILE_RE };
