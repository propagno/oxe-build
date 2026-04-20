export type WorkspaceStrategy = 'inplace' | 'git_worktree' | 'ephemeral_container';
export type WorkspaceStatus = 'allocating' | 'ready' | 'dirty' | 'disposed' | 'error';
export type WorkspaceIsolationLevel = 'shared' | 'isolated';
export interface Workspace {
    workspace_id: string;
    strategy: WorkspaceStrategy;
    isolation_level: WorkspaceIsolationLevel;
    base_commit: string | null;
    branch: string | null;
    container_ref: string | null;
    status: WorkspaceStatus;
    root_path: string;
}
export interface WorkspaceLease {
    workspace_id: string;
    strategy: WorkspaceStrategy;
    isolation_level: WorkspaceIsolationLevel;
    branch: string | null;
    base_commit: string | null;
    root_path: string;
    ttl_minutes: number;
}
export interface SnapshotRef {
    snapshot_id: string;
    workspace_id: string;
    commit: string;
    created_at: string;
}
