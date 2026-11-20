'use strict';

const fs = require('fs');
const path = require('path');

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch { /* ignore malformed line */ }
  }
  return out;
}

/**
 * Aggregate OXE-EVENTS.ndjson into operational telemetry metrics, hotspots, and recommendations.
 * @param {string} projectRoot
 * @param {{ eventsPath?: string, events?: object[] }} [options]
 */
function buildOperationalTelemetry(projectRoot, options = {}) {
  const eventsPath = options.eventsPath || path.join(projectRoot, '.oxe', 'OXE-EVENTS.ndjson');
  const events = Array.isArray(options.events) ? options.events : readNdjson(eventsPath);

  const runs = new Set();
  const byFailureClass = {};
  const checkpointFailByKind = {};
  const taskStats = new Map();
  const incTask = (id, key, n = 1) => {
    if (!id) return;
    if (!taskStats.has(id)) {
      taskStats.set(id, { task: id, retries: 0, failures: 0, checkpoint_failures: 0, reopens: 0, cost_usd: 0 });
    }
    taskStats.get(id)[key] += n;
  };

  let tasksCompleted = 0;
  let tasksFailed = 0;
  let tasksBlocked = 0;
  let totalRetries = 0;
  let networkRetries = 0;
  let rateLimitWaits = 0;
  let contextCompactions = 0;
  let reopens = 0;
  let checkpointsPassed = 0;
  let checkpointsFailed = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.run_id) runs.add(String(ev.run_id));
    const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    const tid = ev.work_item_id || p.task || null;

    if (ev.type === 'WorkItemCompleted') {
      tasksCompleted += 1;
    } else if (ev.type === 'WorkItemFailed') {
      tasksFailed += 1;
      incTask(tid, 'failures');
      const fc = String(p.failure_class || 'unknown');
      byFailureClass[fc] = (byFailureClass[fc] || 0) + 1;
    } else if (ev.type === 'WorkItemBlocked') {
      tasksBlocked += 1;
      if (p.failure_class) {
        const fc = String(p.failure_class);
        byFailureClass[fc] = (byFailureClass[fc] || 0) + 1;
      }
    } else if (ev.type === 'RetryScheduled') {
      totalRetries += 1;
      incTask(tid, 'retries');
      const fc = String(p.failure_class || p.reason || 'unknown');
      byFailureClass[fc] = (byFailureClass[fc] || 0) + 1;
    } else if (ev.type === 'network_retry' || ev.type === 'NetworkRetry') {
      networkRetries += 1;
    } else if (ev.type === 'rate_limit_wait' || ev.type === 'RateLimitWait') {
      rateLimitWaits += 1;
    } else if (ev.type === 'context_compacted' || ev.type === 'ContextCompacted') {
      contextCompactions += 1;
    } else if (ev.type === 'PlanTaskReopened' || ev.type === 'TaskReopened') {
      reopens += 1;
      incTask(tid, 'reopens');
    } else if (ev.type === 'GateResolved' && p.gate === 'checkpoint') {
      checkpointsPassed += 1;
    } else if (ev.type === 'CheckpointFailed') {
      checkpointsFailed += 1;
      incTask(tid, 'checkpoint_failures');
      const kind = String(p.kind || (p.timed_out ? 'timeout' : 'other'));
      checkpointFailByKind[kind] = (checkpointFailByKind[kind] || 0) + 1;
    } else if (ev.type === 'ExecutorUsage') {
      const cost = Number(p.cost_usd || 0);
      const inp = Number(p.input_tokens || 0);
      const out = Number(p.output_tokens || 0);
      if (Number.isFinite(cost) && cost > 0) {
        totalCostUsd += cost;
        incTask(tid, 'cost_usd', cost);
      }
      if (Number.isFinite(inp) && inp > 0) totalInputTokens += inp;
      if (Number.isFinite(out) && out > 0) totalOutputTokens += out;
    }
  }

  const hotspots = [...taskStats.values()]
    .filter((t) => t.retries > 0 || t.failures > 0 || t.checkpoint_failures > 0 || t.reopens > 0)
    .sort((a, b) => (b.retries + b.failures + b.checkpoint_failures + b.reopens) - (a.retries + a.failures + a.checkpoint_failures + a.reopens))
    .slice(0, 10)
    .map((t) => ({ ...t, cost_usd: Number(t.cost_usd.toFixed(4)) }));

  const recommendations = [];
  if ((byFailureClass.context_full || 0) > 0 || (byFailureClass.policy || 0) > 0) {
    recommendations.push('Ative execute.max_context_action: "compact" em .oxe/config.json para compactar contexto intra-turno antes de estourar o limite.');
  }
  if ((checkpointFailByKind.timeout || 0) > 0) {
    recommendations.push('Aumente checkpoint_check_timeout_ms em .oxe/config.json para evitar timeouts no checkpoint_check.');
  }
  if ((checkpointFailByKind.scope_insufficient || 0) > 0) {
    recommendations.push('Use o repo map (oxe-cc context --repo-map) no planejamento para incluir testes/chamadores relacionados no escopo.');
  }
  if ((byFailureClass.env || 0) >= 3) {
    recommendations.push('Alto volume de falhas env — verifique conectividade/TLS e mantenha o retry exponencial intra-turno ativo.');
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    totals: {
      events: events.length,
      runs: runs.size,
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
      tasks_blocked: tasksBlocked,
      reopens,
      cost_usd: Number(totalCostUsd.toFixed(4)),
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    },
    retries: {
      total: totalRetries,
      by_failure_class: byFailureClass,
      network_retries: networkRetries,
      rate_limit_waits: rateLimitWaits,
      context_compactions: contextCompactions,
    },
    checkpoints: {
      passed: checkpointsPassed,
      failed: checkpointsFailed,
      failed_by_kind: checkpointFailByKind,
    },
    hotspots,
    recommendations,
  };
}

/** Convert OXE telemetry summary + events into an OpenTelemetry-compatible JSON envelope. */
function toOtelEnvelope(telemetry, serviceName = 'oxe-build') {
  const nowNano = String(Date.now() * 1_000_000);
  const attrs = [
    { key: 'oxe.runs', value: { intValue: String(telemetry.totals.runs) } },
    { key: 'oxe.tasks.completed', value: { intValue: String(telemetry.totals.tasks_completed) } },
    { key: 'oxe.tasks.failed', value: { intValue: String(telemetry.totals.tasks_failed) } },
    { key: 'oxe.retries.total', value: { intValue: String(telemetry.retries.total) } },
    { key: 'oxe.retries.network', value: { intValue: String(telemetry.retries.network_retries) } },
    { key: 'oxe.context.compactions', value: { intValue: String(telemetry.retries.context_compactions) } },
    { key: 'oxe.checkpoints.passed', value: { intValue: String(telemetry.checkpoints.passed) } },
    { key: 'oxe.checkpoints.failed', value: { intValue: String(telemetry.checkpoints.failed) } },
    { key: 'oxe.cost.usd', value: { doubleValue: telemetry.totals.cost_usd } },
  ];
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: 'oxe-telemetry', version: '1.0.0' },
            spans: [
              {
                name: 'oxe.operational.summary',
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                attributes: attrs,
              },
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  buildOperationalTelemetry,
  toOtelEnvelope,
};
