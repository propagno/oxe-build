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
  /**
   * OXB-033: phases this one depends on (ROADMAP `**Depende de:** F1, F2`). Absent/null = every earlier phase (the
   * serial default). Independent phases can run at the same time, each in its own worktree (its own .oxe/).
   */
  depends_on?: string[] | null;
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
 * OXB-038: criterion ids of a structured field. Parentheses and code spans are commentary ("A1, A2 (ver UI A3)"):
 * an id there is not the phase's. OXB-037: subcriteria A19.3 and global criteria G1 are ids too.
 */
export function criterionIdsInField(text: string): string[] {
  let t = String(text || '').replace(/`[^`]*`/g, ' ');
  for (let i = 0; i < 5 && /\([^()]*\)/.test(t); i += 1) t = t.replace(/\([^()]*\)/g, ' ');
  return [...new Set(t.match(/\b(?:A\d+(?:\.\d+)?|G\d+)\b/g) || [])];
}

const parentCriterion = (id: string) => id.replace(/^(A\d+)\.\d+$/, '$1');

/**
 * `## Fase N — Título` (or `## Phase N - Title`) blocks with `**Requisitos:**`,
 * `**Critérios de aceite:**` and `**Escopo:**` lines, as in `oxe/templates/ROADMAP.template.md`.
 */
export function parseRoadmapPhases(markdown: string): Array<Pick<ProgramPhase, 'id' | 'title' | 'requirements' | 'acceptance' | 'scope' | 'depends_on'>> {
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
    const depsRaw = /\*\*(?:Depende de|Depends on|Dependências|Dependencies):\*\*\s*(.+)/i.exec(body);
    const depends_on = depsRaw
      ? [...new Set((depsRaw[1].replace(/\([^()]*\)/g, ' ').match(/\b(?:F|Fase\s*|Phase\s*)(\d+)\b/gi) || []).map((v) => `F${Number(v.replace(/\D/g, ''))}`))]
      : null;
    return {
      id: `F${Number(m[1])}`,
      title: m[2].trim() || `Fase ${Number(m[1])}`,
      requirements: idList(field(/\*\*(?:Requisitos|Requirements):\*\*\s*(.+)/i)).filter((v) => /^R/.test(v)),
      acceptance: criterionIdsInField(field(/\*\*(?:Crit[ée]rios de aceite|Acceptance(?: criteria)?):\*\*\s*(.+)/i)),
      scope: scope || null,
      ...(depends_on ? { depends_on } : {}),
    };
  });
}

/** Phases a phase needs closed before it starts: its `depends_on`, or every earlier phase when it declares none. */
export function phaseDependencies(state: ProgramState, phase: ProgramPhase): ProgramPhase[] {
  const index = state.phases.indexOf(phase);
  if (Array.isArray(phase.depends_on)) return phase.depends_on.map((id) => findPhase(state, id)).filter((p): p is ProgramPhase => Boolean(p));
  return state.phases.slice(0, index < 0 ? 0 : index);
}

/** Dependency problems of a program: unknown phase, self-dependency, cycle. */
export function validatePhaseDependencies(phases: Array<Pick<ProgramPhase, 'id' | 'depends_on'>>): string[] {
  const ids = new Set(phases.map((p) => p.id));
  const errors: string[] = [];
  for (const p of phases) {
    for (const d of p.depends_on ?? []) {
      if (d === p.id) errors.push(`${p.id} depende de si mesma`);
      else if (!ids.has(d)) errors.push(`${p.id} depende de ${d}, que não existe no ROADMAP`);
    }
  }
  const deps = new Map(phases.map((p, i) => [p.id, p.depends_on ?? phases.slice(0, i).map((q) => q.id)]));
  const state = new Map<string, number>();
  const visit = (id: string, chain: string[]): boolean => {
    if (state.get(id) === 1) { errors.push(`ciclo de dependência entre fases: ${[...chain, id].join(' → ')}`); return true; }
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d, [...chain, id])) return true;
    state.set(id, 2);
    return false;
  };
  for (const p of phases) if (visit(p.id, [])) break;
  return [...new Set(errors)];
}

export function createProgram(roadmapMarkdown: string, roadmapRef: string | null = null): ProgramState {
  const parsed = parseRoadmapPhases(roadmapMarkdown);
  if (parsed.length === 0) throw new ProgramTransitionError('ROADMAP sem fases (`## Fase N — …`)');
  const ids = new Set<string>();
  for (const phase of parsed) {
    if (ids.has(phase.id)) throw new ProgramTransitionError(`fase duplicada no ROADMAP: ${phase.id}`);
    ids.add(phase.id);
  }
  const depErrors = validatePhaseDependencies(parsed);
  if (depErrors.length) throw new ProgramTransitionError(depErrors.join('; '));
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

/**
 * A phase starts only when the phases it depends on are closed: its `depends_on` (OXB-033), or every earlier phase
 * (roadmap order) when it declares none. One .oxe/ has one active phase; independent phases run in parallel in
 * separate worktrees and come back with `program adopt`.
 */
export function startPhase(state: ProgramState, id?: string | null): ProgramState {
  const next = clone(state);
  const target = id ? findPhase(next, id) : nextOpenPhase(next);
  if (!target) throw new ProgramTransitionError(id ? `fase inexistente: ${id}` : 'todas as fases estão fechadas');
  if (target.status === 'closed') throw new ProgramTransitionError(`fase ${target.id} já está fechada`);
  const open = phaseDependencies(next, target).filter((p) => p.status !== 'closed');
  if (open.length) throw new ProgramTransitionError(`feche antes: ${open.map((p) => p.id).join(', ')}${Array.isArray(target.depends_on) ? ` (${target.id} depende de ${target.depends_on.join(', ')})` : ''}`);
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
  // A subcriterion belongs to its parent's phase; a global G* to every phase (OXB-037).
  return [...new Set(planAcceptance)].filter((ref) => !allowed.has(ref) && !allowed.has(parentCriterion(ref)) && !/^G\d+$/.test(ref));
}
