import type { OxeEvent } from '../events/envelope';
import type { Run } from '../models/run';
import type { WorkItem } from '../models/work-item';
import type { Attempt } from '../models/attempt';
import type { Workspace } from '../models/workspace';

export interface PolicyDecisionRecord {
  allowed: boolean;
  gate_required: boolean;
  reason: string;
  rule_id: string | null;
}

export interface ToolFailureRecord {
  tool: string;
  error: string;
  timestamp: string;
}

export interface RunState {
  run: Run | null;
  workItems: Map<string, WorkItem>;
  attempts: Map<string, Attempt[]>;
  workspaces: Map<string, Workspace>;
  completedWorkItems: Set<string>;
  failedWorkItems: Set<string>;
  blockedWorkItems: Set<string>;
  // Phase 1 extensions
  retryCounts: Map<string, number>;
  policyDecisions: Map<string, PolicyDecisionRecord>;
  pendingGates: Set<string>;
  resolvedGates: Map<string, { decision: string; actor?: string }>;
  verificationStatus: Map<string, 'started' | 'completed' | 'failed'>;
  evidenceRefs: Map<string, string[]>;
  toolFailures: Map<string, ToolFailureRecord[]>;
}

export function createEmptyRunState(): RunState {
  return {
    run: null,
    workItems: new Map(),
    attempts: new Map(),
    workspaces: new Map(),
    completedWorkItems: new Set(),
    failedWorkItems: new Set(),
    blockedWorkItems: new Set(),
    retryCounts: new Map(),
    policyDecisions: new Map(),
    pendingGates: new Set(),
    resolvedGates: new Map(),
    verificationStatus: new Map(),
    evidenceRefs: new Map(),
    toolFailures: new Map(),
  };
}

export function reduce(events: OxeEvent[]): RunState {
  return events.reduce(applyEvent, createEmptyRunState());
}

// Exported alias so debug-reducer can import applyEvent without circular issues
export { applyEvent as applyEventExported };

// ─── State machine: valid transitions ─────────────────────────────────────────

import type { WorkItemStatus } from '../models/work-item';
import type { RunStatus } from '../models/run';

const VALID_WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  pending:   ['ready'],
  ready:     ['running'],
  running:   ['completed', 'failed', 'blocked'],
  failed:    ['ready'],      // retry path
  completed: [],             // terminal
  blocked:   [],             // terminal
  skipped:   [],             // terminal
};

const VALID_RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  planned:          ['running'],
  running:          ['paused', 'failed', 'completed', 'aborted', 'cancelled', 'waiting_approval'],
  paused:           ['running', 'cancelled'],
  waiting_approval: ['running', 'cancelled'],
  failed:           ['replaying'],
  replaying:        ['running', 'failed', 'completed'],
  completed:        [],
  aborted:          [],
  cancelled:        [],
};

function assertWorkItemTransition(
  itemId: string,
  from: WorkItemStatus,
  to: WorkItemStatus,
  eventType: string
): void {
  const allowed = VALID_WORK_ITEM_TRANSITIONS[from] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new Error(
      `[state-machine] Invalid work item transition for "${itemId}": ${from} → ${to} (event: ${eventType})`
    );
  }
}

function assertRunTransition(from: RunStatus, to: RunStatus, eventType: string): void {
  const allowed = VALID_RUN_TRANSITIONS[from] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new Error(
      `[state-machine] Invalid run transition: ${from} → ${to} (event: ${eventType})`
    );
  }
}

function applyEvent(state: RunState, event: OxeEvent): RunState {
  switch (event.type) {
    case 'RunStarted': {
      const run = event.payload as unknown as Run;
      return { ...state, run };
    }

    case 'RunCompleted': {
      if (!state.run) return state;
      const status = (event.payload as { status?: Run['status'] }).status ?? 'completed';
      assertRunTransition(state.run.status, status, event.type);
      return {
        ...state,
        run: { ...state.run, status, ended_at: event.timestamp },
      };
    }

    case 'WorkItemReady': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const existing = workItems.get(event.work_item_id);
      if (existing) {
        workItems.set(event.work_item_id, { ...existing, status: 'ready' });
      } else {
        const item = event.payload as unknown as WorkItem;
        workItems.set(event.work_item_id, { ...item, work_item_id: event.work_item_id, status: 'ready' });
      }
      return { ...state, workItems };
    }

    case 'AttemptStarted': {
      if (!event.work_item_id || !event.attempt_id) return state;
      const attempts = new Map(state.attempts);
      const attempt: Attempt = {
        attempt_id: event.attempt_id,
        work_item_id: event.work_item_id,
        attempt_number: (event.payload as { attempt_number?: number }).attempt_number ?? 1,
        workspace_id: null,
        agent_profile: null,
        model: null,
        started_at: event.timestamp,
        ended_at: null,
        outcome: null,
      };
      const existing = attempts.get(event.work_item_id) ?? [];
      attempts.set(event.work_item_id, [...existing, attempt]);
      return { ...state, attempts };
    }

    case 'WorkspaceAllocated': {
      const ws = event.payload as unknown as Workspace;
      if (!ws.workspace_id) return state;
      const workspaces = new Map(state.workspaces);
      workspaces.set(ws.workspace_id, { ...ws, status: 'ready' });
      return { ...state, workspaces };
    }

    case 'WorkItemCompleted': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const item = workItems.get(event.work_item_id);
      if (item) {
        assertWorkItemTransition(event.work_item_id, item.status, 'completed', event.type);
        workItems.set(event.work_item_id, { ...item, status: 'completed' });
      }
      const completedWorkItems = new Set(state.completedWorkItems);
      completedWorkItems.add(event.work_item_id);
      // Collect evidence refs from payload
      const evidence = (event.payload as { evidence?: string[] }).evidence ?? [];
      if (evidence.length > 0) {
        const evidenceRefs = new Map(state.evidenceRefs);
        const existing = evidenceRefs.get(event.work_item_id) ?? [];
        evidenceRefs.set(event.work_item_id, [...existing, ...evidence]);
        return { ...state, workItems, completedWorkItems, evidenceRefs };
      }
      return { ...state, workItems, completedWorkItems };
    }

    case 'WorkItemBlocked': {
      if (!event.work_item_id) return state;
      const workItems = new Map(state.workItems);
      const item = workItems.get(event.work_item_id);
      if (item) {
        assertWorkItemTransition(event.work_item_id, item.status, 'blocked', event.type);
        workItems.set(event.work_item_id, { ...item, status: 'blocked' });
      }
      const blockedWorkItems = new Set(state.blockedWorkItems);
      blockedWorkItems.add(event.work_item_id);
      return { ...state, workItems, blockedWorkItems };
    }

    case 'RetryScheduled': {
      if (!event.work_item_id) return state;
      const retryCounts = new Map(state.retryCounts);
      const current = retryCounts.get(event.work_item_id) ?? 0;
      retryCounts.set(event.work_item_id, current + 1);
      return { ...state, retryCounts };
    }

    case 'PolicyEvaluated': {
      const p = event.payload as {
        work_item_id?: string;
        allowed?: boolean;
        gate_required?: boolean;
        reason?: string;
        rule_id?: string | null;
      };
      const key = p.work_item_id ?? event.work_item_id;
      if (!key) return state;
      const policyDecisions = new Map(state.policyDecisions);
      policyDecisions.set(key, {
        allowed: p.allowed ?? true,
        gate_required: p.gate_required ?? false,
        reason: p.reason ?? '',
        rule_id: p.rule_id ?? null,
      });
      return { ...state, policyDecisions };
    }

    case 'GateRequested': {
      const gateId = (event.payload as { gate_id?: string }).gate_id;
      if (!gateId) return state;
      const pendingGates = new Set(state.pendingGates);
      pendingGates.add(gateId);
      return { ...state, pendingGates };
    }

    case 'GateResolved': {
      const p = event.payload as { gate_id?: string; decision?: string; actor?: string };
      if (!p.gate_id) return state;
      const pendingGates = new Set(state.pendingGates);
      pendingGates.delete(p.gate_id);
      const resolvedGates = new Map(state.resolvedGates);
      resolvedGates.set(p.gate_id, { decision: p.decision ?? 'approved', actor: p.actor });
      return { ...state, pendingGates, resolvedGates };
    }

    case 'VerificationStarted': {
      const key = event.work_item_id ?? (event.payload as { work_item_id?: string }).work_item_id;
      if (!key) return state;
      const verificationStatus = new Map(state.verificationStatus);
      verificationStatus.set(key, 'started');
      return { ...state, verificationStatus };
    }

    case 'VerificationCompleted': {
      const p = event.payload as { work_item_id?: string; status?: 'completed' | 'failed' };
      const key = event.work_item_id ?? p.work_item_id;
      if (!key) return state;
      const verificationStatus = new Map(state.verificationStatus);
      verificationStatus.set(key, p.status ?? 'completed');
      return { ...state, verificationStatus };
    }

    case 'ToolFailed': {
      if (!event.work_item_id) return state;
      const p = event.payload as { tool?: string; error?: string };
      const toolFailures = new Map(state.toolFailures);
      const existing = toolFailures.get(event.work_item_id) ?? [];
      toolFailures.set(event.work_item_id, [
        ...existing,
        { tool: p.tool ?? 'unknown', error: p.error ?? '', timestamp: event.timestamp },
      ]);
      return { ...state, toolFailures };
    }

    case 'EvidenceCollected': {
      const p = event.payload as { work_item_id?: string; refs?: string[]; ref?: string };
      const key = event.work_item_id ?? p.work_item_id;
      if (!key) return state;
      const refs = p.refs ?? (p.ref ? [p.ref] : []);
      if (refs.length === 0) return state;
      const evidenceRefs = new Map(state.evidenceRefs);
      const existing = evidenceRefs.get(key) ?? [];
      evidenceRefs.set(key, [...existing, ...refs]);
      return { ...state, evidenceRefs };
    }

    default:
      return state;
  }
}

export function getWorkItemStatus(
  state: RunState,
  workItemId: string
): WorkItem['status'] | null {
  return state.workItems.get(workItemId)?.status ?? null;
}

export function getAttemptCount(state: RunState, workItemId: string): number {
  return state.attempts.get(workItemId)?.length ?? 0;
}

export function getRetryCount(state: RunState, workItemId: string): number {
  return state.retryCounts.get(workItemId) ?? 0;
}

export function getPolicyDecision(state: RunState, workItemId: string): PolicyDecisionRecord | null {
  return state.policyDecisions.get(workItemId) ?? null;
}

export function getVerificationStatus(state: RunState, workItemId: string): 'started' | 'completed' | 'failed' | null {
  return state.verificationStatus.get(workItemId) ?? null;
}

export function getEvidenceRefs(state: RunState, workItemId: string): string[] {
  return state.evidenceRefs.get(workItemId) ?? [];
}

export function getToolFailures(state: RunState, workItemId: string): ToolFailureRecord[] {
  return state.toolFailures.get(workItemId) ?? [];
}
