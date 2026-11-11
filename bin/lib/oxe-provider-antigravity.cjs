'use strict';

/**
 * OXB-197: Dedicated Antigravity CLI (`agy`) provider/adapter bridge for `oxe-cc`.
 * Supports:
 *   - `.oxe/config.json` -> `runtime.provider.name: "antigravity"` (or `adapter: "antigravity" | "agy"`)
 *   - Executing `agy -p "<prompt>"` / `--model` forwarding allowed credentials/env and preserving multi-turn
 *     `LlmTaskExecutor` tool execution + `ExecutorTurn` heartbeats
 *   - Parsing NDJSON (`stream-json`) and JSON events emitted by Antigravity CLI (`agy`)
 */

const path = require('path');

const ADAPTER_ID = 'antigravity';
const ALIASES = Object.freeze(['antigravity', 'agy']);
const HTTP_DEFAULT_MODEL = 'claude-sonnet-4-6';

function loadRuntime() {
  return require(path.join(__dirname, '..', '..', 'lib', 'runtime', 'index.js'));
}

function isAntigravityAlias(value) {
  const clean = String(value || '').trim().toLowerCase();
  return clean === 'antigravity' || clean === 'agy';
}

function normalizeAdapterId(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (clean === 'antigravity' || clean === 'agy') return 'antigravity';
  if (clean === 'claude') return 'claude';
  if (clean === 'http') return 'http';
  return clean;
}

/**
 * Normalizes `runtime.provider` from `.oxe/config.json`.
 * Accepts `runtime.provider.name: "antigravity"` as well as `runtime.provider.adapter: "antigravity" | "agy"`.
 */
function normalizeProviderConfig(provider) {
  if (!provider || typeof provider !== 'object') return null;
  const out = { ...provider };
  const candidate = out.adapter || out.name || '';
  if (isAntigravityAlias(candidate)) {
    out.adapter = ADAPTER_ID;
    if (!out.name) out.name = ADAPTER_ID;
  } else if (out.adapter) {
    out.adapter = normalizeAdapterId(out.adapter);
  } else if (out.name && (String(out.name).toLowerCase() === 'claude' || String(out.name).toLowerCase() === 'http')) {
    out.adapter = normalizeAdapterId(out.name);
  }
  return out;
}

/**
 * Resolves options passed to `AntigravityCliAdapter` from CLI flags, `.oxe/config.json` `runtime.provider`, and `process.env`.
 */
function resolveAntigravityOptions({ flagModel = null, timeoutMs = undefined, persisted = null, env = process.env } = {}) {
  const norm = normalizeProviderConfig(persisted) || {};
  const isPersistedAgy = isAntigravityAlias(norm.adapter || norm.name);
  const persistedModel = isPersistedAgy && norm.model && norm.model !== HTTP_DEFAULT_MODEL ? String(norm.model) : null;
  const model = flagModel || env.OXE_AGY_MODEL || env.OXE_ANTIGRAVITY_MODEL || persistedModel || null;
  const command = norm.command || norm.binary || env.OXE_AGY_BIN || env.OXE_ANTIGRAVITY_BIN || undefined;
  const mode = norm.mode !== undefined ? norm.mode : undefined;
  const outputFormat = norm.outputFormat || norm.output_format || undefined;
  const extraArgs = Array.isArray(norm.extraArgs) ? norm.extraArgs : (Array.isArray(norm.extra_args) ? norm.extra_args : undefined);
  const allowEnv = Array.isArray(norm.allowEnv) ? norm.allowEnv : (Array.isArray(norm.allow_env) ? norm.allow_env : undefined);
  return {
    ...(command ? { command } : {}),
    model,
    ...(mode !== undefined ? { mode } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(allowEnv ? { allowEnv } : {}),
  };
}

function createAntigravityAdapter(options = {}) {
  const runtime = loadRuntime();
  return new runtime.AntigravityCliAdapter(options);
}

function parseAntigravityEvents(stdout) {
  return loadRuntime().parseAntigravityEvents(stdout);
}

function agyFailure(input) {
  return loadRuntime().agyFailure(input);
}

function buildAntigravityArgs(prompt, options) {
  return loadRuntime().buildAntigravityArgs(prompt, options);
}

module.exports = {
  ADAPTER_ID,
  ALIASES,
  isAntigravityAlias,
  normalizeAdapterId,
  normalizeProviderConfig,
  resolveAntigravityOptions,
  createAntigravityAdapter,
  parseAntigravityEvents,
  agyFailure,
  buildAntigravityArgs,
  get AntigravityCliAdapter() {
    return loadRuntime().AntigravityCliAdapter;
  },
};
