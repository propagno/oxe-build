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
/**
 * OXB-050: leftover worktrees of a crashed or aborted run (`.oxe/workspaces/ws-*`). Each one has its external links
 * (node_modules junction, workspace links) removed FIRST, then `git worktree remove --force`, then `worktree prune`.
 * A forced remove with the junction still in place deletes the real node_modules — never in this order.
 * @returns the workspace directories removed
 */
export declare function sweepStaleWorkspaces(projectRoot: string, options?: {
    keep?: Set<string>;
}): string[];
export interface GitWorktreeOptions {
    /** OXB-050: prepares a fresh worktree (dependencies: link / copy-from / ci) before the executor runs in it. */
    prepare?: (root: string, lease: WorkspaceLease) => void | Promise<void>;
}
export declare class GitWorktreeManager implements WorkspaceManager {
    private readonly projectRoot;
    private readonly options;
    readonly isolation_level: "isolated";
    private leases;
    constructor(projectRoot: string, options?: GitWorktreeOptions);
    allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
    snapshot(id: string): Promise<SnapshotRef>;
    reset(id: string, snapRef: SnapshotRef): Promise<void>;
    dispose(id: string): Promise<void>;
    private git;
}
