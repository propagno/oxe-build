'use strict';

/**
 * OXB-128: a reproducible UI evidence package — the only evidence a sign-off of a standing UI criterion accepts.
 * `<folder>/ui-evidence.json` (schema 1):
 *   { schema: 1, sha, criteria: ["A70"], diff_threshold?: 0.01,
 *     matrix: { locale: ["pt-BR","en"], theme: ["light","dark"], os: ["windows"] },
 *     runs: [{ locale, theme, os,
 *              steps: [{ action: "click"|"fill"|"press"|"goto"|"expect", role, name, value? }],
 *              captures: [{ state, file, baseline?, diff_ratio? }],
 *              a11y: [{ state, file, violations }] }],
 *     findings?: [{ id, title, steps: [...], expected, observed, run?: { locale, theme, os } }] }
 * validate(): schema, a run for every cell of the matrix, steps with stable selectors (role + accessible name, never
 * CSS/XPath), every capture file present, the visual diff within the threshold, an a11y report for every captured
 * state with zero violations, and the sha present. freeze(): a finding with steps becomes a frozen regression test.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'ui-evidence.json';
const ACTIONS = new Set(['goto', 'click', 'fill', 'press', 'check', 'select', 'hover', 'expect']);
const CSS_LIKE = /^[#.[]|\/\/|>>|:nth|\s>\s/;

function read(folder) {
  const file = path.join(folder, FILE);
  if (!fs.existsSync(file)) throw new Error(`${folder}: sem ${FILE} — o sign-off de critério permanente de UI exige o pacote de evidência`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`${FILE}: JSON inválido (${err.message})`); }
}

function cells(matrix) {
  const dims = ['locale', 'theme', 'os'];
  let out = [{}];
  for (const d of dims) {
    const vals = Array.isArray(matrix && matrix[d]) && matrix[d].length ? matrix[d] : [null];
    out = out.flatMap((c) => vals.map((v) => ({ ...c, [d]: v })));
  }
  return out;
}
const key = (c) => `${c.locale || '*'}/${c.theme || '*'}/${c.os || '*'}`;

function checkSteps(steps, where, errors) {
  if (!Array.isArray(steps) || !steps.length) { errors.push(`${where}: roteiro sem passos`); return; }
  steps.forEach((s, i) => {
    const at = `${where}.steps[${i}]`;
    if (!s || !ACTIONS.has(s.action)) errors.push(`${at}: action inválida (${s && s.action})`);
    if (s && s.action === 'goto') { if (!s.value) errors.push(`${at}: goto exige value (url/rota)`); return; }
    if (s && s.selector) errors.push(`${at}: seletor livre não é estável — use role + name (nome acessível)`);
    if (!s || !s.role || !s.name) errors.push(`${at}: passo sem role + name (seletor estável por papel e nome acessível)`);
    else if (CSS_LIKE.test(String(s.name))) errors.push(`${at}: name parece CSS/XPath — use o nome acessível`);
  });
}

function validate(folder, options = {}) {
  const errors = [];
  let doc;
  try { doc = read(folder); } catch (err) { return { ok: false, errors: [err.message], doc: null }; }
  if (doc.schema !== 1) errors.push(`schema: esperado 1 (veio ${doc.schema})`);
  if (!doc.sha || !/^[0-9a-f]{7,40}$/i.test(String(doc.sha))) errors.push('sha: o commit avaliado é obrigatório');
  if (options.head && doc.sha && !String(options.head).startsWith(String(doc.sha)) && !String(doc.sha).startsWith(String(options.head))) errors.push(`sha ${String(doc.sha).slice(0, 10)}: o pacote avaliou outro commit (HEAD ${String(options.head).slice(0, 10)})`);
  const threshold = Number(doc.diff_threshold ?? options.diffThreshold ?? 0.01);
  const required = options.matrix || doc.matrix;
  if (!required || typeof required !== 'object') errors.push('matrix: declare locale × tema × SO');
  const runs = Array.isArray(doc.runs) ? doc.runs : [];
  if (required) {
    const have = new Set(runs.map((r) => key(r)));
    for (const c of cells(required)) if (!have.has(key(c))) errors.push(`matrix: falta a execução ${key(c)}`);
  }
  runs.forEach((r, i) => {
    const at = `runs[${i}] (${key(r)})`;
    checkSteps(r.steps, at, errors);
    const caps = Array.isArray(r.captures) ? r.captures : [];
    if (!caps.length) errors.push(`${at}: sem capturas`);
    const a11y = new Map((Array.isArray(r.a11y) ? r.a11y : []).map((a) => [a && a.state, a]));
    for (const cap of caps) {
      if (!cap || !cap.file || !fs.existsSync(path.join(folder, cap.file))) errors.push(`${at}: captura ${cap && cap.file} não existe no pacote`);
      if (cap && cap.baseline && !fs.existsSync(path.join(folder, cap.baseline))) errors.push(`${at}: baseline ${cap.baseline} não existe`);
      if (cap && cap.baseline && cap.diff_ratio == null) errors.push(`${at}: ${cap.state}: diff visual não medido contra a baseline`);
      if (cap && Number(cap.diff_ratio) > threshold) errors.push(`${at}: ${cap.state}: diff visual ${cap.diff_ratio} acima do limite ${threshold}`);
      const a = a11y.get(cap && cap.state);
      if (!a) errors.push(`${at}: ${cap && cap.state}: sem relatório de acessibilidade`);
      else {
        if (!a.file || !fs.existsSync(path.join(folder, a.file))) errors.push(`${at}: ${cap.state}: relatório de acessibilidade ${a.file} não existe`);
        if (Number(a.violations) > 0) errors.push(`${at}: ${cap.state}: ${a.violations} violação(ões) de acessibilidade`);
      }
    }
  });
  (Array.isArray(doc.findings) ? doc.findings : []).forEach((f, i) => {
    if (!f || !f.id) errors.push(`findings[${i}]: sem id`);
    else if (f.steps) checkSteps(f.steps, `findings[${i}] (${f.id})`, errors);
  });
  return { ok: errors.length === 0, errors, doc, cells: required ? cells(required).length : 0 };
}

const lit = (s) => JSON.stringify(String(s));
function stepLine(s) {
  if (s.action === 'goto') return `  await page.goto(${lit(s.value)});`;
  const loc = `page.getByRole(${lit(s.role)}, { name: ${lit(s.name)} })`;
  if (s.action === 'fill') return `  await ${loc}.fill(${lit(s.value || '')});`;
  if (s.action === 'press') return `  await ${loc}.press(${lit(s.value || 'Enter')});`;
  if (s.action === 'check') return `  await ${loc}.check();`;
  if (s.action === 'select') return `  await ${loc}.selectOption(${lit(s.value || '')});`;
  if (s.action === 'hover') return `  await ${loc}.hover();`;
  if (s.action === 'expect') return s.value ? `  await expect(${loc}).toHaveText(${lit(s.value)});` : `  await expect(${loc}).toBeVisible();`;
  return `  await ${loc}.click();`;
}

/** A finding with steps → a Playwright regression test (role/name selectors); its last expect is the red on the old tree. */
function renderTest(finding, doc) {
  const run = finding.run || (doc.runs && doc.runs[0]) || {};
  const lines = [
    "// Frozen by oxe-cc runtime signal --freeze (OXB-128). Do not edit: it reproduces the finding; it must fail on the tree that had it.",
    "const { test, expect } = require('@playwright/test');",
    '',
    `test(${lit(`${finding.id}: ${finding.title || ''}`.trim())}, async ({ page }) => {`,
    run.locale ? `  // locale: ${run.locale} · theme: ${run.theme || '-'} · os: ${run.os || '-'} · avaliado em ${String(doc.sha || '').slice(0, 10)}` : null,
    ...(finding.steps || []).map(stepLine),
    finding.expected && !(finding.steps || []).some((s) => s.action === 'expect') ? `  // esperado: ${finding.expected}` : null,
    '});',
    '',
  ];
  return lines.filter((l) => l != null).join('\n');
}

function freeze(projectRoot, folder, options = {}) {
  const v = validate(folder, options);
  const doc = v.doc;
  if (!doc) throw new Error(v.errors[0]);
  const dir = options.testDir || 'tests/ui-regression';
  const out = [];
  for (const f of (doc.findings || []).filter((x) => x && x.id && Array.isArray(x.steps) && x.steps.length)) {
    const rel = `${dir}/${String(f.id).replace(/[^A-Za-z0-9_-]+/g, '-')}.spec.js`;
    const abs = path.join(projectRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, renderTest(f, doc));
    out.push({ finding: f.id, file: rel, criteria: doc.criteria || [] });
  }
  return { frozen: out, skipped: (doc.findings || []).filter((x) => !x || !Array.isArray(x.steps) || !x.steps.length).map((x) => x && x.id) };
}

/** Standing criteria that are UI (opt-in): `ui_evidence.criteria` when declared; with `ui_evidence.standing: true`, the standing ones whose text is about the interface. */
const UI_TEXT_RE = /\b(interface|tela|UI|visual|bot[aã]o|layout|componente|acessibilidade|a11y|screen|button)\b/i;
function uiStandingCriteria(config, standing, specText) {
  if (config && config.ui_evidence && Array.isArray(config.ui_evidence.criteria)) return config.ui_evidence.criteria.map((c) => String(c).toUpperCase());
  if (!(config && config.ui_evidence && config.ui_evidence.standing === true)) return [];
  const rows = new Map();
  for (const m of String(specText || '').matchAll(/^\|\s*(A\d+)\s*\|\s*([^|]*)\|/gm)) rows.set(m[1], m[2]);
  return (standing || []).filter((c) => UI_TEXT_RE.test(rows.get(c) || ''));
}

module.exports = { FILE, validate, freeze, renderTest, cells, uiStandingCriteria };
