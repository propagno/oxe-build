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
export declare class ProgramTransitionError extends Error {
}
/**
 * OXB-038: criterion ids of a structured field. Parentheses and code spans are commentary ("A1, A2 (ver UI A3)"):
 * an id there is not the phase's. OXB-037: subcriteria A19.3 and global criteria G1 are ids too.
 */
export declare function criterionIdsInField(text: string): string[];
/**
 * `## Fase N — Título` (or `## Phase N - Title`) blocks with `**Requisitos:**`,
 * `**Critérios de aceite:**` and `**Escopo:**` lines, as in `oxe/templates/ROADMAP.template.md`.
 */
export declare function parseRoadmapPhases(markdown: string): Array<Pick<ProgramPhase, 'id' | 'title' | 'requirements' | 'acceptance' | 'scope' | 'depends_on'>>;
/** Phases a phase needs closed before it starts: its `depends_on`, or every earlier phase when it declares none. */
export declare function phaseDependencies(state: ProgramState, phase: ProgramPhase): ProgramPhase[];
/** Dependency problems of a program: unknown phase, self-dependency, cycle. */
export declare function validatePhaseDependencies(phases: Array<Pick<ProgramPhase, 'id' | 'depends_on'>>): string[];
export declare function createProgram(roadmapMarkdown: string, roadmapRef?: string | null): ProgramState;
export declare function findPhase(state: ProgramState, id: string): ProgramPhase | null;
export declare function activePhase(state: ProgramState): ProgramPhase | null;
/** First phase that is not closed (the one the flow should work on). */
export declare function nextOpenPhase(state: ProgramState): ProgramPhase | null;
export declare function closedPhasesBefore(state: ProgramState, id: string): ProgramPhase[];
export declare function programProgress(state: ProgramState): {
    index: number;
    total: number;
    closed: number;
    phase: ProgramPhase | null;
};
/**
 * A phase starts only when the phases it depends on are closed: its `depends_on` (OXB-033), or every earlier phase
 * (roadmap order) when it declares none. One .oxe/ has one active phase; independent phases run in parallel in
 * separate worktrees and come back with `program adopt`.
 */
export declare function startPhase(state: ProgramState, id?: string | null): ProgramState;
export declare function setPhaseStatus(state: ProgramState, id: string, status: Exclude<PhaseStatus, 'closed' | 'pending'>, patch?: Partial<Pick<ProgramPhase, 'plan_ref' | 'run_id'>>): ProgramState;
export declare function evaluatePhaseGate(input: PhaseGateInput): PhaseGateResult;
export declare function closePhase(state: ProgramState, id: string, gate: PhaseGateInput, record?: Partial<Pick<ProgramPhase, 'closed_commit' | 'regression_ref' | 'interfaces_ref' | 'run_id' | 'plan_ref'>>): {
    state: ProgramState;
    gate: PhaseGateResult;
};
/** Acceptance ids a plan for `phase` may reference that are outside the phase (plan lint). */
export declare function acceptanceOutsidePhase(phase: ProgramPhase, planAcceptance: string[]): string[];
