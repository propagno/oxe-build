export type SessionStatus = 'active' | 'archived' | 'closed';
export interface Session {
    session_id: string;
    title: string;
    created_at: string;
    status: SessionStatus;
    repo_root: string;
    baseline_commit: string | null;
    active_run_id: string | null;
}
