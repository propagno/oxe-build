import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
/**
 * Removes (without following) every symlink/junction under `root` whose target is outside `root`. Walks real
 * directories only (lstat), skips `.git`, and is bounded so a large installed node_modules cannot stall dispose.
 * @returns the links removed (absolute paths)
 */
export declare function unlinkExternalLinks(root: string, limits?: {
    maxDepth?: number;
    maxEntries?: number;
}): string[];
export declare class GitWorktreeManager implements WorkspaceManager {
    private readonly projectRoot;
    readonly isolation_level: "isolated";
    private leases;
    constructor(projectRoot: string);
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(id: string, snapRef: SnapshotRef): Promise<void>;
    dispose(id: string): Promise<void>;
    private git;
}
