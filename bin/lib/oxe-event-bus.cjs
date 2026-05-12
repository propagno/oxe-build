'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * OXE Event Bus
 *
 * Wrapper sobre o runtime event bus para emitir eventos em OXE-EVENTS.ndjson.
 * Compatível com o schema OxeEvent definido em packages/runtime/src/events/envelope.ts.
 *
 * Uso:
 *   const bus = require('./oxe-event-bus.cjs');
 *   bus.emit(projectRoot, 'RunStarted', { mode: 'agent', objective: '...' }, { session_id, run_id });
 */

const EVENTS_FILE = 'OXE-EVENTS.ndjson';

function emit(projectRoot, eventType, payload = {}, context = {}) {
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    type: eventType,
    timestamp: new Date().toISOString(),
    session_id: context.session_id || null,
    run_id: context.run_id || null,
    work_item_id: context.work_item_id || null,
    attempt_id: context.attempt_id || null,
    causation_id: context.causation_id || null,
    correlation_id: context.correlation_id || null,
    payload,
  };

  const eventsPath = path.join(projectRoot, '.oxe', EVENTS_FILE);

  try {
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // non-fatal: event emission should never break the main flow
  }

  return event;
}

function emitRunStarted(projectRoot, runId, sessionId, mode, objective, persona) {
  return emit(projectRoot, 'RunStarted', { mode, objective, persona }, { run_id: runId, session_id: sessionId });
}

function emitWorkItemCompleted(projectRoot, runId, sessionId, taskId, filesChanged) {
  return emit(projectRoot, 'WorkItemCompleted', { task_id: taskId, files_changed: filesChanged || [] }, { run_id: runId, session_id: sessionId, work_item_id: taskId });
}

function emitWorkItemBlocked(projectRoot, runId, sessionId, taskId, reason) {
  return emit(projectRoot, 'WorkItemBlocked', { task_id: taskId, reason }, { run_id: runId, session_id: sessionId, work_item_id: taskId });
}

function emitRunCompleted(projectRoot, runId, sessionId, status, summary) {
  return emit(projectRoot, 'RunCompleted', { status, ...summary }, { run_id: runId, session_id: sessionId });
}

function emitGateRequested(projectRoot, runId, sessionId, gateId, condition, type) {
  return emit(projectRoot, 'GateRequested', { gate_id: gateId, condition, type }, { run_id: runId, session_id: sessionId });
}

function emitGateResolved(projectRoot, runId, sessionId, gateId, resolution, actor) {
  return emit(projectRoot, 'GateResolved', { gate_id: gateId, resolution, actor }, { run_id: runId, session_id: sessionId });
}

function emitLessonPromoted(projectRoot, runId, lessonId, frequency, impact) {
  return emit(projectRoot, 'LessonPromoted', { lesson_id: lessonId, frequency, impact }, { run_id: runId });
}

function emitRetroPublished(projectRoot, runId, lessonsAdded, lessonsUpdated) {
  return emit(projectRoot, 'RetroPublished', { run_id: runId, lessons_added: lessonsAdded, lessons_updated: lessonsUpdated }, { run_id: runId });
}

function readEvents(projectRoot, filters = {}) {
  const eventsPath = path.join(projectRoot, '.oxe', EVENTS_FILE);

  if (!fs.existsSync(eventsPath)) {
    return [];
  }

  try {
    const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
    let events = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    if (filters.run_id) {
      events = events.filter(e => e.run_id === filters.run_id);
    }
    if (filters.type) {
      events = events.filter(e => e.type === filters.type);
    }
    if (filters.since) {
      events = events.filter(e => e.timestamp >= filters.since);
    }

    return events;
  } catch {
    return [];
  }
}

module.exports = {
  emit,
  emitRunStarted,
  emitWorkItemCompleted,
  emitWorkItemBlocked,
  emitRunCompleted,
  emitGateRequested,
  emitGateResolved,
  emitLessonPromoted,
  emitRetroPublished,
  readEvents,
};
