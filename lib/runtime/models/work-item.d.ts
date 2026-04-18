import type { WorkspaceStrategy } from './workspace';
export type WorkItemStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';
export type WorkItemType = 'task' | 'checkpoint' | 'gate' | 'verification';
export interface WorkItem {
    work_item_id: string;
    run_id: string;
    title: string;
    type: WorkItemType;
    depends_on: string[];
    mutation_scope: string[];
    policy_ref: string | null;
    verify_ref: string[];
    status: WorkItemStatus;
    workspace_strategy: WorkspaceStrategy;
}
