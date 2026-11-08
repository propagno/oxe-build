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
  const kind = raw.kind === 'ci' ? 'ci' : raw.kind === 'deploy' ? 'deploy' : 'command';
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!id || (kind === 'command' && !command)) return null;
  if (kind === 'deploy' && !(typeof raw.env === 'string' && raw.env.trim())) return null;
  // OXB-093: a deploy gate is checked at the close (the deploy happens after the phase's work).
  const when = WHEN.has(raw.when) ? raw.when : kind === 'deploy' ? 'program_close' : 'phase_verify';
  return {
    id,
    kind,
    command: kind === 'command' ? command : null,
    ...(kind === 'deploy' ? {
      env: raw.env.trim(),
      version: typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : null,
      required_checks: (Array.isArray(raw.checks) ? raw.checks : []).map((c) => String(c).trim()).filter(Boolean),
    } : {}),
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
  if (gate.kind === 'deploy') {
    const args = [quote(process.execPath), quote(__filename), '--deploy-gate', '--program-dir', quote(options.programDir || '.oxe/program'), '--env', quote(gate.env)];
    if (options.phase) args.push('--phase', quote(options.phase));
    if (gate.version) args.push('--version', quote(gate.version));
    for (const c of gate.required_checks || []) args.push('--require', quote(c));
    return args.join(' ');
  }
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

/**
 * OXB-070: the lines that make the gate FAIL, never the head of the stream. CR-16 (lint) quoted the first of 217
 * warnings ("285:3 warning … Error: Cannot access refs during render") — a case-insensitive /error/ matched a warning —
 * while the failure was 2 `error` lines at the end. Strong markers first (eslint `N:M error`, tsc `error TS`, test
 * runner FAIL/×/not ok/AssertionError, npm ERR!, a line starting with "error"); warnings never count; with none, the
 * last lines of the output (a non-zero exit's tail).
 */
const ESLINT_WARNING_RE = /^\s*\d+:\d+\s+warning\s/i;
const FAILING_LINE_RES = [
  /^\s*\d+:\d+\s+error\s/i, // eslint stylish
  /error TS\d{4}/, // tsc
  /^\s*(FAIL|×|✗|✖(?!\s+\d+\s+problems?))\s/, // vitest / jest / node:test reporters
  /^\s*not ok\s+\d+/, // TAP
  /AssertionError|Expected:|Received:/,
  /^npm ERR!/,
  /^\s*(error|ERROR)\b[:\s]/,
];
const SUMMARY_LINE_RE = /✖\s+\d+\s+problems?\s+\(\d+\s+errors?|Tests?\s+\d+\s+failed|Found \d+ errors?|\d+ failing/i;

function firstErrorLines(result, max = 12) {
  const text = [result && result.stdout, result && result.stderr, result && result.error].filter(Boolean).join('\n');
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const picked = [];
  let lastFile = null;
  for (const line of lines) {
    // eslint prints the file path on its own line, then its problems indented.
    if (/^[^\s].*\.(c|m)?[jt]sx?$|^[A-Za-z]:\\.*\.\w+$|^\/.*\.\w+$/.test(line)) { lastFile = line.trim(); continue; }
    if (ESLINT_WARNING_RE.test(line)) continue;
    if (FAILING_LINE_RES.some((re) => re.test(line))) {
      picked.push(/^\s*\d+:\d+\s+error\s/i.test(line) && lastFile ? `${lastFile}:${line.trim()}` : line.trim());
    }
  }
  if (picked.length) {
    const summary = lines.find((l) => SUMMARY_LINE_RE.test(l));
    const out = picked.slice(0, max);
    if (summary && !out.includes(summary.trim())) out.push(summary.trim());
    return out.join('\n');
  }
  return lines.filter((l) => !ESLINT_WARNING_RE.test(l)).slice(-max).join('\n');
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

// ── Deploy attachment (OXB-093) ────────────────────────────────────────────────
//
// `runtime deploy --attach <env> --version <v> --ref <tag|release url> [--check "<cmd>"]…` records that a deploy
// happened and runs the POST-DEPLOY checks given (install-over, packaged HML pass, upgrade-with-data). It NEVER performs
// the deploy: tags, releases and approvals stay with the people who own them. Commands that would deploy are refused.

const DEPLOY_ACTION_RE = /\b(git\s+(tag|push)|gh\s+release\s+(create|upload|edit)|npm\s+publish|release\.mjs|gh\s+workflow\s+run|docker\s+push|kubectl\s+(apply|rollout)|terraform\s+apply)\b/i;

function deployFile(programDir) {
  return path.join(programDir, 'deploy.ndjson');
}

/**
 * @param {string} programDir
 * @param {{ env: string, version: string, ref?: string|null, phase?: string|null, by?: string|null, checks?: string[], cwd?: string, spawn?: Function, env_vars?: object }} input
 */
function attachDeploy(programDir, input) {
  const env = String(input.env || '').trim();
  const version = String(input.version || '').trim();
  if (!env) throw new Error('informe o ambiente: oxe-cc runtime deploy --attach <env> --version <v> --ref <tag|url>');
  if (!version) throw new Error('informe a versão implantada: --version <v>');
  const checks = (input.checks || []).map((c) => String(c).trim()).filter(Boolean);
  const forbidden = checks.filter((c) => DEPLOY_ACTION_RE.test(c));
  if (forbidden.length) throw new Error(`--check é verificação pós-deploy, nunca o deploy: recusado ${forbidden.map((c) => `"${c.slice(0, 60)}"`).join(', ')} (tags, releases e aprovações ficam com quem as tem)`);
  const run = input.spawn || spawnSync;
  const results = checks.map((command, i) => {
    const started = Date.now();
    const res = run(command, { cwd: input.cwd || process.cwd(), shell: true, encoding: 'utf8', timeout: input.timeoutMs || DEFAULT_GATE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: input.env_vars || process.env });
    const exit = res && typeof res.status === 'number' ? res.status : null;
    return {
      id: `chk-${started.toString(36)}-${i + 1}`,
      command,
      exit,
      ok: exit === 0,
      at: new Date(started).toISOString(),
      secs: Math.round((Date.now() - started) / 1000),
      excerpt: exit === 0 ? null : firstErrorLines({ stdout: res && res.stdout, stderr: res && res.stderr, error: res && res.error ? String(res.error) : null }, 6) || null,
    };
  });
  const record = {
    kind: 'deploy',
    phase: input.phase || null,
    env,
    version,
    ref: input.ref ? String(input.ref).trim() : null,
    by: input.by || null,
    at: new Date().toISOString(),
    checks: results,
    ok: results.every((r) => r.ok),
  };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(deployFile(programDir), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function readDeploys(programDir, phase) {
  let lines = [];
  try { lines = fs.readFileSync(deployFile(programDir), 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && (!phase || !r.phase || r.phase === phase));
}

/**
 * A deploy gate is green when the phase has a deploy to `env` (of `version`, when declared) whose checks all passed and
 * that ran every required check (matched by substring of the command). Several attaches to the same env/version add up
 * (a check that passed later counts; the latest result of each command wins).
 */
function deployGateStatus(programDir, phase, gate) {
  const records = readDeploys(programDir, phase).filter((r) => r.env === gate.env && (!gate.version || r.version === gate.version));
  if (!records.length) return { ok: false, message: `nenhum deploy em ${gate.env}${gate.version ? ` ${gate.version}` : ''} anexado à fase ${phase || ''} — oxe-cc runtime deploy --attach ${gate.env} --version <v> --ref <tag|url> --check "<cmd>"` };
  const version = gate.version || records[records.length - 1].version;
  const latest = new Map();
  for (const r of records.filter((x) => x.version === version)) for (const c of r.checks || []) latest.set(c.command, c);
  const failed = [...latest.values()].filter((c) => !c.ok);
  if (failed.length) return { ok: false, message: `deploy ${gate.env} ${version}: check vermelho — ${failed.map((c) => `${c.command} (exit ${c.exit})`).join('; ')}` };
  const missing = (gate.required_checks || []).filter((req) => ![...latest.keys()].some((cmd) => cmd.includes(req)));
  if (missing.length) return { ok: false, message: `deploy ${gate.env} ${version}: checks exigidos não rodados — ${missing.join(', ')}` };
  return { ok: true, message: `deploy ${gate.env} ${version} verificado (${latest.size} check(s))` };
}

function runDeployGateCli(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const required = [];
  argv.forEach((a, i) => { if (a === '--require' && argv[i + 1]) required.push(argv[i + 1]); });
  const status = deployGateStatus(get('--program-dir') || '.oxe/program', get('--phase'), { env: get('--env'), version: get('--version'), required_checks: required });
  (status.ok ? console.log : console.error)(status.message);
  return status.ok ? 0 : 1;
}

if (require.main === module && process.argv.includes('--ci-gate')) {
  process.exitCode = runCiGateCli(process.argv.slice(2));
} else if (require.main === module && process.argv.includes('--deploy-gate')) {
  process.exitCode = runDeployGateCli(process.argv.slice(2));
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
  attachDeploy,
  readDeploys,
  deployGateStatus,
  DEPLOY_ACTION_RE,
  latestCiRun,
  ciRunStatus,
  parseRunRef,
  firstErrorLines,
};
