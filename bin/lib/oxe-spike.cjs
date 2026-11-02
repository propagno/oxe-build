'use strict';

/**
 * 1.21 · Spike path (OXB-007). In the OxeVoice F1 the confidence gate blocked the execute at 88% because nobody knew
 * whether PowerShell 5.1 can subscribe to WinRT events. A manual spike answered "no", the plan changed and went to 91%
 * with evidence. Without it the executor would have found out mid-task, with paid retries.
 *
 * PLAN.json: { "id": "T0", "kind": "spike", "title": "...", "question": "PS 5.1 consegue assinar eventos WinRT?" }
 *   - writes only `.oxe/spikes/<Tn>.md` (the default scope); never product code;
 *   - its verify checks the report has Pergunta/Question, Resposta|Decisão/Answer|Decision and Evidência/Evidence;
 *   - when it completes, the answer becomes a decision in `.oxe/program/decisions.ndjson` (the dossier shows it).
 */

const fs = require('fs');
const path = require('path');

const SPIKE_DIR = '.oxe/spikes';
const FIELDS = {
  // "Resposta: x", "**Resposta:** x" and "**Resposta**: x" all count.
  question: /^\s*(?:[-*]\s*)?\**(?:pergunta|question)\**\s*:\s*\**\s*(.+)$/im,
  answer: /^\s*(?:[-*]\s*)?\**(?:resposta|decis[ãa]o|answer|decision)\**\s*:\s*\**\s*(.+)$/im,
  evidence: /^\s*(?:[-*]\s*)?\**(?:evid[êe]ncia|evidence)\**\s*:\s*\**\s*(.+)$/im,
};

function spikeReportPath(taskId) {
  return `${SPIKE_DIR}/${taskId}.md`;
}

/** Fields of a spike report; `missing` lists what the verify requires and is not there. */
function parseSpikeReport(text) {
  const out = { missing: [] };
  for (const [key, re] of Object.entries(FIELDS)) {
    const m = re.exec(String(text || ''));
    if (m && m[1].trim()) out[key] = m[1].trim();
    else out.missing.push(key);
  }
  return out;
}

function checkSpikeReport(file) {
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, message: `relatório do spike ausente: ${file}` };
  }
  const report = parseSpikeReport(text);
  if (report.missing.length) return { ok: false, message: `relatório do spike incompleto (${report.missing.join(', ')}): ${file}`, report };
  return { ok: true, message: `spike respondido: ${report.answer}`, report };
}

/** Verify command of a spike task (node + this module), relative to the project root. */
function spikeVerifyCommand(taskId) {
  const self = __filename.replace(/\\/g, '/');
  return `node "${self}" --check ${spikeReportPath(taskId)}`;
}

/** Plan lint for spike tasks: a question, and a scope inside `.oxe/spikes/`. */
function lintSpikeTask(task) {
  const errors = [];
  const meta = (task && task.meta) || {};
  if (!task || (task.kind || meta.kind) !== 'spike') return errors;
  const question = task.question || meta.question;
  if (typeof question !== 'string' || question.trim().length < 8) errors.push(`${task.id}: spike sem "question" (a pergunta que ele responde)`);
  for (const file of Array.isArray(task.files) ? task.files : []) {
    if (!String(file).replace(/\\/g, '/').startsWith(`${SPIKE_DIR}/`)) errors.push(`${task.id}: spike escreve fora de ${SPIKE_DIR}/ (${file}) — spike não muda código do produto`);
  }
  return errors;
}

/** The spike's answer as an append-only decision (dossier `decisions.md`). */
function recordSpikeDecision(projectRoot, programDir, task) {
  const check = checkSpikeReport(path.join(projectRoot, spikeReportPath(task.id)));
  if (!check.ok) return null;
  const file = path.join(programDir, 'decisions.ndjson');
  const record = {
    kind: 'decision',
    id: `D-SPIKE-${task.id}`,
    title: check.report.answer,
    text: `Spike ${task.id}: ${check.report.question} — evidência: ${check.report.evidence}`,
    source: spikeReportPath(task.id),
    by: 'spike',
    at: new Date().toISOString(),
  };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

if (require.main === module) {
  const i = process.argv.indexOf('--check');
  const file = i >= 0 ? process.argv[i + 1] : null;
  const result = file ? checkSpikeReport(path.resolve(file)) : { ok: false, message: 'uso: oxe-spike.cjs --check <relatório>' };
  (result.ok ? console.log : console.error)(result.message);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = { SPIKE_DIR, spikeReportPath, parseSpikeReport, checkSpikeReport, spikeVerifyCommand, lintSpikeTask, recordSpikeDecision };
