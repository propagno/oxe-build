'use strict';

/**
 * 1.23.0 (OXB-G05): `oxe-cc acceptance-audit`
 * Audits frozen acceptance specs in `tests/acceptance/**` and `e2e/acceptance/**` for drift:
 *   1. Specs testing requirements/features explicitly marked cut / out-of-scope / superseded / removed in SPEC.md, PRD.md or ROADMAP.md
 *   2. Frozen specs on disk that are no longer referenced by PLAN.json `acceptance_tests` (orphans)
 *   3. Broken relative imports or removed source paths referenced by frozen specs
 *   4. Specs exceeding staleness threshold (`maxAgeDays`) without explicit review before tag cut
 */

const fs = require('fs');
const path = require('path');

const CUT_LINE_RE = /\b(cortad[oa]|cut|remov[ei]d[oa]?|superseded|obsolet[oa]|descontinuad[oa]|deprecated|fora de escopo|out of scope|cancelad[oa]|dropped)\b/i;
const REQ_ID_RE = /\b(?:[ABRS]\d+(?:\.\d+)*|US-\d+|BRD-\d+|VIS-\d+|OXE-\d+)\b/g;

function readQuiet(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

function readJsonQuiet(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}

function walkAcceptanceSpecs(rootAbs) {
  const specs = [];
  const roots = [
    path.join(rootAbs, 'tests', 'acceptance'),
    path.join(rootAbs, 'e2e', 'acceptance'),
  ];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name.startsWith('parked-')) continue;
        walk(full);
      } else if (ent.isFile() && /\.(?:spec|test)\.[tj]sx?$/i.test(ent.name)) {
        specs.push(path.relative(rootAbs, full).replace(/\\/g, '/'));
      }
    }
  };
  for (const r of roots) walk(r);
  return [...new Set(specs)].sort();
}

/**
 * Extracts requirement / feature IDs marked cut / removed / out-of-scope / superseded in SPEC.md, PRD.md, ROADMAP.md.
 */
function extractCutRequirements(rootAbs) {
  const cut = new Map(); // id -> { source, line }
  const docPaths = [
    path.join(rootAbs, '.oxe', 'SPEC.md'),
    path.join(rootAbs, '.oxe', 'PRD.md'),
    path.join(rootAbs, '.oxe', 'ROADMAP.md'),
  ];
  for (const p of docPaths) {
    const text = readQuiet(p);
    if (!text) continue;
    const rel = path.relative(rootAbs, p).replace(/\\/g, '/');
    let inOutOfScopeSection = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const h = /^#{1,4}\s+(.*)$/.exec(rawLine);
      if (h) {
        inOutOfScopeSection = /\b(fora de escopo|out of scope|cortad|cut|remov|deprecated|superseded)\b/i.test(h[1]);
        continue;
      }
      if (!inOutOfScopeSection && !CUT_LINE_RE.test(rawLine)) continue;
      for (const m of rawLine.matchAll(REQ_ID_RE)) {
        const id = m[0].toUpperCase();
        if (!cut.has(id)) cut.set(id, { id, source: rel, line: rawLine.trim().slice(0, 140) });
      }
    }
  }
  return cut;
}

function findBrokenRelativeImports(rootAbs, relSpec, content) {
  const broken = [];
  const specDir = path.dirname(path.join(rootAbs, relSpec));
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
  const importRe = /(?:from\s+['"]|require\(\s*['"])(\.\.?\/[^'"]+)['"]/g;
  for (const m of content.matchAll(importRe)) {
    const raw = m[1];
    const clean = raw.replace(/\.(?:js|mjs|cjs)$/, '');
    const candidates = [
      ...exts.map((e) => path.resolve(specDir, raw + e)),
      ...(clean !== raw ? exts.map((e) => path.resolve(specDir, clean + e)) : []),
    ];
    if (!candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())) {
      broken.push(raw);
    }
  }
  return [...new Set(broken)];
}

/**
 * OXB-G05: Audits frozen acceptance specs against cut requirements, PLAN.json references, broken imports & age.
 */
function auditAcceptanceSpecs(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot);
  const specs = walkAcceptanceSpecs(rootAbs);
  const cutReqs = extractCutRequirements(rootAbs);
  const planDoc = readJsonQuiet(path.join(rootAbs, '.oxe', 'PLAN.json'));
  const planReferenced = new Set();
  if (planDoc && Array.isArray(planDoc.acceptance_tests)) {
    for (const at of planDoc.acceptance_tests) {
      for (const f of (at && at.files) || []) {
        const p = typeof f === 'string' ? f : (f && f.path);
        if (p) planReferenced.add(String(p).replace(/\\/g, '/').replace(/^\.\//, ''));
      }
    }
  }
  const hasPlanAcceptance = Boolean(planDoc && Array.isArray(planDoc.acceptance_tests) && planDoc.acceptance_tests.length > 0);
  const maxAgeDays = Number(options.maxAgeDays) > 0 ? Number(options.maxAgeDays) : 0;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  const findings = [];

  for (const rel of specs) {
    const abs = path.join(rootAbs, rel);
    const content = readQuiet(abs);
    const searchSpace = `${rel}\n${content}`;

    // 1. Cross-check against cut/out-of-scope requirements
    for (const [id, info] of cutReqs.entries()) {
      const re = new RegExp(`(?<![A-Za-z0-9._-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9._-])`, 'i');
      if (re.test(searchSpace)) {
        findings.push({
          file: rel,
          severity: 'error',
          kind: 'cut_requirement_drift',
          ref: id,
          reason: `spec congelada referencia requisito cortado/fora de escopo "${id}" (${info.source}: ${info.line}) — revise ou aposente antes do corte de tag`,
        });
      }
    }

    // 2. Broken relative imports
    const brokenImports = findBrokenRelativeImports(rootAbs, rel, content);
    for (const imp of brokenImports) {
      findings.push({
        file: rel,
        severity: 'error',
        kind: 'broken_import',
        ref: imp,
        reason: `import relativo quebrado "${imp}" em spec congelada`,
      });
    }

    // 3. Orphan spec not declared in active PLAN.json acceptance_tests (warning when PLAN.json declares acceptance_tests)
    if (hasPlanAcceptance && !planReferenced.has(rel)) {
      findings.push({
        file: rel,
        severity: 'warning',
        kind: 'unreferenced_in_plan',
        ref: rel,
        reason: 'spec congelada não referenciada em .oxe/PLAN.json acceptance_tests — confirme se continua válida para a release',
      });
    }

    // 4. Optional staleness age check
    if (maxAgeDays > 0) {
      try {
        const ageDays = Math.floor((nowMs - fs.statSync(abs).mtimeMs) / (24 * 3600_000));
        if (ageDays > maxAgeDays) {
          findings.push({
            file: rel,
            severity: 'warning',
            kind: 'stale_spec',
            ref: `${ageDays}d`,
            reason: `spec congelada sem revisão há ${ageDays} dias (teto ${maxAgeDays}d) — exige revisão explícita antes do corte de tag`,
          });
        }
      } catch { /* ignore */ }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  return {
    ok: errors.length === 0,
    specs_scanned: specs.length,
    cut_requirements_detected: [...cutReqs.values()],
    findings,
    errors: errors.length,
    warnings: warnings.length,
  };
}

module.exports = {
  walkAcceptanceSpecs,
  extractCutRequirements,
  auditAcceptanceSpecs,
};
