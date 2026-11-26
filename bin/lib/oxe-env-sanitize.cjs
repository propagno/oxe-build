'use strict';

/**
 * 1.23.0 (OXB-G02): Configurable environment variable sanitization before spawning child processes
 * (verify, executor, preflight, checks). Prevents runtime variables leaked from host apps
 * (e.g. OXESPACE_*, AI_MEMORY_*) from polluting tests and builds.
 *
 * Config in `oxe.config.json` or `.oxe/config.json`:
 *   "envSanitize": true | false | { "enabled": true, "stripEnvPrefixes": ["OXESPACE_", "AI_MEMORY_"], "allow": [] }
 *   "stripEnvPrefixes": ["OXESPACE_", "AI_MEMORY_"]
 *   (also honors legacy `env_scrub`, `env_allow`, and `policy_rules` env strip entries)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STRIP_PREFIXES = Object.freeze(['OXESPACE_', 'AI_MEMORY_']);
const DEFAULT_STRIP_EXACT = Object.freeze(['NODE_TEST_CONTEXT']);
const DEFAULT_SECRET_RE = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/i;

function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMergedConfig(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return {};
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves the effective env sanitization policy from a project root or raw config object.
 * @param {string|object|null} projectRootOrCfg
 */
function resolveEnvSanitizeConfig(projectRootOrCfg) {
  const cfg = typeof projectRootOrCfg === 'string'
    ? readMergedConfig(projectRootOrCfg)
    : (projectRootOrCfg && typeof projectRootOrCfg === 'object' ? projectRootOrCfg : {});
  const es = cfg.envSanitize;
  const enabled = es === false || (es && typeof es === 'object' && es.enabled === false) ? false : true;
  const prefixSet = new Set(enabled ? DEFAULT_STRIP_PREFIXES : []);
  const addPrefixes = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      const s = String(p || '').trim();
      if (s) prefixSet.add(s);
    }
  };
  addPrefixes(cfg.stripEnvPrefixes);
  if (es && typeof es === 'object') {
    addPrefixes(es.stripEnvPrefixes);
    addPrefixes(es.stripPrefixes);
    addPrefixes(es.prefixes);
  }
  const scrubPatterns = [];
  if (Array.isArray(cfg.env_scrub)) {
    for (const p of cfg.env_scrub) if (typeof p === 'string' && p.trim()) scrubPatterns.push(p.trim());
  }
  if (es && typeof es === 'object' && Array.isArray(es.stripRegex)) {
    for (const p of es.stripRegex) if (typeof p === 'string' && p.trim()) scrubPatterns.push(p.trim());
  }
  try {
    const policyLib = require('./oxe-policy-rules.cjs');
    if (typeof policyLib.envStripPatterns === 'function') {
      scrubPatterns.push(...policyLib.envStripPatterns(cfg.policy_rules));
    }
  } catch { /* optional */ }
  const allowSet = new Set();
  const addAllow = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      const s = String(a || '').trim();
      if (s) allowSet.add(s);
    }
  };
  addAllow(cfg.env_allow);
  if (es && typeof es === 'object') addAllow(es.allow);
  const stripSecrets = es && typeof es === 'object' && typeof es.stripSecrets === 'boolean' ? es.stripSecrets : false;
  return {
    enabled,
    prefixes: [...prefixSet],
    scrubPatterns: [...new Set(scrubPatterns)],
    allow: [...allowSet],
    stripSecrets,
  };
}

/**
 * Converts the resolved policy into `{ scrub, allow }` regex strings compatible with `runtime.configureChildEnv`.
 */
function toChildEnvPolicy(projectRootOrCfg) {
  const pol = resolveEnvSanitizeConfig(projectRootOrCfg);
  if (!pol.enabled) return { scrub: [], allow: pol.allow };
  const prefixPatterns = pol.prefixes.map((p) => `^${escapeRegex(p)}`);
  return {
    scrub: [...new Set([...prefixPatterns, ...pol.scrubPatterns])],
    allow: pol.allow,
  };
}

/**
 * Produces a sanitized copy of `baseEnv` for spawning child processes.
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @param {string|object|null} [projectRootOrCfg]
 * @param {{ stripSecrets?: boolean }} [options]
 * @returns {{ env: Record<string, string>, stripped: string[] }}
 */
function sanitizeEnv(baseEnv = process.env, projectRootOrCfg = null, options = {}) {
  const pol = resolveEnvSanitizeConfig(projectRootOrCfg);
  const allowSet = new Set(pol.allow);
  const allowLower = new Set(pol.allow.map((a) => a.toLowerCase()));
  const isAllowed = (k) => allowSet.has(k) || (process.platform === 'win32' && allowLower.has(k.toLowerCase()));
  const regexes = pol.scrubPatterns.map((p) => {
    try { return new RegExp(p, 'i'); } catch { return null; }
  }).filter(Boolean);
  const stripSecrets = options.stripSecrets === true || pol.stripSecrets === true;
  const out = {};
  const stripped = [];
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (value === undefined) continue;
    if (isAllowed(key)) {
      out[key] = value;
      continue;
    }
    if (DEFAULT_STRIP_EXACT.includes(key)) {
      stripped.push(key);
      continue;
    }
    if (pol.enabled) {
      const upper = key.toUpperCase();
      const hitPrefix = pol.prefixes.some((p) => upper.startsWith(p.toUpperCase()));
      const hitRegex = !hitPrefix && regexes.some((re) => re.test(key));
      const hitSecret = !hitPrefix && !hitRegex && stripSecrets && DEFAULT_SECRET_RE.test(key);
      if (hitPrefix || hitRegex || hitSecret) {
        stripped.push(key);
        continue;
      }
    }
    out[key] = value;
  }
  return { env: out, stripped: stripped.sort() };
}

module.exports = {
  DEFAULT_STRIP_PREFIXES,
  resolveEnvSanitizeConfig,
  toChildEnvPolicy,
  sanitizeEnv,
};
