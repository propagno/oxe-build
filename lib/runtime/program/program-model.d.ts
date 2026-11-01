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
export declare class ProgramTransitionError extends Error {
}
/**
 * `## Fase N — Título` (or `## Phase N - Title`) blocks with `**Requisitos:**`,
 * `**Critérios de aceite:**` and `**Escopo:**` lines, as in `oxe/templates/ROADMAP.template.md`.
 */
export declare function parseRoadmapPhases(markdown: string): Array<Pick<ProgramPhase, 'id' | 'title' | 'requirements' | 'acceptance' | 'scope'>>;
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
/** Phases run in roadmap order: a phase starts only when every earlier phase is closed. */
export declare function startPhase(state: ProgramState, id?: string | null): ProgramState;
export declare function setPhaseStatus(state: ProgramState, id: string, status: Exclude<PhaseStatus, 'closed' | 'pending'>, patch?: Partial<Pick<ProgramPhase, 'plan_ref' | 'run_id'>>): ProgramState;
export declare function evaluatePhaseGate(input: PhaseGateInput): PhaseGateResult;
export declare function closePhase(state: ProgramState, id: string, gate: PhaseGateInput, record?: Partial<Pick<ProgramPhase, 'closed_commit' | 'regression_ref' | 'interfaces_ref' | 'run_id' | 'plan_ref'>>): {
    state: ProgramState;
    gate: PhaseGateResult;
};
/** Acceptance ids a plan for `phase` may reference that are outside the phase (plan lint). */
export declare function acceptanceOutsidePhase(phase: ProgramPhase, planAcceptance: string[]): string[];
