'use strict';

/**
 * 1.21 · Criterion coverage by the frozen acceptance test (OXB-030).
 *
 * In the `ledger-api` reference project, criterion A10 read "erros 400/401/404/405/413", but its frozen test never
 * sent an oversized body over HTTP. The executor's server destroyed the request instead of answering 413, every
 * check was green, the phase closed — and the independent oracle caught it. A criterion's verifiable terms must
 * appear in the test that proves it.
 *
 * Verifiable terms: 3-digit status-like numbers (100–599), `code spans` and "quoted" literals of the criterion text.
 */

const fs = require('fs');
const path = require('path');

function verifiableTerms(criterionText) {
  const text = String(criterionText || '');
  const terms = new Set();
  for (const m of text.matchAll(/(?<![\w.])([1-5]\d\d)(?![\w.])/g)) terms.add(m[1]);
  for (const m of text.matchAll(/`([^`]{2,60})`/g)) terms.add(m[1].trim());
  for (const m of text.matchAll(/"([^"]{2,60})"/g)) terms.add(m[1].trim());
  return [...terms].filter(Boolean);
}

/**
 * @param {{ spec: { criteria?: Array<{ id: string, text?: string, criterion?: string, description?: string }> } | null,
 *           plan: { acceptanceTests?: Array<{ criterion?: string|null, files: string[] }> }, projectRoot: string }} input
 * @returns {string[]} one message per criterion with uncovered terms
 */
function uncoveredCriterionTerms(input) {
  const out = [];
  const criteria = (input.spec && Array.isArray(input.spec.criteria) ? input.spec.criteria : []);
  const byId = new Map(criteria.map((c) => [c.id, c]));
  for (const entry of (input.plan && input.plan.acceptanceTests) || []) {
    const criterion = entry.criterion ? byId.get(entry.criterion) : null;
    if (!criterion) continue;
    const terms = verifiableTerms(criterion.text || criterion.criterion || criterion.description || '');
    if (!terms.length) continue;
    let content = '';
    for (const file of entry.files || []) {
      const rel = typeof file === 'string' ? file : file && file.path;
      try {
        content += fs.readFileSync(path.resolve(input.projectRoot, rel), 'utf8');
      } catch {
        // a missing test file is reported by the acceptance checks
      }
    }
    if (!content) continue;
    const missing = terms.filter((term) => !content.includes(term));
    if (missing.length) {
      out.push(`${entry.criterion}: o teste de aceite não exercita ${missing.map((t) => `"${t}"`).join(', ')} citado(s) no critério — cubra no teste congelado ou tire do critério (OXB-030)`);
    }
  }
  return out;
}

module.exports = { verifiableTerms, uncoveredCriterionTerms };
