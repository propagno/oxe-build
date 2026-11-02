'use strict';

/**
 * 1.21 · Repository rules for the executor (OXB-020). In the OxeVoice F1, the executor wrote color literals, raw
 * <button>s and direct fs calls that the repo's own governance tests forbid; CI caught them after the run was paid.
 * This collects what the repository already enforces, so it goes into every node prompt:
 *   - `.oxe/config.json` policy_rules (the gatekeeper's own regexes);
 *   - directive bullets of AGENTS.md / CLAUDE.md at the repo root (never/always/must/nunca/sempre/...);
 *   - test titles of the governance suite (design-lint, allowlists, catalogs, coverage), plus `config.repo_rules.tests`.
 * `config.repo_rules.disabled: true` turns it off; `config.repo_rules.sources` adds other markdown files.
 */

const fs = require('fs');
const path = require('path');
const { findGovernanceTests } = require('./oxe-phase-gates.cjs');

const DIRECTIVE_RE = /\b(never|always|must|must not|do not|don't|only|forbidden|required|nunca|sempre|não|proibid[oa]s?|obrigatóri[oa]s?|só|somente|apenas|jamais)\b/i;
const TEST_TITLE_RE = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])+)\1/g;
const MAX_PER_DOC = 25;
const MAX_PER_TEST_FILE = 15;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Bullet or numbered lines that state a rule (a directive keyword), outside code fences. */
function directiveLines(markdown) {
  const out = [];
  let fenced = false;
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (!bullet) continue;
    const text = bullet[1].replace(/\*\*/g, '').trim();
    if (text.length < 12 || !DIRECTIVE_RE.test(text)) continue;
    out.push(text.length > 240 ? `${text.slice(0, 237)}…` : text);
    if (out.length >= MAX_PER_DOC) break;
  }
  return out;
}

/** `it('...')` / `test('...')` titles of a test file, in order, without duplicates. */
function testTitles(source) {
  const titles = [];
  const seen = new Set();
  TEST_TITLE_RE.lastIndex = 0;
  let m;
  while ((m = TEST_TITLE_RE.exec(String(source || ''))) && titles.length < MAX_PER_TEST_FILE) {
    const title = m[2].replace(/\\(['"`])/g, '$1').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

function policyRuleText(rule) {
  if (!rule || !rule.id) return null;
  const scope = rule.paths ? ` (em ${rule.paths})` : '';
  return `${rule.message || `proibido: /${rule.forbid}/`}${scope} [${rule.id}]`;
}

/**
 * @param {string} projectRoot
 * @param {{ config?: object }} [options]
 * @returns {{ source: string, text: string }[]}
 */
function collectRepoRules(projectRoot, options = {}) {
  const config = options.config || {};
  const settings = config.repo_rules && typeof config.repo_rules === 'object' ? config.repo_rules : {};
  if (settings.disabled === true) return [];
  const rules = [];

  for (const rule of Array.isArray(config.policy_rules) ? config.policy_rules : []) {
    const text = policyRuleText(rule);
    if (text) rules.push({ source: '.oxe/config.json', text });
  }

  const docs = ['AGENTS.md', 'CLAUDE.md', ...(Array.isArray(settings.sources) ? settings.sources : [])];
  for (const rel of [...new Set(docs)]) {
    const text = readText(path.join(projectRoot, rel));
    if (!text) continue;
    for (const line of directiveLines(text)) rules.push({ source: rel, text: line });
  }

  // Repo-wide suites sit near the top of the test tree (tests/design-lint, tests/integration/fs-allowlist); deeper
  // matches (tests/unit/<feature>-lint) are more often a feature's own tests, so they come last within the budget.
  const depth = (rel) => rel.split('/').length;
  const found = findGovernanceTests(projectRoot).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const tests = [...new Set([...(Array.isArray(settings.tests) ? settings.tests : []), ...found])];
  for (const rel of tests) {
    const text = readText(path.join(projectRoot, rel));
    if (!text) continue;
    for (const title of testTitles(text)) rules.push({ source: rel, text: title });
  }
  return rules;
}

module.exports = { collectRepoRules, directiveLines, testTitles };
