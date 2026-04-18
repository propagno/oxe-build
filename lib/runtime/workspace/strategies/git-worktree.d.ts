import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
export declare class GitWorktreeManager implements WorkspaceManager {
    private readonly projectRoot;
    private leases;
    constructor(projectRoot: string);
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(id: string, snapRef: SnapshotRef): Promise<void>;
    dispose(id: string): Promise<void>;
    private git;
}
