import type { WorkspaceRequest, WorkspaceManager } from '../workspace/workspace-manager';
import type { WorkspaceLease, SnapshotRef } from '../models/workspace';
import type { VerificationResult } from '../models/verification-result';

// ─── ToolProvider ────────────────────────────────────────────────────────────

export interface ToolInvocationInput {
  action_type: string;
  work_item_id: string;
  run_id: string;
  attempt_id: string;
  params: Record<string, unknown>;
  workspace_root: string;
}

export interface ToolInvocationResult {
  success: boolean;
  output: string;
  evidence_paths: string[];
  side_effects_applied: string[];
  error?: string;
}

export interface ToolProvider {
  readonly name: string;
  readonly kind: 'read' | 'mutation' | 'verification' | 'analysis' | 'external_operation';
  readonly idempotent: boolean;
  supports(actionType: string): boolean;
  invoke(input: ToolInvocationInput): Promise<ToolInvocationResult>;
}

// ─── WorkspaceProvider ───────────────────────────────────────────────────────

export interface WorkspaceProvider extends WorkspaceManager {
  readonly name: string;
  supportsStrategy(strategy: string): boolean;
}

// ─── VerifierProvider ────────────────────────────────────────────────────────

export interface VerificationInput {
  check_id: string;
  check_type: string;
  command: string | null;
  work_item_id: string;
  workspace_root: string;
  evidence_dir: string;
}

export interface VerifierProvider {
  readonly name: string;
  supports(checkType: string): boolean;
  execute(input: VerificationInput): Promise<VerificationResult>;
}

// ─── ContextProvider ─────────────────────────────────────────────────────────

export interface ContextRequest {
  work_item_id: string;
  run_id: string;
  decision_type: 'execute' | 'verify' | 'plan' | 'review';
  artifact_paths: string[];
  project_root: string;
}

export interface PluginContextArtifact {
  source: string;
  weight: number;
  reason: string;
  content?: string;
}

export interface PluginContextArtifacts {
  included: PluginContextArtifact[];
  excluded: Array<{ source: string; reason: string }>;
  total_weight: number;
}

export interface ContextProvider {
  readonly name: string;
  collect(input: ContextRequest): Promise<PluginContextArtifacts>;
}

// ─── OxePlugin (unified) ─────────────────────────────────────────────────────

export interface OxePlugin {
  readonly name: string;
  readonly version?: string;
  toolProviders?: ToolProvider[];
  workspaceProviders?: WorkspaceProvider[];
  verifierProviders?: VerifierProvider[];
  contextProviders?: ContextProvider[];
  /** Legacy lifecycle hooks (compatible with oxe-plugins.cjs) */
  hooks?: Record<string, (ctx: Record<string, unknown>) => Promise<void> | void>;
}
