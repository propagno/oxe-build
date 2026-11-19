'use strict';

/**
 * Grok CLI (`grok`) provider/adapter bridge for `oxe-cc`.
 * Supports:
 *   - `.oxe/config.json` -> `runtime.provider.name: "grok"` (or `adapter: "grok"`)
 *   - Executing `grok --prompt-file` / `--output-format json` / `--model`
 *     with the runtime still owning the tool loop
 */

const path = require('path');

const ADAPTER_ID = 'grok';
const HTTP_DEFAULT_MODEL = 'claude-sonnet-4-6';

function loadRuntime() {
  return require(path.join(__dirname, '..', '..', 'lib', 'runtime', 'index.js'));
}

function resolveGrokOptions({ flagModel = null, timeoutMs = undefined, persisted = null, cwd = undefined, env = process.env } = {}) {
  const norm = require('./oxe-provider-antigravity.cjs').normalizeProviderConfig(persisted) || {};
  const isPersisted = String(norm.adapter || norm.name || '').toLowerCase() === ADAPTER_ID;
  const persistedModel = isPersisted && norm.model && norm.model !== HTTP_DEFAULT_MODEL ? String(norm.model) : null;
  const model = flagModel || env.OXE_GROK_MODEL || persistedModel || null;
  const command = norm.command || norm.binary || env.OXE_GROK_BIN || undefined;
  const extraArgs = Array.isArray(norm.extraArgs) ? norm.extraArgs : (Array.isArray(norm.extra_args) ? norm.extra_args : undefined);
  return {
    ...(command ? { command } : {}),
    model,
    ...(cwd ? { cwd } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(extraArgs ? { extraArgs } : {}),
  };
}

function createGrokAdapter(options = {}) {
  const runtime = loadRuntime();
  return new runtime.GrokCliAdapter(options);
}

module.exports = {
  ADAPTER_ID,
  resolveGrokOptions,
  createGrokAdapter,
  get GrokCliAdapter() {
    return loadRuntime().GrokCliAdapter;
  },
};
