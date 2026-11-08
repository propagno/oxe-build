'use strict';

/**
 * OXB-031 / OXB-043: which oxe-cc wrote a `.oxe/`, when it was last active, which program phase is active, and whether
 * it is stale. The oxespace main checkout had a September `.oxe/` (1.12/1.16) pointing to a dead plan while 1.5.0 ran in
 * the `oxespace-150` worktree; `oxe-cc status` there gave a next step from the dead plan, and a session running an
 * old global oxe-cc did not know it.
 *
 * `.oxe/oxe-version.json` = { oxe_version, created_at, updated_at } is written by every runtime write (appendEvent);
 * init/update stamp the version in the generated README.md (the lean core stays STATE/config/README). Read commands
 * never write either.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MARKER = 'oxe-version.json';
const touched = new Set();

function runningVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || null; } catch { return null; }
}

function readMarker(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', MARKER), 'utf8')); } catch { return null; }
}

/** Records the running version as the `.oxe/` writer (once per process and root; never fails the caller). */
function touchMarker(projectRoot, version = runningVersion()) {
  const key = path.resolve(projectRoot);
  if (touched.has(key) || !version) return;
  touched.add(key);
  try {
    const oxeDir = path.join(projectRoot, '.oxe');
    if (!fs.existsSync(oxeDir)) return;
    const prev = readMarker(projectRoot);
    if (prev && prev.oxe_version === version && prev.updated_at && Date.now() - Date.parse(prev.updated_at) < 60 * 60 * 1000) return;
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(oxeDir, MARKER), `${JSON.stringify({ oxe_version: version, created_at: (prev && prev.created_at) || now, created_by: (prev && prev.created_by) || version, updated_at: now }, null, 2)}\n`, 'utf8');
  } catch { /* auxiliary */ }
}

/** Version stamped in the generated .oxe/README.md by init/update (before any runtime write). */
function legendVersion(oxeDir) {
  try {
    const m = /<!-- oxe-cc-version: ([^\s]+) -->/.exec(fs.readFileSync(path.join(oxeDir, 'README.md'), 'utf8'));
    return m ? m[1] : null;
  } catch { return null; }
}

function cmpVersion(a, b) {
  try {
    const semver = require('./oxe-semver.cjs').loadSemver();
    if (semver.valid(a) && semver.valid(b)) return semver.compare(a, b);
  } catch { /* fallback below */ }
  const pa = String(a).split(/[.-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
}

/** Timestamp of the last event in OXE-EVENTS.ndjson (reads only the tail), else the newest mtime of the core files. */
function lastActivity(oxeDir) {
  const events = path.join(oxeDir, 'OXE-EVENTS.ndjson');
  try {
    const stat = fs.statSync(events);
    const size = Math.min(stat.size, 16 * 1024);
    const fd = fs.openSync(events, 'r');
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').trim().split('\n').reverse();
    for (const line of lines) {
      try { const ts = JSON.parse(line).timestamp; if (ts && !Number.isNaN(Date.parse(ts))) return ts; } catch { /* partial line */ }
    }
  } catch { /* no events */ }
  let newest = 0;
  for (const f of ['STATE.md', 'ACTIVE-RUN.json', 'PLAN.json', 'PLAN.md', 'SPEC.md', 'config.json']) {
    try { newest = Math.max(newest, fs.statSync(path.join(oxeDir, f)).mtimeMs); } catch { /* */ }
  }
  return newest ? new Date(newest).toISOString() : null;
}

/**
 * @returns {{ exists: boolean, path: string, version: string|null, running: string|null, last_activity: string|null,
 *   idle_days: number|null, program: { active_phase: string|null, status: string|null, closed: number, total: number }|null,
 *   stale: boolean, reasons: string[] }}
 */
function describeOxeDir(projectRoot, options = {}) {
  const oxeDir = path.join(projectRoot, '.oxe');
  const running = options.running || runningVersion();
  const out = { exists: fs.existsSync(oxeDir), path: oxeDir, version: null, running, last_activity: null, idle_days: null, program: null, stale: false, reasons: [] };
  if (!out.exists) return out;
  const marker = readMarker(projectRoot);
  out.version = marker && marker.oxe_version ? marker.oxe_version : legendVersion(oxeDir);
  out.last_activity = lastActivity(oxeDir);
  if (out.last_activity) out.idle_days = Math.floor((Date.now() - Date.parse(out.last_activity)) / 86_400_000);
  let program = null;
  try { program = JSON.parse(fs.readFileSync(path.join(oxeDir, 'program', 'PROGRAM.json'), 'utf8')); } catch { program = null; }
  if (program && Array.isArray(program.phases)) {
    const active = program.active_phase ? program.phases.find((p) => p.id === program.active_phase) : null;
    out.program = { active_phase: program.active_phase || null, status: active ? active.status : null, closed: program.phases.filter((p) => p.status === 'closed').length, total: program.phases.length };
  }
  const staleDays = Number.isInteger(options.staleDays) ? options.staleDays : 14;
  if (!out.version) out.reasons.push('sem registro da versão que gerou o .oxe/ (anterior à 1.21.2)');
  else if (running && cmpVersion(out.version, running) < 0) out.reasons.push(`gerado pelo oxe-cc ${out.version}, mais antigo que o ${running} em execução`);
  else if (running && cmpVersion(out.version, running) > 0) out.reasons.push(`escrito pelo oxe-cc ${out.version}, MAIS NOVO que o ${running} em execução — rode a versão do projeto (npx oxe-cc@${out.version})`);
  if (out.idle_days != null && out.idle_days > staleDays) out.reasons.push(`sem atividade há ${out.idle_days} dias`);
  // Older writer or long idle: stale. Unknown version alone is only stale when also idle (a fresh 1.21.1 dir is fine).
  out.stale = out.reasons.some((r) => /mais antigo|MAIS NOVO|sem atividade/.test(r));
  return out;
}

/** One line for status/doctor. */
function oxeDirLine(info) {
  if (!info.exists) return null;
  const parts = [`gerado pelo oxe-cc ${info.version || '?'}${info.running ? ` (rodando ${info.running})` : ''}`];
  if (info.last_activity) parts.push(`última atividade ${info.last_activity.slice(0, 10)}${info.idle_days ? ` (${info.idle_days}d)` : ''}`);
  if (info.program) parts.push(info.program.active_phase ? `programa: ${info.program.active_phase} ${info.program.status || ''} (${info.program.closed}/${info.program.total} fechadas)`.trim() : `programa: sem fase ativa (${info.program.closed}/${info.program.total} fechadas)`);
  return parts.join(' · ');
}

/** `.oxe/` of every worktree of the repository (`git worktree list --porcelain`). */
function worktreesOxe(projectRoot, options = {}) {
  const res = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return [];
  const rows = [];
  let cur = null;
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9).trim(), branch: null }; rows.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '').trim();
    else if (cur && line === 'detached') cur.branch = '(detached)';
  }
  return rows.map((r) => ({ ...r, here: path.resolve(r.path) === path.resolve(projectRoot), oxe: describeOxeDir(r.path, options) }));
}

module.exports = { MARKER, readMarker, touchMarker, describeOxeDir, oxeDirLine, worktreesOxe, runningVersion };
