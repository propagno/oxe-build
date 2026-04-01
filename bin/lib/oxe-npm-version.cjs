'use strict';

const { spawnSync } = require('child_process');
const semver = require('semver');

/**
 * Extrai versão semver do stdout de `npm view <pkg> version`.
 * @param {string} stdout
 * @returns {string | null}
 */
function parseNpmViewVersion(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  const line = stdout.trim().split(/\r?\n/)[0].trim();
  if (!line) return null;
  let candidate = line;
  if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = line.slice(1, -1);
    }
  }
  candidate = String(candidate).replace(/^v/i, '').trim();
  const coerced = semver.coerce(candidate);
  return coerced ? coerced.version : null;
}

/**
 * @param {string} latest
 * @param {string} current
 * @returns {boolean}
 */
function isNewerThan(latest, current) {
  if (!semver.valid(latest) || !semver.valid(current)) return false;
  return semver.gt(latest, current);
}

/**
 * @param {string} packageName
 * @param {Record<string, string | undefined>} [spawnOpts] opções extra para spawnSync (ex.: env)
 * @returns {{ ok: true, version: string } | { ok: false, error: string }}
 */
function syncNpmViewVersion(packageName, spawnOpts = {}) {
  const r = spawnSync('npm', ['view', packageName, 'version'], {
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    ...spawnOpts,
  });
  if (r.error) return { ok: false, error: r.error.message || String(r.error) };
  if (r.status !== 0 && r.status !== null) {
    const err = (r.stderr || r.stdout || '').trim() || `npm view exited ${r.status}`;
    return { ok: false, error: err };
  }
  const v = parseNpmViewVersion(r.stdout || '');
  if (!v) return { ok: false, error: 'Não foi possível interpretar a versão devolvida pelo npm.' };
  return { ok: true, version: v };
}

module.exports = {
  parseNpmViewVersion,
  isNewerThan,
  syncNpmViewVersion,
};
