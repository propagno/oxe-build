import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
export interface ContainerOptions {
    image: string;
    mountPath: string;
    extraEnv?: Record<string, string>;
    /** Gracefully fall back to git_worktree if Docker is unavailable */
    fallback?: boolean;
    /** Network isolation mode inside the container (default 'none'). */
    networkMode?: 'none' | 'bridge';
    /** Mount control-plane folders (.oxe, .github/workflows) read-only inside the container (default true). */
    readOnlyControlPlane?: boolean;
    /** Optional resource limits (e.g. '2g', '2'). */
    memoryLimit?: string;
    cpus?: string;
}
/** Build hardened `docker run` arguments with network isolation, control-plane read-only mounts, and resource caps. */
export declare function buildDockerRunArgs(projectRoot: string, opts: ContainerOptions): string[];
export declare class EphemeralContainerManager implements WorkspaceManager {
    private readonly projectRoot;
    private readonly opts;
    private readonly fallbackManager;
    private containerIds;
    private useFallback;
    constructor(projectRoot: string, opts?: ContainerOptions);
    get isolation_level(): 'shared' | 'isolated';
    get usingFallback(): boolean;
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(id: string, snapRef: SnapshotRef): Promise<void>;
    dispose(id: string): Promise<void>;
}
