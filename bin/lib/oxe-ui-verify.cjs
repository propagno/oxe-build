'use strict';

/**
 * OXB-114: live UI verification inside the execute loop (opt-in per phase).
 *
 * PLAN.json (the phase's plan) `"ui_verify": { "command": "<the verifier>", "report"?: ".oxe/ui-verify/report.json",
 * "timeout_ms"?: 900000 }` — after each WAVE in which a UI task (tsx/jsx/vue/svelte/css/html…) completed, the execute
 * runs the command: an isolated verifier agent, the only one with browser tools (the project's choice — e.g. an agent
 * CLI with only its browser MCP allowed, or a Playwright script). It gets the wave and its UI tasks in the environment
 * (OXE_UI_WAVE, OXE_UI_TASKS, OXE_UI_FILES, OXE_UI_REPORT) and writes the report in the signal format
 * (`{ "phase", "findings": [{ "id", "summary", "class"?, "criteria"?, "files"? }] }`). Each finding becomes a signal CR
 * of the phase (`runtime signal`, deduped by id).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isUiTask } = require('./oxe-criteria-ids.cjs');

function uiVerifyConfig(doc, projectConfig) {
  const c = (doc && doc.ui_verify) || (projectConfig && projectConfig.ui_verify && (!projectConfig.ui_verify.phases || (doc && projectConfig.ui_verify.phases.includes(doc.phase))) ? projectConfig.ui_verify : null);
  if (!c || typeof c.command !== 'string' || !c.command.trim()) return null;
  return { command: c.command, report: c.report || '.oxe/ui-verify/report.json', timeout_ms: Number(c.timeout_ms) > 0 ? Number(c.timeout_ms) : 900_000 };
}

/** Wave → its UI tasks that completed (the ones the verifier looks at). */
function uiTasksOf(waveNodeIds, completed, planTasks) {
  return waveNodeIds.map((id) => planTasks.get(id)).filter((t) => t && completed.has(t.id) && isUiTask(t));
}

function runUiVerify(projectRoot, cfg, ctx) {
  const reportAbs = path.resolve(projectRoot, cfg.report);
  fs.mkdirSync(path.dirname(reportAbs), { recursive: true });
  try { fs.rmSync(reportAbs, { force: true }); } catch { /* */ }
  const env = {
    ...process.env,
    OXE_UI_WAVE: String(ctx.wave),
    OXE_UI_TASKS: ctx.tasks.map((t) => t.id).join(','),
    OXE_UI_FILES: [...new Set(ctx.tasks.flatMap((t) => t.files || []))].join(','),
    OXE_UI_REPORT: reportAbs,
    OXE_UI_PHASE: ctx.phase || '',
  };
  const started = Date.now();
  const r = spawnSync(cfg.command, { cwd: projectRoot, shell: true, encoding: 'utf8', windowsHide: true, timeout: cfg.timeout_ms, env, maxBuffer: 16 * 1024 * 1024 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return {
    ok: r.status === 0,
    exit_code: r.status,
    ms: Date.now() - started,
    report: fs.existsSync(reportAbs) ? reportAbs : null,
    tail: out.split(/\r?\n/).filter(Boolean).slice(-8).join('\n'),
  };
}

module.exports = { uiVerifyConfig, uiTasksOf, runUiVerify };
