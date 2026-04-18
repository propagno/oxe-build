import crypto from 'crypto';
import type { WorkspaceManager, WorkspaceRequest } from '../workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../../models/workspace';

export class InplaceWorkspaceManager implements WorkspaceManager {
  constructor(private readonly projectRoot: string) {}

  async allocate(req: WorkspaceRequest): Promise<WorkspaceLease> {
    return {
      workspace_id: `ws-inplace-${req.work_item_id}-a${req.attempt_number}`,
      strategy: 'inplace',
      branch: null,
      base_commit: null,
      root_path: this.projectRoot,
      ttl_minutes: 60,
    };
  }

  async snapshot(id: string): Promise<SnapshotRef> {
    return {
      snapshot_id: `snap-${crypto.randomBytes(4).toString('hex')}`,
      workspace_id: id,
      commit: 'HEAD',
      created_at: new Date().toISOString(),
    };
  }

  async reset(_id: string, _snapRef: SnapshotRef): Promise<void> {
    // inplace: no filesystem isolation — reset is a no-op
  }

  async dispose(_id: string): Promise<void> {
    // inplace: nothing to tear down
  }
}
