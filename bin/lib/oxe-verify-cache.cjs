'use strict';

/**
 * 1.22.2 (OXB-222-15): Incremental verification regression cache keyed by
 * (check_id, command, tree_fingerprint). Only caches verified PASS results;
 * never caches failures, errors, skips, or checks with modified frozen files.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CACHE_SCHEMA = 1;
const MAX_ENTRIES = 400;

function cacheFilePath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.oxe', 'runs', 'verify-regression-cache.json');
}

function makeCacheKey(check, fingerprint) {
  const raw = JSON.stringify({
    id: String((check && check.id) || ''),
    cmd: String((check && check.command) || ''),
    proves: Array.isArray(check && check.proves) ? check.proves : [],
    fp: String(fingerprint || ''),
  });
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 24);
}

/**
 * Computes a deterministic workspace code fingerprint (HEAD + working-tree diff + untracked hashes),
 * ignoring `.oxe/` runtime artifacts so non-code projections do not needlessly bust regression cache.
 */
function computeVerifyFingerprint(projectRoot, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(projectRoot);
  const hash = crypto.createHash('sha256');
  try {
    const head = spawn('git', ['rev-parse', 'HEAD'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
    if (head.status !== 0) return null;
    hash.update(`HEAD:${String(head.stdout || '').trim()}\n`);
    const diff = spawn('git', ['diff', 'HEAD', '--', '.', ':!.oxe'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    hash.update(`DIFF:${String(diff.stdout || '')}\n`);
    const untracked = spawn('git', ['ls-files', '--others', '--exclude-standard', '--', '.', ':!.oxe'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
    const files = String(untracked.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
    for (const rel of files.slice(0, 200)) {
      const abs = path.join(rootAbs, rel);
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && st.size <= 1024 * 1024) {
          hash.update(`U:${rel}:${st.size}:${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}\n`);
        }
      } catch { /* ignore */ }
    }
    return hash.digest('hex').slice(0, 24);
  } catch {
    return null;
  }
}

function loadVerifyCache(projectRoot) {
  const file = cacheFilePath(projectRoot);
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc && doc.schema === CACHE_SCHEMA && doc.entries && typeof doc.entries === 'object') {
      return doc;
    }
  } catch { /* absent or corrupt */ }
  return { schema: CACHE_SCHEMA, entries: {} };
}

function saveVerifyCache(projectRoot, cache) {
  if (!cache || typeof cache !== 'object') return;
  const file = cacheFilePath(projectRoot);
  const entries = cache.entries && typeof cache.entries === 'object' ? cache.entries : {};
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => String((entries[a] && entries[a].recorded_at) || '').localeCompare(String((entries[b] && entries[b].recorded_at) || '')));
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[k];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema: CACHE_SCHEMA, entries }, null, 2)}\n`, 'utf8');
}

function lookupCachedPass(cache, check, fingerprint) {
  if (!cache || !cache.entries || !check || !check.command || !fingerprint) return null;
  const key = makeCacheKey(check, fingerprint);
  const entry = cache.entries[key];
  if (!entry || entry.status !== 'pass' || entry.fingerprint !== fingerprint) return null;
  return {
    check_id: check.id,
    acceptance_ref: check.acceptance_ref || null,
    status: 'pass',
    stdout: String(entry.stdout || ''),
    stderr: String(entry.stderr || ''),
    exit_code: 0,
    duration_ms: 0,
    error: null,
    tests_executed: entry.tests_executed ?? null,
    evidence_refs: [],
    cached: true,
  };
}

function recordVerifyPass(cache, check, result, fingerprint) {
  if (!cache || !check || !result || !fingerprint) return false;
  if (result.status !== 'pass' || !check.command) return false;
  if (!cache.entries || typeof cache.entries !== 'object') cache.entries = {};
  const key = makeCacheKey(check, fingerprint);
  cache.entries[key] = {
    check_id: check.id,
    command: check.command,
    fingerprint,
    status: 'pass',
    stdout: String(result.stdout || '').slice(0, 64 * 1024),
    stderr: String(result.stderr || '').slice(0, 16 * 1024),
    tests_executed: result.tests_executed ?? null,
    recorded_at: new Date().toISOString(),
  };
  return true;
}

module.exports = {
  cacheFilePath,
  makeCacheKey,
  computeVerifyFingerprint,
  loadVerifyCache,
  saveVerifyCache,
  lookupCachedPass,
  recordVerifyPass,
};
