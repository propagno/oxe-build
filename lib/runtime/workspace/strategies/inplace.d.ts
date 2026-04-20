import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
export declare class InplaceWorkspaceManager implements WorkspaceManager {
    private readonly projectRoot;
    readonly isolation_level: "shared";
    constructor(projectRoot: string);
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(_id: string, _snapRef: SnapshotRef): Promise<void>;
    dispose(_id: string): Promise<void>;
}
