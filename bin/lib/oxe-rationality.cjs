'use strict';

const fs = require('fs');

function readTextIfExists(filePath) {
  try {
    return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) return { ok: false, data: null, error: null };
  try {
    return { ok: true, data: JSON.parse(text), error: null };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseAttrs(fragment) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const raw = String(fragment || '');
  for (const match of raw.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function normalizeTaskMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode) return 'mutating';
  return mode;
}

function isMutatingMode(mode) {
  return !new Set(['docs_only', 'not_applicable', 'external', 'docs-only']).has(normalizeTaskMode(mode));
}

function isTaskRiskKeyword(task) {
  const text = `${task.title || ''} ${task.body || ''}`.toLowerCase();
  return /(parser|parse|layout|integra|integration|contrato|contract|migra|migration|fila|queue|service bus|event grid|builder|payload|transform|cnab|listener|schema|ddl)/.test(text);
}

/**
 * @param {string | null} planPath
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   files: string[],
 *   complexity: string | null,
 *   body: string,
 * }>}
 */
function parsePlanTasks(planPath) {
  const raw = readTextIfExists(planPath);
  if (!raw) return [];
  const parts = raw.split(/^###\s+(T\d+)\s*[—-]?\s*/m);
  if (parts.length < 3) return [];
  /** @type {ReturnType<typeof parsePlanTasks>} */
  const tasks = [];
  for (let i = 1; i < parts.length; i += 2) {
    const id = String(parts[i] || '').trim();
    const rest = String(parts[i + 1] || '').split(/^###\s+T\d+/m)[0];
    const title = (((rest.match(/^([^\n]+)/) || [null, ''])[1]) || '').trim();
    const filesLine = (((rest.match(/\*\*Arquivos\s+prov[aá]veis:\*\*\s*([^\n]+)/i) || [null, ''])[1]) || '').trim();
    const backtickPaths = Array.from(filesLine.matchAll(/`([^`]+)`/g)).map((match) => match[1].trim()).filter(Boolean);
    const files = backtickPaths.length
      ? backtickPaths
      : filesLine.split(',').map((entry) => entry.trim()).filter(Boolean);
    const complexity = (((rest.match(/\*\*Complexidade:\*\*\s*([A-Z]+)/i) || [null, ''])[1]) || '').trim() || null;
    tasks.push({ id, title, files, complexity, body: rest });
  }
  return tasks;
}

/**
 * @param {string | null} planAgentsPath
 * @returns {string[]}
 */
function readExternalRefs(planAgentsPath) {
  const parsed = readJsonIfExists(planAgentsPath);
  if (!parsed.ok || !parsed.data || typeof parsed.data !== 'object') return [];
  const agents = Array.isArray(parsed.data.agents) ? parsed.data.agents : [];
  return agents
    .flatMap((agent) => Array.isArray(agent && agent.inputs) ? agent.inputs : [])
    .map((input) => String(input || '').trim())
    .filter((input) => /^external-ref:/i.test(input));
}

function summarizeImplementationPack(filePath, planTasks) {
  const parsed = readJsonIfExists(filePath);
  /** @type {string[]} */
  const criticalGaps = [];
  if (!parsed.ok) {
    return {
      path: filePath,
      exists: Boolean(readTextIfExists(filePath)),
      parseError: parsed.error,
      ready: false,
      tasks: [],
      taskCount: 0,
      mutatingTasks: 0,
      criticalGaps: [`IMPLEMENTATION-PACK.json inválido ou ausente${parsed.error ? `: ${parsed.error}` : ''}`],
    };
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const byId = new Map(tasks.map((task) => [String(task && task.id || task && task.task_id || '').trim(), task]).filter((entry) => entry[0]));
  const allowedModes = new Set(['mutating', 'docs_only', 'not_applicable', 'external', 'docs-only']);
  for (const planTask of planTasks) {
    if (!byId.has(planTask.id)) {
      criticalGaps.push(`IMPLEMENTATION-PACK.json sem contrato para ${planTask.id}`);
    }
  }
  let mutatingTasks = 0;
  for (const task of tasks) {
    const id = String(task && task.id || task && task.task_id || '').trim();
    const mode = normalizeTaskMode(task && task.mode);
    const exactPaths = Array.isArray(task && task.exact_paths) ? task.exact_paths.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
    const symbols = Array.isArray(task && task.symbols) ? task.symbols : [];
    const contracts = Array.isArray(task && task.contracts) ? task.contracts : [];
    const expectedChecks = Array.isArray(task && task.expected_checks) ? task.expected_checks : [];
    const gaps = Array.isArray(task && task.critical_gaps) ? task.critical_gaps : [];
    if (!id) {
      criticalGaps.push('IMPLEMENTATION-PACK.json com task sem id');
      continue;
    }
    if (!allowedModes.has(mode)) {
      criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} com mode inválido: ${mode}`);
    }
    if (task && task.ready === false) {
      criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} marcada como not ready`);
    }
    if (gaps.length) {
      criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} com critical_gaps abertos`);
    }
    if (isMutatingMode(mode)) {
      mutatingTasks += 1;
      if (!exactPaths.length) {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} sem exact_paths`);
      }
      if (exactPaths.some((entry) => entry.includes('...'))) {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} com exact_paths ambíguos (...)`);
      }
      if (String(task && task.write_set || '').trim().toLowerCase() !== 'closed') {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} com write_set aberto`);
      }
      if (!symbols.length) {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} sem symbols`);
      }
      if (!contracts.length) {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} sem contracts`);
      }
      if (!expectedChecks.length) {
        criticalGaps.push(`IMPLEMENTATION-PACK.json tarefa ${id} sem expected_checks`);
      }
    }
  }
  if (data.ready === false) {
    criticalGaps.push('IMPLEMENTATION-PACK.json com ready=false');
  }
  if (Array.isArray(data.critical_gaps) && data.critical_gaps.length) {
    criticalGaps.push(...data.critical_gaps.map((gap) => `IMPLEMENTATION-PACK.json: ${String(gap)}`));
  }
  return {
    path: filePath,
    exists: true,
    parseError: null,
    ready: Boolean(data.ready) && criticalGaps.length === 0,
    tasks,
    taskCount: tasks.length,
    mutatingTasks,
    criticalGaps: Array.from(new Set(criticalGaps)),
  };
}

function summarizeReferenceAnchors(filePath, externalRefs) {
  const raw = readTextIfExists(filePath);
  /** @type {string[]} */
  const criticalGaps = [];
  if (!raw) {
    return {
      path: filePath,
      exists: false,
      ready: false,
      anchors: [],
      missingCriticalCount: externalRefs.length,
      staleCount: 0,
      criticalGaps: ['REFERENCE-ANCHORS.md ausente'],
    };
  }
  const rootMatch = raw.match(/<reference_anchors\b([^>]*)>([\s\S]*?)<\/reference_anchors>/i);
  if (!rootMatch) {
    return {
      path: filePath,
      exists: true,
      ready: false,
      anchors: [],
      missingCriticalCount: externalRefs.length,
      staleCount: 0,
      criticalGaps: ['REFERENCE-ANCHORS.md sem bloco <reference_anchors>'],
    };
  }
  const rootAttrs = parseAttrs(rootMatch[1]);
  const status = String(rootAttrs.status || '').toLowerCase();
  /** @type {Array<Record<string, unknown>>} */
  const anchors = [];
  for (const match of rootMatch[2].matchAll(/<anchor\b([^>]*)>([\s\S]*?)<\/anchor>/gi)) {
    const attrs = parseAttrs(match[1]);
    anchors.push({
      id: attrs.id || null,
      task: attrs.task || null,
      critical: String(attrs.critical || '').toLowerCase() === 'true',
      status: String(attrs.status || 'missing').toLowerCase(),
      sourceType: attrs.source_type || null,
      path: attrs.path || null,
      sourceRef: attrs.source_ref || null,
      relevance: (((match[2].match(/<relevance>([\s\S]*?)<\/relevance>/i) || [null, ''])[1]) || '').trim(),
      action: (((match[2].match(/<action>([\s\S]*?)<\/action>/i) || [null, ''])[1]) || '').trim(),
      summary: (((match[2].match(/<summary>([\s\S]*?)<\/summary>/i) || [null, ''])[1]) || '').trim(),
    });
  }
  if (status === 'not_applicable' && externalRefs.length) {
    criticalGaps.push('REFERENCE-ANCHORS.md marcado como not_applicable, mas há external-ref no blueprint');
  }
  let missingCriticalCount = 0;
  let staleCount = 0;
  for (const anchor of anchors) {
    const anchorStatus = String(anchor.status || 'missing').toLowerCase();
    if (anchorStatus === 'stale') staleCount += 1;
    if (anchor.critical && anchorStatus !== 'resolved') {
      missingCriticalCount += 1;
      criticalGaps.push(`REFERENCE-ANCHORS.md âncora crítica ${anchor.id || anchor.sourceRef || '?'} em estado ${anchorStatus}`);
    }
  }
  for (const ref of externalRefs) {
    const matched = anchors.find((anchor) => String(anchor.sourceRef || '').trim() === ref);
    if (!matched) {
      missingCriticalCount += 1;
      criticalGaps.push(`REFERENCE-ANCHORS.md sem âncora materializada para ${ref}`);
    } else if (String(matched.status || '').toLowerCase() !== 'resolved') {
      missingCriticalCount += 1;
      criticalGaps.push(`REFERENCE-ANCHORS.md com ${ref} em estado ${matched.status}`);
    }
  }
  if (String(rootAttrs.ready || '').toLowerCase() === 'false') {
    criticalGaps.push('REFERENCE-ANCHORS.md com ready=false');
  }
  return {
    path: filePath,
    exists: true,
    ready: status === 'not_applicable'
      ? criticalGaps.length === 0
      : Boolean(String(rootAttrs.ready || '').toLowerCase() !== 'false') && criticalGaps.length === 0,
    anchors,
    missingCriticalCount,
    staleCount,
    criticalGaps: Array.from(new Set(criticalGaps)),
  };
}

function summarizeFixturePack(filePath, planTasks, implementationPack) {
  const parsed = readJsonIfExists(filePath);
  /** @type {string[]} */
  const criticalGaps = [];
  if (!parsed.ok) {
    return {
      path: filePath,
      exists: Boolean(readTextIfExists(filePath)),
      parseError: parsed.error,
      ready: false,
      fixtures: [],
      fixtureCount: 0,
      criticalGaps: [`FIXTURE-PACK.json inválido ou ausente${parsed.error ? `: ${parsed.error}` : ''}`],
    };
  }
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
  const byTask = new Map();
  for (const fixture of fixtures) {
    const taskId = String(fixture && fixture.task_id || fixture && fixture.taskId || '').trim();
    if (!taskId) continue;
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId).push(fixture);
  }
  if (data.ready === false) {
    criticalGaps.push('FIXTURE-PACK.json com ready=false');
  }
  if (Array.isArray(data.critical_gaps) && data.critical_gaps.length) {
    criticalGaps.push(...data.critical_gaps.map((gap) => `FIXTURE-PACK.json: ${String(gap)}`));
  }
  const implementationTasks = Array.isArray(implementationPack.tasks) ? implementationPack.tasks : [];
  for (const task of implementationTasks) {
    const taskId = String(task && task.id || task && task.task_id || '').trim();
    if (!taskId) continue;
    const planTask = planTasks.find((candidate) => candidate.id === taskId);
    const requiresFixture = task && task.requires_fixture === true
      || (planTask ? isTaskRiskKeyword(planTask) : false);
    if (!requiresFixture) continue;
    const entries = byTask.get(taskId) || [];
    if (!entries.length) {
      criticalGaps.push(`FIXTURE-PACK.json sem fixture para ${taskId}`);
      continue;
    }
    const readyFixture = entries.find((entry) => String(entry && entry.status || '').toLowerCase() === 'ready');
    if (!readyFixture) {
      criticalGaps.push(`FIXTURE-PACK.json sem fixture ready para ${taskId}`);
      continue;
    }
    if (!Array.isArray(readyFixture.expected_checks) || readyFixture.expected_checks.length === 0) {
      criticalGaps.push(`FIXTURE-PACK.json fixture de ${taskId} sem expected_checks`);
    }
    if (Array.isArray(readyFixture.critical_gaps) && readyFixture.critical_gaps.length) {
      criticalGaps.push(`FIXTURE-PACK.json fixture de ${taskId} com critical_gaps abertos`);
    }
  }
  return {
    path: filePath,
    exists: true,
    parseError: null,
    ready: Boolean(data.ready) && criticalGaps.length === 0,
    fixtures,
    fixtureCount: fixtures.length,
    criticalGaps: Array.from(new Set(criticalGaps)),
  };
}

/**
 * @param {{
 *   plan?: string | null,
 *   planAgents?: string | null,
 *   implementationPackJson?: string | null,
 *   implementationPackMd?: string | null,
 *   referenceAnchors?: string | null,
 *   fixturePackJson?: string | null,
 *   fixturePackMd?: string | null,
 * }} paths
 */
function buildExecutionRationality(paths = {}) {
  const planTasks = parsePlanTasks(paths.plan || null);
  const externalRefs = readExternalRefs(paths.planAgents || null);
  const implementationPack = summarizeImplementationPack(paths.implementationPackJson || null, planTasks);
  const referenceAnchors = summarizeReferenceAnchors(paths.referenceAnchors || null, externalRefs);
  const fixturePack = summarizeFixturePack(paths.fixturePackJson || null, planTasks, implementationPack);
  const applicable = Boolean(paths.plan && fs.existsSync(paths.plan));
  const criticalExecutionGaps = applicable
    ? Array.from(
      new Set([
        ...implementationPack.criticalGaps,
        ...referenceAnchors.criticalGaps,
        ...fixturePack.criticalGaps,
      ])
    )
    : [];
  return {
    applicable,
    planTaskCount: planTasks.length,
    externalReferenceCount: externalRefs.length,
    implementationPackReady: applicable ? implementationPack.ready : false,
    referenceAnchorsReady: applicable ? referenceAnchors.ready : false,
    fixturePackReady: applicable ? fixturePack.ready : false,
    executionRationalityReady: applicable
      ? implementationPack.ready && referenceAnchors.ready && fixturePack.ready && criticalExecutionGaps.length === 0
      : false,
    criticalExecutionGaps,
    implementationPack,
    referenceAnchors,
    fixturePack,
  };
}

module.exports = {
  buildExecutionRationality,
  parsePlanTasks,
  readExternalRefs,
  summarizeImplementationPack,
  summarizeReferenceAnchors,
  summarizeFixturePack,
};
