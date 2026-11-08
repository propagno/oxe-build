'use strict';

/**
 * OXB-032: SPEC and ROADMAP may live in versioned paths (`spec_ref` / `roadmap_ref` in .oxe/config.json, relative to
 * the project root), so the PR the team reviews is the file the runtime runs. The oxespace ignores .oxe/ and the team
 * copied SPEC/ROADMAP to docs/roadmap-1.5/oxe/ by hand three times in one day; the copies diverged.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readConfig(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8')) || {}; } catch { return {}; }
}

/** Configured refs, resolved: { spec, roadmap } with { configured, path, exists } each (null when not configured). */
function artifactRefs(projectRoot) {
  const config = readConfig(projectRoot);
  const one = (key) => {
    const raw = typeof config[key] === 'string' ? config[key].trim() : '';
    if (!raw) return null;
    const abs = path.resolve(projectRoot, raw);
    return { configured: raw, path: abs, exists: fs.existsSync(abs) };
  };
  return { spec: one('spec_ref'), roadmap: one('roadmap_ref') };
}

/** The ref when configured AND present, else `fallback`. */
function refOr(ref, fallback) {
  return ref && ref.exists ? ref.path : fallback;
}

const hashText = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

/** Doctor: a configured ref that is missing, and a .oxe/ copy that diverges from it (by content hash). */
function refWarnings(projectRoot) {
  const refs = artifactRefs(projectRoot);
  const out = [];
  for (const [key, name] of [['spec', 'SPEC.md'], ['roadmap', 'ROADMAP.md']]) {
    const ref = refs[key];
    if (!ref) continue;
    if (!ref.exists) { out.push(`${key}_ref aponta para ${ref.configured}, que não existe — o runtime usa .oxe/${name}`); continue; }
    const copy = path.join(projectRoot, '.oxe', name);
    if (path.resolve(copy) !== path.resolve(ref.path) && fs.existsSync(copy)) {
      try {
        if (hashText(copy) !== hashText(ref.path)) out.push(`.oxe/${name} diverge de ${ref.configured} (o runtime lê ${ref.configured}) — apague a cópia ou alinhe-a`);
      } catch { /* unreadable */ }
    }
  }
  return out;
}

module.exports = { artifactRefs, refOr, refWarnings };
