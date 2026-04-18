export type RunStatus = 'planned' | 'running' | 'paused' | 'waiting_approval' | 'failed' | 'completed' | 'replaying' | 'aborted' | 'cancelled';
export type RunMode = 'completo' | 'por_onda' | 'por_tarefa';
export type RunInitiator = 'user' | 'scheduler' | 'retry' | 'replay';
export interface Run {
    run_id: string;
    session_id: string | null;
    graph_version: string;
    started_at: string;
    ended_at: string | null;
    status: RunStatus;
    initiator: RunInitiator;
    mode: RunMode;
}
