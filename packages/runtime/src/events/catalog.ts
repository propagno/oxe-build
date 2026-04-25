export const EVENT_TYPES = [
  'SessionCreated',
  'RunStarted',
  'GraphCompiled',
  'WorkItemReady',
  'WorkspaceAllocated',
  'AttemptStarted',
  'ToolInvoked',
  'ToolCompleted',
  'ToolFailed',
  'EvidenceCollected',
  'PolicyEvaluated',
  'GateRequested',
  'GateResolved',
  'VerificationStarted',
  'VerificationCompleted',
  'RetryScheduled',
  'WorkItemCompleted',
  'WorkItemBlocked',
  'RunCompleted',
  'RetroPublished',
  'LessonPromoted',
  'RunAborted',
  'RollbackExecuted',
  'RollbackFailed',
  'TaskErrorBoundaryTripped',
  'WorkspaceDisposeFailed',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isValidEventType(type: string): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}
