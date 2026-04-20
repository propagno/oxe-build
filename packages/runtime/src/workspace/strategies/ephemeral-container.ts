import { execFileSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';
import { GitWorktreeManager } from './git-worktree';

export interface ContainerOptions {
  image: string;
  mountPath: string;
  extraEnv?: Record<string, string>;
  /** Gracefully fall back to git_worktree if Docker is unavailable */
  fallback?: boolean;
}

function isDockerAvailable(): boolean {
  const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return result.status === 0;
}

export class EphemeralContainerManager implements WorkspaceManager {
  private readonly fallbackManager: GitWorktreeManager;
  private containerIds = new Map<string, string>();
  private useFallback = false;

  constructor(
    private readonly projectRoot: string,
    private readonly opts: ContainerOptions = { image: 'node:20-alpine', mountPath: '/workspace', fallback: true }
  ) {
    this.fallbackManager = new GitWorktreeManager(projectRoot);
    if (!isDockerAvailable()) {
      if (opts.fallback !== false) {
        this.useFallback = true;
      } else {
        throw new Error('Docker is not available and fallback is disabled');
      }
    }
  }

  get isolation_level(): 'shared' | 'isolated' {
    return this.useFallback ? this.fallbackManager.isolation_level : 'isolated';
  }

  get usingFallback(): boolean { return this.useFallback; }

  async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
    if (this.useFallback) return this.fallbackManager.allocate(req);

    const wsId = `ws-container-${req.work_item_id}-a${req.attempt_number}`;
    const envArgs = Object.entries(this.opts.extraEnv ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

    const result = spawnSync('docker', [
      'run', '-d',
      '-v', `${this.projectRoot}:${this.opts.mountPath}`,
      '-w', this.opts.mountPath,
      ...envArgs,
      this.opts.image,
      'sleep', '3600',
    ], { encoding: 'utf8' });

    if (result.status !== 0) {
      if (this.opts.fallback !== false) {
        this.useFallback = true;
        return this.fallbackManager.allocate(req);
      }
      throw new Error(`docker run failed: ${result.stderr}`);
    }

    const containerId = result.stdout.trim().slice(0, 12);
    this.containerIds.set(wsId, containerId);

    return {
      workspace_id: wsId,
      strategy: 'ephemeral_container',
      isolation_level: this.isolation_level,
      branch: null,
      base_commit: null,
      root_path: `docker:${containerId}:${this.opts.mountPath}`,
      ttl_minutes: 60,
    };
  }

  async snapshot(id: string): Promise<SnapshotRef> {
    if (this.useFallback) return this.fallbackManager.snapshot(id);
    const containerId = this.containerIds.get(id);
    if (!containerId) throw new Error(`Container for workspace ${id} not found`);

    const tag = `oxe-snap-${crypto.randomBytes(4).toString('hex')}`;
    execFileSync('docker', ['commit', containerId, tag]);

    return {
      snapshot_id: tag,
      workspace_id: id,
      commit: tag,
      created_at: new Date().toISOString(),
    };
  }

  async reset(id: string, snapRef: SnapshotRef): Promise<void> {
    if (this.useFallback) return this.fallbackManager.reset(id, snapRef);
    const containerId = this.containerIds.get(id);
    if (!containerId) return;
    // Stop current container and start from snapshot
    spawnSync('docker', ['stop', containerId]);
    spawnSync('docker', ['rm', containerId]);
    const result = spawnSync('docker', [
      'run', '-d',
      '-v', `${this.projectRoot}:${this.opts.mountPath}`,
      snapRef.commit,
      'sleep', '3600',
    ], { encoding: 'utf8' });
    const newId = result.stdout.trim().slice(0, 12);
    this.containerIds.set(id, newId);
  }

  async dispose(id: string): Promise<void> {
    if (this.useFallback) return this.fallbackManager.dispose(id);
    const containerId = this.containerIds.get(id);
    if (!containerId) return;
    spawnSync('docker', ['stop', containerId], { encoding: 'utf8' });
    spawnSync('docker', ['rm', containerId], { encoding: 'utf8' });
    this.containerIds.delete(id);
  }
}
