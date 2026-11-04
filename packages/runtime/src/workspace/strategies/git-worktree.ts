import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Removes (without following) every symlink/junction under `root` whose target is outside `root`. Walks real
 * directories only (lstat), skips `.git`, and is bounded so a large installed node_modules cannot stall dispose.
 * @returns the links removed (absolute paths)
 */
export function unlinkExternalLinks(root: string, limits: { maxDepth?: number; maxEntries?: number } = {}): string[] {
  const maxDepth = limits.maxDepth ?? 5;
  const maxEntries = limits.maxEntries ?? 50_000;
  const removed: string[] = [];
  const realRoot = (() => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } })();
  let seen = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || seen > maxEntries) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return;
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        let target = '';
        try {
          target = path.resolve(path.dirname(full), fs.readlinkSync(full));
        } catch {
          target = '';
        }
        if (!target || !(isInside(realRoot, target) || isInside(path.resolve(root), target))) {
          try {
            fs.unlinkSync(full);
          } catch {
            try { fs.rmdirSync(full); } catch { continue; } // a Windows directory junction
          }
          removed.push(full);
        }
        continue;
      }
      if (stat.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return removed;
}

export class GitWorktreeManager implements WorkspaceManager {
  readonly isolation_level = 'isolated' as const;
  private leases = new Map<string, WorkspaceLease>();

  constructor(private readonly projectRoot: string) {}

  async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
    const suffix = crypto.randomBytes(4).toString('hex');
    const safeWorkItem = String(req.work_item_id).replace(/[^A-Za-z0-9._-]/g, '-');
    const wsId = `ws-${safeWorkItem}-a${req.attempt_number}-${suffix}`;
    const branch = `oxe/${safeWorkItem}-attempt${req.attempt_number}-${suffix}`;
    const worktreePath = path.join(this.projectRoot, '.oxe', 'workspaces', wsId);

    const baseCommit = this.git(['rev-parse', 'HEAD'], undefined, 'git_worktree requires a git repository with at least one base commit').trim();

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Create worktree on a new branch starting from HEAD
    this.git(['worktree', 'add', worktreePath, '-b', branch], undefined, 'failed to create git_worktree workspace');

    const lease: WorkspaceLease = {
      workspace_id: wsId,
      strategy: 'git_worktree',
      isolation_level: this.isolation_level,
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
    // A forced worktree remove follows links: a node_modules junction or a workspace link (@scope/pkg → the main
    // repo's packages/) took the REAL directory with it. Links that leave the worktree are unlinked first, never
    // followed, so only the worktree's own files are removed.
    if (lease.root_path) unlinkExternalLinks(lease.root_path);
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

  private git(args: string[], cwd?: string, message?: string): string {
    try {
      return execFileSync('git', args, {
        cwd: cwd ?? this.projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${message || 'git command failed'}: git ${args.join(' ')} (${detail})`);
    }
  }
}
