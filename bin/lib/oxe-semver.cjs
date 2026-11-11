'use strict';

/**
 * 1.21.2 (OXB-056): `semver` without `npm install`.
 *
 * A fresh clone runs `node bin/oxe-cc.js --version` before any install. Requiring `semver` at module load made that
 * fail with "Cannot find module 'semver'". The package is used when present; otherwise this minimal fallback covers
 * what the CLI needs (valid, coerce, compare, gt, gte, rcompare, major, minor) for plain `X.Y.Z[-pre]` versions.
 */

let cached = null;

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(v) {
  const m = SEMVER_RE.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]);
    const nb = /^\d+$/.test(b[i]);
    if (na && nb) {
      const d = Number(a[i]) - Number(b[i]);
      if (d) return d > 0 ? 1 : -1;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
}

function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new TypeError(`Invalid Version: ${!pa ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  return comparePre(pa.pre, pb.pre);
}

const lite = {
  lite: true,
  valid(v) {
    const p = parse(v);
    return p ? `${p.major}.${p.minor}.${p.patch}${p.pre.length ? `-${p.pre.join('.')}` : ''}` : null;
  },
  coerce(v) {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v == null ? '' : v));
    if (!m) return null;
    return { version: `${Number(m[1])}.${Number(m[2] || 0)}.${Number(m[3] || 0)}` };
  },
  compare,
  rcompare: (a, b) => compare(b, a),
  gt: (a, b) => compare(a, b) > 0,
  gte: (a, b) => compare(a, b) >= 0,
  lt: (a, b) => compare(a, b) < 0,
  major: (v) => parse(v).major,
  minor: (v) => parse(v).minor,
  patch: (v) => parse(v).patch,
};

function loadSemver() {
  if (cached) return cached;
  try {
    cached = require('semver');
  } catch {
    cached = lite;
  }
  return cached;
}

module.exports = { loadSemver, lite };
