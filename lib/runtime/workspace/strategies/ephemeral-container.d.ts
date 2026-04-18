import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
export interface ContainerOptions {
    image: string;
    mountPath: string;
    extraEnv?: Record<string, string>;
    /** Gracefully fall back to git_worktree if Docker is unavailable */
    fallback?: boolean;
}
export declare class EphemeralContainerManager implements WorkspaceManager {
    private readonly projectRoot;
    private readonly opts;
    private readonly fallbackManager;
    private containerIds;
    private useFallback;
    constructor(projectRoot: string, opts?: ContainerOptions);
    get usingFallback(): boolean;
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(id: string, snapRef: SnapshotRef): Promise<void>;
    dispose(id: string): Promise<void>;
}
