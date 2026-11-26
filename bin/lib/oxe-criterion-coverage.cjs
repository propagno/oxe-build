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

// ALM item keys (OXE-104, CODE-8, AB#123): every criterion carries one since the ALM integration; they are references,
// not behavior — "(OXE-104)" made 104 look like a status code the test had to exercise.
const ITEM_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b|\bAB#\d+\b/g;

const NON_STATUS_UNIT_RE = /^\s*(?:ms|s|min|h|mb|gb|kb|tb|px|pt|rem|em|vh|vw|fps|hz|dpi|itens|items|linhas|lines|arquivos|files|caracteres|chars|bytes|palavras|words|segundos|minutos|dias)\b/i;

const CODE_LIKE_SPAN_RE = /[/.\\_()[\]{}:=$<>@]|--|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/;

function isPlausibleCodeSpan(span) {
  const s = String(span || '').trim();
  if (!s) return false;
  if (!/\s/.test(s)) return true;
  return CODE_LIKE_SPAN_RE.test(s);
}

function verifiableTerms(criterionText) {
  const text = String(criterionText || '');
  const terms = new Set();
  const scrubbed = text.replace(ITEM_KEY_RE, ' ');
  for (const m of scrubbed.matchAll(/(?<![#\w.])([1-5]\d\d)(?![\w.%])/g)) {
    const after = scrubbed.slice(m.index + m[0].length);
    if (NON_STATUS_UNIT_RE.test(after)) continue;
    terms.add(m[1]);
  }
  for (const m of text.matchAll(/`([^`]{2,60})`/g)) {
    const span = m[1].trim();
    if (isPlausibleCodeSpan(span)) terms.add(span);
  }
  for (const m of text.matchAll(/"([^"]{2,60})"/g)) terms.add(m[1].trim());
  return [...terms].filter((t) => t && !new RegExp(`^(?:${ITEM_KEY_RE.source})$`).test(t));
}

function coveredInTestContent(content, term) {
  if (content.includes(term)) return true;
  const lower = term.toLowerCase();
  for (const m of content.matchAll(/\/((?:\\.|[^/\\\r\n])+)\/([dgimsuvy]*)/g)) {
    if (m[2].includes('i') && m[1].replace(/\\(.)/g, '$1').toLowerCase().includes(lower)) return true;
  }
  for (const m of content.matchAll(/new\s+RegExp\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(['"`])([^'"`]*)\3\s*\)/g)) {
    if (m[4].includes('i') && m[2].replace(/\\(.)/g, '$1').toLowerCase().includes(lower)) return true;
  }
  return false;
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
    const missing = terms.filter((term) => !coveredInTestContent(content, term));
    if (missing.length) {
      out.push(`${entry.criterion}: o teste de aceite não exercita ${missing.map((t) => `"${t}"`).join(', ')} citado(s) no critério — cubra no teste congelado ou tire do critério (OXB-030)`);
    }
  }
  return out;
}

module.exports = { verifiableTerms, uncoveredCriterionTerms };
