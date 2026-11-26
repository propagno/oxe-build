'use strict';

/**
 * OXB-137: fixed severity for findings, read from a table — never chosen by whoever reports. The package ships
 * `oxe/templates/finding-rules.json`; a project's `.oxe/finding-rules.json` adds rules and may RAISE a packaged rule's
 * severity, never lower it. A finding names the rule that fired (`runtime feedback --rule <id>`); its severity comes
 * from the table; a finding with no rule is an observation (`unrated`, no weight). The close blocks on the configured
 * severities (`close.block_on`, default ["critical", "high@standing"]).
 */

const fs = require('fs');
const path = require('path');

const ORDER = ['low', 'medium', 'high', 'critical'];
const rank = (s) => ORDER.indexOf(String(s || '').toLowerCase());

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function matchesCriterion(a, b) {
  const x = String(a || '').trim().toUpperCase();
  const y = String(b || '').trim().toUpperCase();
  return Boolean(x && y && (x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`)));
}

function loadRules(projectRoot) {
  const base = readJson(path.join(__dirname, '..', '..', 'oxe', 'templates', 'finding-rules.json')) || { rules: [] };
  const local = readJson(path.join(projectRoot, '.oxe', 'finding-rules.json')) || { rules: [] };
  const byId = new Map((base.rules || []).filter((r) => r && r.id && rank(r.severity) >= 0).map((r) => [r.id, { ...r, severity: String(r.severity).toLowerCase(), source: 'package' }]));
  const problems = [];
  for (const r of local.rules || []) {
    if (!r || !r.id || rank(r.severity) < 0) { problems.push(`regra inválida em .oxe/finding-rules.json: ${JSON.stringify(r)}`); continue; }
    const sev = String(r.severity).toLowerCase();
    const prev = byId.get(r.id);
    if (prev && rank(sev) < rank(prev.severity)) { problems.push(`${r.id}: o projeto não pode baixar a severidade (${prev.severity} → ${sev}); mantida ${prev.severity}`); continue; }
    byId.set(r.id, { ...(prev || {}), ...r, severity: sev, source: prev ? 'raised' : 'project' });
  }
  return { rules: byId, problems };
}

/**
 * The severity of a finding. @returns {{ rule: string|null, severity: string, rated: boolean }}
 * A given severity that differs from the rule's is refused (it comes from the table).
 */
function rate(projectRoot, input = {}) {
  const { rules } = loadRules(projectRoot);
  if (!input.rule) {
    if (input.severity) throw new Error('severidade sem regra: informe --rule <id> (a severidade vem da tabela de regras de achado)');
    return { rule: null, severity: 'unrated', rated: false };
  }
  const r = rules.get(String(input.rule));
  if (!r) throw new Error(`regra de achado desconhecida: ${input.rule} (veja oxe/templates/finding-rules.json e .oxe/finding-rules.json)`);
  if (input.severity && String(input.severity).toLowerCase() !== r.severity) throw new Error(`a severidade de ${r.id} é ${r.severity} (tabela); não é escolhida por quem relata`);
  return { rule: r.id, severity: r.severity, rated: true };
}

/** Open CRs that block the close under `close.block_on` (e.g. "critical", "high@standing"). */
function blockingFindings(crs, blockOn, standing) {
  const specs = (Array.isArray(blockOn) ? blockOn : ['critical', 'high@standing']).map((x) => {
    const [sev, scope] = String(x || '').split('@');
    return { sev: sev.trim().toLowerCase(), scope: scope ? scope.trim().toLowerCase() : null };
  });
  const std = (standing || []).map((c) => String(c).trim()).filter(Boolean);
  return (crs || []).filter((cr) => {
    if (!cr || cr.status !== 'open') return false;
    const crRank = rank(cr.severity);
    if (crRank < 0) return false;
    return specs.some((s) => {
      const minRank = rank(s.sev);
      if (minRank < 0 || crRank < minRank) return false;
      if (s.scope === 'standing') return (cr.criteria || []).some((c) => std.some((sc) => matchesCriterion(c, sc)));
      return !s.scope;
    });
  });
}

function bySeverity(crs) {
  const out = { critical: [], high: [], medium: [], low: [], unrated: [] };
  for (const cr of crs || []) {
    if (!cr) continue;
    const sev = String(cr.severity || '').toLowerCase();
    (out[sev] || out.unrated).push(cr);
  }
  return out;
}

module.exports = { ORDER, loadRules, rate, blockingFindings, bySeverity };
