"use strict";
/**
 * Program = an approved ROADMAP executed phase by phase (1.19). Each phase is a full OXE cycle
 * (plan → execute → verify) and closes through a phase gate: verify completed, regression of the
 * closed phases green, pack contracts ok. Pure state transitions — persistence lives in the CLI.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgramTransitionError = void 0;
exports.criterionIdsInField = criterionIdsInField;
exports.parseRoadmapPhases = parseRoadmapPhases;
exports.createProgram = createProgram;
exports.findPhase = findPhase;
exports.activePhase = activePhase;
exports.nextOpenPhase = nextOpenPhase;
exports.closedPhasesBefore = closedPhasesBefore;
exports.programProgress = programProgress;
exports.startPhase = startPhase;
exports.setPhaseStatus = setPhaseStatus;
exports.evaluatePhaseGate = evaluatePhaseGate;
exports.closePhase = closePhase;
exports.acceptanceOutsidePhase = acceptanceOutsidePhase;
class ProgramTransitionError extends Error {
}
exports.ProgramTransitionError = ProgramTransitionError;
const now = () => new Date().toISOString();
function idList(text) {
    return [...new Set((String(text || '').match(/\b[A-Z]{1,4}-?\d+[a-z]?\b/g) || []).map((v) => v.trim()))];
}
/**
 * OXB-038: criterion ids of a structured field. Parentheses and code spans are commentary ("A1, A2 (ver UI A3)"):
 * an id there is not the phase's. OXB-037: subcriteria A19.3 and global criteria G1 are ids too.
 */
function criterionIdsInField(text) {
    let t = String(text || '').replace(/`[^`]*`/g, ' ');
    for (let i = 0; i < 5 && /\([^()]*\)/.test(t); i += 1)
        t = t.replace(/\([^()]*\)/g, ' ');
    return [...new Set(t.match(/\b(?:A\d+(?:\.\d+)?|G\d+)\b/g) || [])];
}
const parentCriterion = (id) => id.replace(/^(A\d+)\.\d+$/, '$1');
/**
 * `## Fase N — Título` (or `## Phase N - Title`) blocks with `**Requisitos:**`,
 * `**Critérios de aceite:**` and `**Escopo:**` lines, as in `oxe/templates/ROADMAP.template.md`.
 */
function parseRoadmapPhases(markdown) {
    const text = String(markdown || '').replace(/<!--[\s\S]*?-->/g, '');
    const heading = /^##\s+(?:Fase|Phase)\s+(\d+)\s*(?:[—–:-]\s*)?(.*)$/gim;
    const marks = [...text.matchAll(heading)];
    return marks.map((m, i) => {
        const body = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined);
        const field = (re) => {
            const hit = re.exec(body);
            return hit ? hit[1].trim() : '';
        };
        const scope = field(/\*\*(?:Escopo|Scope):\*\*\s*(.+)/i);
        return {
            id: `F${Number(m[1])}`,
            title: m[2].trim() || `Fase ${Number(m[1])}`,
            requirements: idList(field(/\*\*(?:Requisitos|Requirements):\*\*\s*(.+)/i)).filter((v) => /^R/.test(v)),
            acceptance: criterionIdsInField(field(/\*\*(?:Crit[ée]rios de aceite|Acceptance(?: criteria)?):\*\*\s*(.+)/i)),
            scope: scope || null,
        };
    });
}
function createProgram(roadmapMarkdown, roadmapRef = null) {
    const parsed = parseRoadmapPhases(roadmapMarkdown);
    if (parsed.length === 0)
        throw new ProgramTransitionError('ROADMAP sem fases (`## Fase N — …`)');
    const ids = new Set();
    for (const phase of parsed) {
        if (ids.has(phase.id))
            throw new ProgramTransitionError(`fase duplicada no ROADMAP: ${phase.id}`);
        ids.add(phase.id);
    }
    const ts = now();
    return {
        schema_version: 1,
        roadmap_ref: roadmapRef,
        active_phase: null,
        phases: parsed.map((phase) => ({
            ...phase,
            status: 'pending',
            plan_ref: null,
            run_id: null,
            started_at: null,
            closed_at: null,
            closed_commit: null,
            regression_ref: null,
            interfaces_ref: null,
        })),
        created_at: ts,
        updated_at: ts,
    };
}
function clone(state) {
    return JSON.parse(JSON.stringify(state));
}
function findPhase(state, id) {
    const key = String(id || '').trim().toUpperCase().replace(/^(?:FASE|PHASE)\s*/, 'F');
    const normalized = /^\d+$/.test(key) ? `F${Number(key)}` : key;
    return state.phases.find((p) => p.id.toUpperCase() === normalized) ?? null;
}
function activePhase(state) {
    return state.active_phase ? findPhase(state, state.active_phase) : null;
}
/** First phase that is not closed (the one the flow should work on). */
function nextOpenPhase(state) {
    return state.phases.find((p) => p.status !== 'closed') ?? null;
}
function closedPhasesBefore(state, id) {
    const index = state.phases.findIndex((p) => p.id === id);
    return state.phases.slice(0, index < 0 ? state.phases.length : index).filter((p) => p.status === 'closed');
}
function programProgress(state) {
    const phase = activePhase(state) ?? nextOpenPhase(state);
    return {
        index: phase ? state.phases.indexOf(phase) + 1 : state.phases.length,
        total: state.phases.length,
        closed: state.phases.filter((p) => p.status === 'closed').length,
        phase,
    };
}
/** Phases run in roadmap order: a phase starts only when every earlier phase is closed. */
function startPhase(state, id) {
    const next = clone(state);
    const target = id ? findPhase(next, id) : nextOpenPhase(next);
    if (!target)
        throw new ProgramTransitionError(id ? `fase inexistente: ${id}` : 'todas as fases estão fechadas');
    if (target.status === 'closed')
        throw new ProgramTransitionError(`fase ${target.id} já está fechada`);
    const open = next.phases.slice(0, next.phases.indexOf(target)).filter((p) => p.status !== 'closed');
    if (open.length)
        throw new ProgramTransitionError(`feche antes: ${open.map((p) => p.id).join(', ')}`);
    const current = activePhase(next);
    if (current && current.id !== target.id && current.status !== 'closed') {
        throw new ProgramTransitionError(`fase ${current.id} ainda está ativa`);
    }
    if (target.status === 'pending') {
        target.status = 'planning';
        target.started_at = now();
    }
    next.active_phase = target.id;
    next.updated_at = now();
    return next;
}
const FORWARD = {
    pending: ['planning'],
    planning: ['executing'],
    executing: ['verifying'],
    // A failed verify sends the phase back to execution (or re-planning) — never straight to closed.
    verifying: ['executing', 'planning'],
    closed: [],
};
function setPhaseStatus(state, id, status, patch = {}) {
    const next = clone(state);
    const phase = findPhase(next, id);
    if (!phase)
        throw new ProgramTransitionError(`fase inexistente: ${id}`);
    if (phase.status !== status && !FORWARD[phase.status].includes(status)) {
        throw new ProgramTransitionError(`transição inválida ${phase.id}: ${phase.status} → ${status}`);
    }
    phase.status = status;
    if (patch.plan_ref !== undefined)
        phase.plan_ref = patch.plan_ref;
    if (patch.run_id !== undefined)
        phase.run_id = patch.run_id;
    next.updated_at = now();
    return next;
}
function evaluatePhaseGate(input) {
    const reasons = [];
    if (input.verify_status !== 'completed')
        reasons.push(`verify não concluído (status: ${input.verify_status ?? 'ausente'})`);
    if (input.regression_failed.length)
        reasons.push(`regressão de fases anteriores: ${input.regression_failed.join(', ')}`);
    if (input.contract_failed.length)
        reasons.push(`contratos do pack: ${input.contract_failed.join(', ')}`);
    if (input.checks_failed.length)
        reasons.push(`checks falhados: ${input.checks_failed.join(', ')}`);
    return { ok: reasons.length === 0, reasons };
}
function closePhase(state, id, gate, record = {}) {
    const phase = findPhase(state, id);
    if (!phase)
        throw new ProgramTransitionError(`fase inexistente: ${id}`);
    if (phase.status === 'closed')
        throw new ProgramTransitionError(`fase ${phase.id} já está fechada`);
    if (phase.status === 'pending')
        throw new ProgramTransitionError(`fase ${phase.id} não foi iniciada`);
    const result = evaluatePhaseGate(gate);
    if (!result.ok)
        return { state, gate: result };
    const next = clone(state);
    const target = findPhase(next, id);
    Object.assign(target, record);
    target.status = 'closed';
    target.closed_at = now();
    next.active_phase = null;
    next.updated_at = now();
    return { state: next, gate: result };
}
/** Acceptance ids a plan for `phase` may reference that are outside the phase (plan lint). */
function acceptanceOutsidePhase(phase, planAcceptance) {
    if (!phase.acceptance.length)
        return [];
    const allowed = new Set(phase.acceptance);
    // A subcriterion belongs to its parent's phase; a global G* to every phase (OXB-037).
    return [...new Set(planAcceptance)].filter((ref) => !allowed.has(ref) && !allowed.has(parentCriterion(ref)) && !/^G\d+$/.test(ref));
}
