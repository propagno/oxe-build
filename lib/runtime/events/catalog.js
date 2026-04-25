"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_TYPES = void 0;
exports.isValidEventType = isValidEventType;
exports.EVENT_TYPES = [
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
];
function isValidEventType(type) {
    return exports.EVENT_TYPES.includes(type);
}
