/**
 * Program = an approved ROADMAP executed phase by phase (1.19). Each phase is a full OXE cycle
 * (plan → execute → verify) and closes through a phase gate: verify completed, regression of the
 * closed phases green, pack contracts ok. Pure state transitions — persistence lives in the CLI.
 */

export type PhaseStatus = 'pending' | 'planning' | 'executing' | 'verifying' | 'closed';

export interface ProgramPhase {
  id: string;
  title: string;
  requirements: string[];
  acceptance: string[];
  scope: string | null;
  status: PhaseStatus;
  plan_ref: string | null;
  run_id: string | null;
  started_at: string | null;
  closed_at: string | null;
  closed_commit: string | null;
  /** `.oxe/program/regression/<id>.json` — frozen executable checks of the phase. */
  regression_ref: string | null;
  /** `.oxe/program/interfaces/<id>.json` — real exports of the contracted files. */
  interfaces_ref: string | null;
}

export interface ProgramState {
  schema_version: 1;
  roadmap_ref: string | null;
  active_phase: string | null;
  phases: ProgramPhase[];
  created_at: string;
  updated_at: string;
}

export interface PhaseGateInput {
  /** Run status after `runtime verify` (`completed` is the only passing value). */
  verify_status: string | null;
  /** Ids of failed regression checks (`reg-<phase>-…`). */
  regression_failed: string[];
  /** Ids of failed `contract` checks of this phase. */
  contract_failed: string[];
  /** Ids of other failed checks. */
  checks_failed: string[];
}

export interface PhaseGateResult {
  ok: boolean;
  reasons: string[];
}

export class ProgramTransitionError extends Error {}

const now = () => new Date().toISOString();

function idList(text: string): string[] {
  return [...new Set((String(text || '').match(/\b[A-Z]{1,4}-?\d+[a-z]?\b/g) || []).map((v) => v.trim()))];
}

/**
 * `## Fase N — Título` (or `## Phase N - Title`) blocks with `**Requisitos:**`,
 * `**Critérios de aceite:**` and `**Escopo:**` lines, as in `oxe/templates/ROADMAP.template.md`.
 */
export function parseRoadmapPhases(markdown: string): Array<Pick<ProgramPhase, 'id' | 'title' | 'requirements' | 'acceptance' | 'scope'>> {
  const text = String(markdown || '').replace(/<!--[\s\S]*?-->/g, '');
  const heading = /^##\s+(?:Fase|Phase)\s+(\d+)\s*(?:[—–:-]\s*)?(.*)$/gim;
  const marks = [...text.matchAll(heading)];
  return marks.map((m, i) => {
    const body = text.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined);
    const field = (re: RegExp) => {
      const hit = re.exec(body);
      return hit ? hit[1].trim() : '';
    };
    const scope = field(/\*\*(?:Escopo|Scope):\*\*\s*(.+)/i);
    return {
      id: `F${Number(m[1])}`,
      title: m[2].trim() || `Fase ${Number(m[1])}`,
      requirements: idList(field(/\*\*(?:Requisitos|Requirements):\*\*\s*(.+)/i)).filter((v) => /^R/.test(v)),
      acceptance: idList(field(/\*\*(?:Crit[ée]rios de aceite|Acceptance(?: criteria)?):\*\*\s*(.+)/i)).filter((v) => /^A/.test(v)),
      scope: scope || null,
    };
  });
}

export function createProgram(roadmapMarkdown: string, roadmapRef: string | null = null): ProgramState {
  const parsed = parseRoadmapPhases(roadmapMarkdown);
  if (parsed.length === 0) throw new ProgramTransitionError('ROADMAP sem fases (`## Fase N — …`)');
  const ids = new Set<string>();
  for (const phase of parsed) {
    if (ids.has(phase.id)) throw new ProgramTransitionError(`fase duplicada no ROADMAP: ${phase.id}`);
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

function clone(state: ProgramState): ProgramState {
  return JSON.parse(JSON.stringify(state));
}

export function findPhase(state: ProgramState, id: string): ProgramPhase | null {
  const key = String(id || '').trim().toUpperCase().replace(/^(?:FASE|PHASE)\s*/, 'F');
  const normalized = /^\d+$/.test(key) ? `F${Number(key)}` : key;
  return state.phases.find((p) => p.id.toUpperCase() === normalized) ?? null;
}

export function activePhase(state: ProgramState): ProgramPhase | null {
  return state.active_phase ? findPhase(state, state.active_phase) : null;
}

/** First phase that is not closed (the one the flow should work on). */
export function nextOpenPhase(state: ProgramState): ProgramPhase | null {
  return state.phases.find((p) => p.status !== 'closed') ?? null;
}

export function closedPhasesBefore(state: ProgramState, id: string): ProgramPhase[] {
  const index = state.phases.findIndex((p) => p.id === id);
  return state.phases.slice(0, index < 0 ? state.phases.length : index).filter((p) => p.status === 'closed');
}

export function programProgress(state: ProgramState): { index: number; total: number; closed: number; phase: ProgramPhase | null } {
  const phase = activePhase(state) ?? nextOpenPhase(state);
  return {
    index: phase ? state.phases.indexOf(phase) + 1 : state.phases.length,
    total: state.phases.length,
    closed: state.phases.filter((p) => p.status === 'closed').length,
    phase,
  };
}

/** Phases run in roadmap order: a phase starts only when every earlier phase is closed. */
export function startPhase(state: ProgramState, id?: string | null): ProgramState {
  const next = clone(state);
  const target = id ? findPhase(next, id) : nextOpenPhase(next);
  if (!target) throw new ProgramTransitionError(id ? `fase inexistente: ${id}` : 'todas as fases estão fechadas');
  if (target.status === 'closed') throw new ProgramTransitionError(`fase ${target.id} já está fechada`);
  const open = next.phases.slice(0, next.phases.indexOf(target)).filter((p) => p.status !== 'closed');
  if (open.length) throw new ProgramTransitionError(`feche antes: ${open.map((p) => p.id).join(', ')}`);
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

const FORWARD: Record<PhaseStatus, PhaseStatus[]> = {
  pending: ['planning'],
  planning: ['executing'],
  executing: ['verifying'],
  // A failed verify sends the phase back to execution (or re-planning) — never straight to closed.
  verifying: ['executing', 'planning'],
  closed: [],
};

export function setPhaseStatus(
  state: ProgramState,
  id: string,
  status: Exclude<PhaseStatus, 'closed' | 'pending'>,
  patch: Partial<Pick<ProgramPhase, 'plan_ref' | 'run_id'>> = {},
): ProgramState {
  const next = clone(state);
  const phase = findPhase(next, id);
  if (!phase) throw new ProgramTransitionError(`fase inexistente: ${id}`);
  if (phase.status !== status && !FORWARD[phase.status].includes(status)) {
    throw new ProgramTransitionError(`transição inválida ${phase.id}: ${phase.status} → ${status}`);
  }
  phase.status = status;
  if (patch.plan_ref !== undefined) phase.plan_ref = patch.plan_ref;
  if (patch.run_id !== undefined) phase.run_id = patch.run_id;
  next.updated_at = now();
  return next;
}

export function evaluatePhaseGate(input: PhaseGateInput): PhaseGateResult {
  const reasons: string[] = [];
  if (input.verify_status !== 'completed') reasons.push(`verify não concluído (status: ${input.verify_status ?? 'ausente'})`);
  if (input.regression_failed.length) reasons.push(`regressão de fases anteriores: ${input.regression_failed.join(', ')}`);
  if (input.contract_failed.length) reasons.push(`contratos do pack: ${input.contract_failed.join(', ')}`);
  if (input.checks_failed.length) reasons.push(`checks falhados: ${input.checks_failed.join(', ')}`);
  return { ok: reasons.length === 0, reasons };
}

export function closePhase(
  state: ProgramState,
  id: string,
  gate: PhaseGateInput,
  record: Partial<Pick<ProgramPhase, 'closed_commit' | 'regression_ref' | 'interfaces_ref' | 'run_id' | 'plan_ref'>> = {},
): { state: ProgramState; gate: PhaseGateResult } {
  const phase = findPhase(state, id);
  if (!phase) throw new ProgramTransitionError(`fase inexistente: ${id}`);
  if (phase.status === 'closed') throw new ProgramTransitionError(`fase ${phase.id} já está fechada`);
  if (phase.status === 'pending') throw new ProgramTransitionError(`fase ${phase.id} não foi iniciada`);
  const result = evaluatePhaseGate(gate);
  if (!result.ok) return { state, gate: result };
  const next = clone(state);
  const target = findPhase(next, id)!;
  Object.assign(target, record);
  target.status = 'closed';
  target.closed_at = now();
  next.active_phase = null;
  next.updated_at = now();
  return { state: next, gate: result };
}

/** Acceptance ids a plan for `phase` may reference that are outside the phase (plan lint). */
export function acceptanceOutsidePhase(phase: ProgramPhase, planAcceptance: string[]): string[] {
  if (!phase.acceptance.length) return [];
  const allowed = new Set(phase.acceptance);
  return [...new Set(planAcceptance)].filter((ref) => !allowed.has(ref));
}
