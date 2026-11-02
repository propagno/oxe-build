'use strict';

/**
 * 1.21 · Phase gates (OXB-020): the project's own gates (typecheck, lint, the repository's governance suite, CI)
 * run once in the phase verify — not per task — and a red gate becomes an automatic change request with the output.
 *
 * Declared in PLAN.json `phase_gates` and/or `.oxe/config.json` `phase_gates` (the plan wins on the same id):
 *   { id, command, runner?, when?: 'phase_verify' | 'program_close', kind?: 'command' | 'ci', repo? }
 * `runner` (or config `phase_gates_runner`) wraps the command, e.g. a heavy-lock: "node {env:TEMP}/lock.mjs -- {command}".
 * A `kind: 'ci'` gate is green only when the CI run attached to the phase (`runtime ci --attach <run>`) succeeded.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WHEN = new Set(['phase_verify', 'program_close']);
/** A full typecheck or governance suite takes minutes, not the verify's 60 s per check. */
const DEFAULT_GATE_TIMEOUT_MS = 15 * 60 * 1000;
const GOVERNANCE_TEST_RE = /(^|[\\/._-])(lint|allowlist|catalog|coverage|governance|ratchet|boundar(y|ies)|budget)[^\\/]*\.test\.[cm]?[jt]sx?$/i;
const GATE_SCRIPT_NAMES = ['typecheck', 'type-check', 'lint', 'check', 'test:governance'];

function normalizeGate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const kind = raw.kind === 'ci' ? 'ci' : 'command';
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!id || (kind === 'command' && !command)) return null;
  const when = WHEN.has(raw.when) ? raw.when : 'phase_verify';
  return {
    id,
    kind,
    command: kind === 'command' ? command : null,
    runner: typeof raw.runner === 'string' && raw.runner.trim() ? raw.runner.trim() : null,
    when,
    repo: typeof raw.repo === 'string' && raw.repo.trim() ? raw.repo.trim() : null,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    timeout_ms: Number(raw.timeout_ms) > 0 ? Number(raw.timeout_ms) : DEFAULT_GATE_TIMEOUT_MS,
  };
}

/** Gates of the plan and of config.json; the plan overrides config on the same id. */
function readPhaseGates(planJson, config) {
  const byId = new Map();
  for (const source of [config && config.phase_gates, planJson && planJson.phase_gates]) {
    for (const raw of Array.isArray(source) ? source : []) {
      const gate = normalizeGate(raw);
      if (gate) byId.set(gate.id, gate);
    }
  }
  return [...byId.values()];
}

function expandRunner(template, command) {
  return String(template)
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] || '')
    .replace(/\{command\}/g, command);
}

function quote(value) {
  return /[\s"]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : value;
}

/** The shell command a gate runs (runner applied; CI gates call this module's CLI). */
function gateCommand(gate, options = {}) {
  if (gate.kind === 'ci') {
    const args = [quote(process.execPath), quote(__filename), '--ci-gate', '--program-dir', quote(options.programDir || '.oxe/program')];
    if (options.phase) args.push('--phase', quote(options.phase));
    if (gate.repo) args.push('--repo', quote(gate.repo));
    return args.join(' ');
  }
  const runner = gate.runner || options.defaultRunner || null;
  return runner ? expandRunner(runner, gate.command) : gate.command;
}

/** Verification checks (same shape as the runtime's AcceptanceCheck) for the gates of one moment. */
function gateChecks(gates, when, options = {}) {
  return gates
    .filter((gate) => gate.when === when)
    .map((gate) => ({
      id: `gate-${gate.id}`,
      type: 'policy',
      command: gateCommand(gate, options),
      evidence_type_expected: 'stdout',
      acceptance_ref: null,
      description: `[gate do projeto] ${gate.description || gate.id}`,
      phase_gate: gate.id,
      timeout_ms: gate.timeout_ms,
    }));
}

function firstErrorLines(result, max = 12) {
  const text = [result && result.stdout, result && result.stderr, result && result.error].filter(Boolean).join('\n');
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const flagged = lines.filter((l) => /error|fail|✗|×|expected|received|TS\d{4}/i.test(l));
  return (flagged.length ? flagged : lines.slice(-max)).slice(0, max).join('\n');
}

/**
 * Failing gate checks become `constraint` CRs (one open CR per gate; a repeat failure does not duplicate it).
 * @returns {{ created: object[], program: object|null }}
 */
function recordGateFailures(input) {
  const changeLib = require('./oxe-change.cjs');
  const { programDir, plan, checkResults } = input;
  let program = input.program || null;
  const created = [];
  if (!programDir) return { created, program };
  const failing = (checkResults || []).filter((r) => /^gate-/.test(String(r.check_id || '')) && (r.status === 'fail' || r.status === 'error'));
  if (!failing.length) return { created, program };
  const open = changeLib.listChanges(programDir).filter((cr) => cr.status === 'open' && cr.gate);
  for (const result of failing) {
    const gateId = String(result.check_id).replace(/^gate-/, '');
    if (open.some((cr) => cr.gate === gateId)) continue;
    const excerpt = firstErrorLines(result);
    const out = changeLib.recordChange({
      programDir,
      program,
      plan,
      class: 'constraint',
      summary: `gate do projeto '${gateId}' reprovou no verify da fase${excerpt ? `: ${excerpt.split('\n')[0].slice(0, 160)}` : ''}`,
      by: `phase_gate:${gateId}`,
      gate: gateId,
      evidence: excerpt || null,
    });
    program = out.program || program;
    created.push(out.cr);
  }
  return { created, program };
}

/** Gates a plan could declare: package.json gate scripts and governance tests found in the repo. */
function detectGateCandidates(projectRoot) {
  const candidates = [];
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  for (const name of GATE_SCRIPT_NAMES) {
    if (typeof scripts[name] === 'string') candidates.push({ id: name.replace(/[^a-z0-9]+/gi, '-'), command: `npm run ${name}`, source: 'package.json' });
  }
  const tests = findGovernanceTests(projectRoot);
  if (tests.length) candidates.push({ id: 'governance', command: null, files: tests, source: 'tests' });
  return candidates;
}

function findGovernanceTests(projectRoot, maxDepth = 3) {
  const found = [];
  const roots = ['tests', 'test', '__tests__', 'src'];
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= 40) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (GOVERNANCE_TEST_RE.test(entry.name)) found.push(path.relative(projectRoot, full).replace(/\\/g, '/'));
    }
  };
  for (const root of roots) walk(path.join(projectRoot, root), 1);
  return found.sort();
}

/** Lint warning: the repo has gate candidates but the plan declares none. */
function lintPhaseGates(projectRoot, gates) {
  if (gates.length) return [];
  const candidates = detectGateCandidates(projectRoot);
  if (!candidates.length) return [];
  const names = candidates.map((c) => (c.command ? `${c.id} (\`${c.command}\`)` : `${c.id} (${c.files.length} teste(s): ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? '…' : ''})`));
  return [`sem phase_gates: o repositório tem gates que o verify da fase não roda — ${names.join('; ')}. Declare-os em PLAN.json phase_gates (OXB-020).`];
}

// ── CI attachment ──────────────────────────────────────────────────────────────

function ciFile(programDir) {
  return path.join(programDir, 'ci.ndjson');
}

function parseRunRef(ref) {
  const text = String(ref || '').trim();
  const url = /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/.exec(text);
  if (url) return { run: url[2], repo: url[1] };
  if (/^\d+$/.test(text)) return { run: text, repo: null };
  return null;
}

function attachCiRun(programDir, input) {
  const ref = parseRunRef(input.run);
  if (!ref) throw new Error('informe o run de CI: id numérico ou URL .../actions/runs/<id>');
  const record = {
    kind: 'ci',
    phase: input.phase || null,
    run: ref.run,
    repo: input.repo || ref.repo || null,
    head: input.head || null,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(ciFile(programDir), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function latestCiRun(programDir, phase) {
  let lines = [];
  try {
    lines = fs.readFileSync(ciFile(programDir), 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
  const records = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const matching = records.filter((r) => !phase || !r.phase || r.phase === phase);
  return matching.length ? matching[matching.length - 1] : null;
}

/** Status of a GitHub Actions run through `gh` (injected for tests). */
function ciRunStatus(record, options = {}) {
  const run = options.spawn || spawnSync;
  const args = ['run', 'view', String(record.run), '--json', 'status,conclusion,headSha,url'];
  if (record.repo) args.push('-R', record.repo);
  const res = run('gh', args, { encoding: 'utf8', timeout: 30000 });
  if (!res || res.status !== 0) return { ok: false, state: 'unknown', message: `gh run view falhou: ${(res && (res.stderr || res.error)) || 'sem saída'}`.trim() };
  let data = null;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return { ok: false, state: 'unknown', message: 'saída do gh não é JSON' };
  }
  if (data.status !== 'completed') return { ok: false, state: 'pending', message: `run ${record.run} ainda ${data.status}`, data };
  if (data.conclusion !== 'success') return { ok: false, state: 'red', message: `run ${record.run} terminou ${data.conclusion}`, data };
  if (record.head && data.headSha && !String(data.headSha).startsWith(record.head)) {
    return { ok: false, state: 'stale', message: `run ${record.run} cobre ${String(data.headSha).slice(0, 8)}, não a head ${record.head}`, data };
  }
  return { ok: true, state: 'green', message: `run ${record.run} verde (${data.url || ''})`.trim(), data };
}

function runCiGateCli(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const programDir = get('--program-dir') || '.oxe/program';
  const phase = get('--phase');
  const record = latestCiRun(programDir, phase);
  if (!record) {
    console.error(`nenhum run de CI anexado à fase ${phase || '(qualquer)'} — use: oxe-cc runtime ci --attach <run-id|url>`);
    return 1;
  }
  const status = ciRunStatus({ ...record, repo: get('--repo') || record.repo });
  (status.ok ? console.log : console.error)(status.message);
  return status.ok ? 0 : 1;
}

if (require.main === module && process.argv.includes('--ci-gate')) {
  process.exitCode = runCiGateCli(process.argv.slice(2));
}

module.exports = {
  DEFAULT_GATE_TIMEOUT_MS,
  normalizeGate,
  readPhaseGates,
  gateCommand,
  gateChecks,
  recordGateFailures,
  detectGateCandidates,
  findGovernanceTests,
  lintPhaseGates,
  attachCiRun,
  latestCiRun,
  ciRunStatus,
  parseRunRef,
  firstErrorLines,
};
