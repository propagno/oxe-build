'use strict';

/**
 * OXB-202: checks that only fail AFTER work from several places meets — run at the reconciliation points (the merge of
 * the base into the program branch by `runtime sync`, and the promote branch before its push).
 *   - `node scripts/check-file-size.mjs` — two phases each added lines to a file in the size baseline (F2 + F3 summed
 *     2–24 lines over the cap on src/App.tsx and SettingsModal.tsx; every per-phase gate was green);
 *   - `npm run notices:check` — package.json changed and THIRD_PARTY_NOTICES.md did not (CI "Quick checks" failed).
 * OXB-206: block any Git-tracked `tests/acceptance/parked-*` directory at PR promotion / pre-push so parked future-phase
 * suites are never committed and executed prematurely by Vitest/CI.
 *
 * Each script runs only when the repository has it. `.oxe/config.json`:
 *   "integration_checks": false                       // off
 *   "integration_checks": ["node scripts/x.mjs", …]   // replaces the detected list
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE_SIZE_SCRIPT = 'scripts/check-file-size.mjs';
const PARKED_ACCEPTANCE_RE = /(?:^|\/)(tests\/acceptance\/parked-[^/]+)(?:\/|$)/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function gitBlobSha(root, rev, file) {
  const res = spawnSync('git', ['rev-parse', '--verify', '-q', `${rev}:${norm(file)}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return res.status === 0 && res.stdout ? res.stdout.trim() : null;
}

/**
 * OXB-206: Git-tracked files inside `tests/acceptance/parked-*`.
 * When `options.ref` is passed, inspects that tree (`git ls-tree`); otherwise inspects the index (`git ls-files`).
 * When `options.baseRef` is passed (e.g. PR target branch), excludes files that already existed with the identical
 * blob on `baseRef` so unrelated cherry-picks do not trip on pre-existing base fixtures.
 */
function findTrackedParkedAcceptance(root, options = {}) {
  const ref = options.ref ? String(options.ref).trim() : null;
  const baseRef = options.baseRef && !/^0+$/.test(String(options.baseRef).trim()) ? String(options.baseRef).trim() : null;
  let lines = [];
  try {
    const args = ref ? ['ls-tree', '-r', '--name-only', ref] : ['ls-files'];
    const res = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (res.status === 0 && res.stdout) {
      lines = res.stdout.split(/\r?\n/).map(norm).filter(Boolean);
    }
  } catch {
    return [];
  }
  const matched = lines.filter((p) => PARKED_ACCEPTANCE_RE.test(p));
  if (!matched.length || !baseRef) return matched.sort();

  const targetRev = ref || 'HEAD';
  return matched
    .filter((file) => {
      const baseBlob = gitBlobSha(root, baseRef, file);
      if (!baseBlob) return true;
      if (!ref) {
        const idxRes = spawnSync('git', ['ls-files', '-s', '--', file], { cwd: root, encoding: 'utf8', windowsHide: true });
        const idxMatch = idxRes.status === 0 && idxRes.stdout ? /^\d+\s+([0-9a-f]{40,64})\s+/i.exec(idxRes.stdout.trim()) : null;
        const curBlob = idxMatch ? idxMatch[1] : gitBlobSha(root, targetRev, file);
        return curBlob !== baseBlob;
      }
      const curBlob = gitBlobSha(root, targetRev, file);
      return curBlob !== baseBlob;
    })
    .sort();
}

function parkedAcceptanceDirs(files) {
  const dirs = new Set();
  for (const f of files || []) {
    const m = PARKED_ACCEPTANCE_RE.exec(norm(f));
    if (m && m[1]) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

function formatParkedAcceptanceError(files) {
  const dirs = parkedAcceptanceDirs(files);
  return `diretório(s) estacionado(s) em tests/acceptance/parked-* rastreado(s) pelo Git: ${dirs.join(', ')} (${files.slice(0, 5).join(', ')}) — remova do índice git (git rm -r --cached ${dirs.join(' ')}) antes do PR/push`;
}

/**
 * OXB-206: Git `pre-push` check. Accepts standard git pre-push stdin lines
 * (`<localRef> <localSha> <remoteRef> <remoteSha>`); when empty, checks the current index/HEAD.
 */
function checkPrePush(root, stdinText = '', options = {}) {
  const raw = String(stdinText || '').trim();
  const found = new Set();
  if (raw) {
    for (const line of raw.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const [, localSha, , remoteSha] = parts;
      if (!localSha || /^0+$/.test(localSha)) continue;
      const baseRef = remoteSha && !/^0+$/.test(remoteSha) ? remoteSha : (options.baseRef || null);
      for (const f of findTrackedParkedAcceptance(root, { ref: localSha, baseRef })) found.add(f);
    }
  } else {
    for (const f of findTrackedParkedAcceptance(root, options)) found.add(f);
  }
  const parked_files = [...found].sort();
  const parked_dirs = parkedAcceptanceDirs(parked_files);
  return {
    ok: parked_files.length === 0,
    parked_files,
    parked_dirs,
    message: parked_files.length ? formatParkedAcceptanceError(parked_files) : null,
  };
}

/** Installs an idempotent OXE pre-push hook into `<root>/.git/hooks/pre-push` when `<root>` is a git checkout. */
function installPrePushHook(root, cliScriptPath = path.resolve(__dirname, '..', 'oxe-cc.js')) {
  const gitDirRes = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (gitDirRes.status !== 0 || !gitDirRes.stdout.trim()) return { installed: false, path: null };
  const gitDir = path.resolve(root, gitDirRes.stdout.trim());
  const hookPath = path.join(gitDir, 'hooks', 'pre-push');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  const cliNorm = cliScriptPath.replace(/\\/g, '/');
  const markerStart = '# >>> oxe-cc pre-push >>>';
  const markerEnd = '# <<< oxe-cc pre-push <<<';
  const block = [
    markerStart,
    `node "${cliNorm}" runtime pre-push || exit 1`,
    markerEnd,
  ].join('\n');
  let existing = '';
  try { existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : ''; } catch { existing = ''; }
  let next;
  if (existing.includes(markerStart) && existing.includes(markerEnd)) {
    const re = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);
    next = existing.replace(re, block);
  } else if (existing.trim()) {
    next = `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
  } else {
    next = `#!/bin/sh\n${block}\n`;
  }
  fs.writeFileSync(hookPath, next, { encoding: 'utf8', mode: 0o755 });
  try { fs.chmodSync(hookPath, 0o755); } catch { /* windows */ }
  return { installed: true, path: hookPath };
}

/** The commands to run in `root` (a checkout or a worktree), from config or detected. */
function integrationCommands(root, config) {
  const cfg = config || readJson(path.join(root, '.oxe', 'config.json')) || {};
  if (cfg.integration_checks === false) return [];
  if (Array.isArray(cfg.integration_checks)) return cfg.integration_checks.map((c) => String(c).trim()).filter(Boolean);
  const out = [];
  if (fs.existsSync(path.join(root, FILE_SIZE_SCRIPT))) out.push(`node ${FILE_SIZE_SCRIPT}`);
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg && pkg.scripts && typeof pkg.scripts['notices:check'] === 'string') out.push('npm run notices:check');
  return out;
}

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/**
 * Runs the integration checks in `root`. Stops at the first red one.
 * @returns {{ ran: Array<{ command: string, ok: boolean, exit: number|null, tail?: string }>, ok: boolean, failed: object|null }}
 */
function runIntegrationChecks(root, options = {}) {
  const config = options.config || readJson(path.join(options.configRoot || root, '.oxe', 'config.json')) || {};
  const ran = [];
  if (options.parkedCheck !== false && config.parked_acceptance_check !== false) {
    const parked = findTrackedParkedAcceptance(root, { ref: options.ref || null, baseRef: options.baseRef || null });
    if (parked.length) {
      const entry = {
        command: 'git ls-files tests/acceptance/parked-*',
        ok: false,
        exit: 1,
        parked_files: parked,
        parked_dirs: parkedAcceptanceDirs(parked),
        tail: formatParkedAcceptanceError(parked),
      };
      ran.push(entry);
      return { ran, ok: false, failed: entry };
    }
  }
  const commands = options.commands || integrationCommands(root, config);
  const run = options.spawn || spawnSync;
  for (const command of commands) {
    const r = run(command, { cwd: root, shell: true, encoding: 'utf8', windowsHide: true, env: childEnv(), timeout: options.timeoutMs || 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    const exit = r && typeof r.status === 'number' ? r.status : null;
    const entry = { command, ok: exit === 0, exit };
    if (exit !== 0) entry.tail = `${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}`.trim().split(/\r?\n/).slice(-8).join('\n');
    ran.push(entry);
    if (exit !== 0) return { ran, ok: false, failed: entry };
  }
  return { ran, ok: true, failed: null };
}

module.exports = {
  integrationCommands,
  runIntegrationChecks,
  findTrackedParkedAcceptance,
  parkedAcceptanceDirs,
  formatParkedAcceptanceError,
  checkPrePush,
  installPrePushHook,
  FILE_SIZE_SCRIPT,
  PARKED_ACCEPTANCE_RE,
};
