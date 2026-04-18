import type { WorkspaceLease, SnapshotRef, WorkspaceStrategy } from '../models/workspace';

export interface WorkspaceRequest {
  work_item_id: string;
  attempt_number: number;
  strategy: WorkspaceStrategy;
  mutation_scope: string[];
}

export interface WorkspaceManager {
  allocate(req: WorkspaceRequest): Promise<WorkspaceLease>;
  snapshot(id: string): Promise<SnapshotRef>;
  reset(id: string, snapRef: SnapshotRef): Promise<void>;
  dispose(id: string): Promise<void>;
}
