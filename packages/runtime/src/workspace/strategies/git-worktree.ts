import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';

export class GitWorktreeManager implements WorkspaceManager {
  private leases = new Map<string, WorkspaceLease>();

  constructor(private readonly projectRoot: string) {}

  async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
    const wsId = `ws-${req.work_item_id}-a${req.attempt_number}`;
    const branch = `oxe/${req.work_item_id}-attempt${req.attempt_number}`;
    const worktreePath = path.join(this.projectRoot, '.oxe', 'workspaces', wsId);

    const baseCommit = this.git(['rev-parse', 'HEAD']).trim();

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Create worktree on a new branch starting from HEAD
    this.git(['worktree', 'add', worktreePath, '-b', branch]);

    const lease: WorkspaceLease = {
      workspace_id: wsId,
      strategy: 'git_worktree',
      branch,
      base_commit: baseCommit,
      root_path: worktreePath,
      ttl_minutes: 45,
    };
    this.leases.set(wsId, lease);
    return lease;
  }

  async snapshot(id: string): Promise<SnapshotRef> {
    const lease = this.leases.get(id);
    if (!lease || !lease.root_path) throw new Error(`Workspace ${id} not found`);
    const commit = this.git(['rev-parse', 'HEAD'], lease.root_path).trim();
    return {
      snapshot_id: `snap-${crypto.randomBytes(4).toString('hex')}`,
      workspace_id: id,
      commit,
      created_at: new Date().toISOString(),
    };
  }

  async reset(id: string, snapRef: SnapshotRef): Promise<void> {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.git(['reset', '--hard', snapRef.commit], lease.root_path);
  }

  async dispose(id: string): Promise<void> {
    const lease = this.leases.get(id);
    if (!lease) return;
    try {
      this.git(['worktree', 'remove', lease.root_path, '--force']);
    } catch {
      // worktree may already be gone
    }
    try {
      if (lease.branch) this.git(['branch', '-D', lease.branch]);
    } catch {
      // branch may already be deleted
    }
    this.leases.delete(id);
  }

  private git(args: string[], cwd?: string): string {
    return execFileSync('git', args, {
      cwd: cwd ?? this.projectRoot,
      encoding: 'utf8',
    });
  }
}
