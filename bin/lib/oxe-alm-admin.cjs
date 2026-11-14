'use strict';

/**
 * 1.21.2 — the ALM commands that removed the last reasons for ad-hoc scripts (coordination, 14/11: "every Jira write
 * goes through oxe-cc alm, to stress oxe-build"):
 *   intake   — a work item that does not come from a PRD (a study, a user request, a bug found in HML): created in the
 *              first column with the skeleton of its type, recorded in the ledger, confirmed by GET; writer only.
 *   doctor   — read-only: credentials, project, every stage of alm.states is a real status of the project, and the
 *              board's columns are in the stages' order.
 *   version  — `version ensure 1.5.3`: the fix version exists (created when missing); writer only.
 *   usage    — every alm command appends {at, cmd, ok, ms, error} to .oxe/alm/usage.ndjson (the stress report).
 */

const fs = require('fs');
const path = require('path');

const KINDS = ['story', 'task', 'bug', 'epic'];

/** Appends one usage record (never the values of flags that could carry secrets). */
function logUsage(projectRoot, record) {
  try {
    const dir = path.join(projectRoot, '.oxe', 'alm');
    fs.mkdirSync(dir, { recursive: true });
    const safe = { at: new Date().toISOString(), cmd: record.cmd, ok: record.ok !== false, ms: record.ms, ...(record.error ? { error: String(record.error).slice(0, 300) } : {}), ...(record.keys ? { keys: record.keys } : {}), ...(record.dry_run ? { dry_run: true } : {}) };
    fs.appendFileSync(path.join(dir, 'usage.ndjson'), `${JSON.stringify(safe)}\n`, 'utf8');
  } catch { /* the log never fails a command */ }
}

/** Summary of the usage log: per command, runs, failures, median ms. */
function usageReport(projectRoot) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(projectRoot, '.oxe', 'alm', 'usage.ndjson'), 'utf8'); } catch { return { commands: [] }; }
  const by = new Map();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    let r = null;
    try { r = JSON.parse(line); } catch { r = null; }
    if (!r || !r.cmd) continue;
    const e = by.get(r.cmd) || { cmd: r.cmd, runs: 0, failed: 0, ms: [], last_error: null };
    e.runs += 1;
    if (r.ok === false) { e.failed += 1; e.last_error = r.error || null; }
    if (Number.isFinite(r.ms)) e.ms.push(r.ms);
    by.set(r.cmd, e);
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  return { commands: [...by.values()].map((e) => ({ cmd: e.cmd, runs: e.runs, failed: e.failed, median_ms: med(e.ms), last_error: e.last_error })).sort((a, b) => b.runs - a.runs) };
}

/**
 * A new item outside the PRD/PLAN. Idempotent by its ref label (ref-<program>-<ref>) and the ledger.
 * @param {{ request: Function, site: string }} rest
 */
async function intake(rest, cfg, input, ctx) {
  const kind = String(input.type || '').toLowerCase();
  if (!KINDS.includes(kind)) throw new Error(`--type ${input.type || '(vazio)'}: use story | task | bug | epic`);
  const summary = String(input.summary || '').trim();
  if (summary.length < 6) throw new Error('informe o título do item (--summary "…")');
  const alm = require('./oxe-alm.cjs');
  const refine = require('./oxe-alm-refine.cjs');
  const ref = String(input.ref || `IN-${Date.now().toString(36).toUpperCase()}`);
  const known = alm.links(ctx.programDir);
  if (known.has(ref)) return { ref, key: known.get(ref).key, reused: true };
  const label = cfg.ref_label === 'plain' ? `ref-${ref}` : alm.refLabel(ref, cfg);
  const labels = [...new Set([...cfg.labels, label, ...(kind === 'bug' ? [cfg.p.bug_label || 'bug'] : []), ...String(input.labels || '').split(',').map((s) => s.trim()).filter(Boolean)])];
  // the description: the given file (a study, a report) or the skeleton of the type, every gap "A confirmar"
  let body;
  if (input.fromText) body = String(input.fromText);
  else {
    const skel = refine.skeleton({ key: ref, url: input.from || '', kind, type: kind, status: null, summary, description: '', description_hash: '', labels, parent: input.epic ? { key: input.epic } : null, links: [], comments: [], fix_versions: input.version ? [input.version] : [], dev: null, code_refs: [], code_refs_found: [], design_refs: [], collected_at: new Date().toISOString() });
    body = refine.descriptionBody(skel);
  }
  if (input.from && !input.fromText) body += `\n\nOrigem: ${input.from}`;
  const types = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Task', ...(cfg.p.types || {}) };
  const fields = {
    project: { key: cfg.p.project },
    issuetype: { name: types[kind] },
    summary: summary.slice(0, 250),
    description: refine.mdToAdf(body),
    labels,
    ...(input.epic && kind !== 'epic' ? { parent: { key: String(input.epic) } } : {}),
    ...(input.version ? { fixVersions: [{ name: String(input.version) }] } : {}),
  };
  if (input.dryRun) {
    // the file is checked offline too: the sections of the type, the CA format, the refine lint (a reader session
    // validates the card before handing it to the writer)
    const lint = input.fromText ? refine.lintSpec(input.fromText, kind) : null;
    return { ref, planned: { type: types[kind], summary, labels, epic: input.epic || null, version: input.version || null, description_lines: body.split('\n').length }, ...(lint ? { lint: { ok: lint.ok, errors: lint.errors, warnings: lint.warnings, criteria: lint.criteria.length, needs_info: lint.needs_info } } : {}), offline: Boolean(input.offline) };
  }
  const found = await rest.request('GET', `${rest.site}/rest/api/3/search/jql?jql=${encodeURIComponent(`project = "${cfg.p.project}" AND labels = "${label}"`)}&fields=summary&maxResults=1`);
  if (found && found.issues && found.issues[0]) {
    alm.addLink(ctx.programDir, { ref, key: found.issues[0].key, kind, provider: 'jira', intake: true });
    return { ref, key: found.issues[0].key, reused: true };
  }
  const created = await rest.request('POST', `${rest.site}/rest/api/3/issue`, { fields });
  alm.addLink(ctx.programDir, { ref, key: created.key, kind, provider: 'jira', intake: true });
  const back = await rest.request('GET', `${rest.site}/rest/api/3/issue/${created.key}?fields=status,fixVersions,labels`);
  const versions = ((back && back.fields && back.fields.fixVersions) || []).map((v) => v.name);
  let versionFix = null;
  if (input.version && !versions.includes(String(input.version))) {
    try { versionFix = await alm.provider(cfg, ctx.options).setFixVersion(created.key, String(input.version)); } catch (err) { versionFix = { ok: false, error: err.message }; }
  }
  return { ref, key: created.key, created: true, status: back && back.fields && back.fields.status ? back.fields.status.name : null, confirmed: Boolean(back), ...(versionFix ? { version_set: versionFix.ok !== false } : {}) };
}

/** `version ensure <name>`: the fix version exists in the project (created when missing). */
async function versionEnsure(rest, cfg, name, input = {}) {
  if (!name) throw new Error('uso: oxe-cc alm version ensure <nome> (ex.: 1.5.3)');
  const vs = await rest.request('GET', `${rest.site}/rest/api/3/project/${cfg.p.project}/versions`);
  const hit = (vs || []).find((v) => v.name === name);
  if (hit) return { version: name, exists: true, released: Boolean(hit.released) };
  if (input.dryRun) return { version: name, exists: false, planned: 'criar' };
  const project = await rest.request('GET', `${rest.site}/rest/api/3/project/${cfg.p.project}`);
  const created = await rest.request('POST', `${rest.site}/rest/api/3/version`, { name, projectId: Number(project.id), ...(input.releaseDate ? { releaseDate: input.releaseDate } : {}) });
  return { version: name, created: true, id: created && created.id };
}

/**
 * Read-only check of the board against alm.states: credentials (who, never the token), the project, each mapped
 * stage a real status of the project, and the board's columns in the stages' order.
 */
async function doctor(rest, cfg) {
  const alm = require('./oxe-alm.cjs');
  const out = { ok: true, checks: [] };
  const check = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };
  let me = null;
  try { me = await rest.request('GET', `${rest.site}/rest/api/3/myself`); check('credenciais', true, `autenticado (${me && me.accountType ? me.accountType : 'conta'})`); } catch (err) { check('credenciais', false, err.message); return out; }
  let project = null;
  try { project = await rest.request('GET', `${rest.site}/rest/api/3/project/${cfg.p.project}`); check('projeto', true, `${cfg.p.project} (${project.name || ''})`); } catch (err) { check('projeto', false, err.message); return out; }
  const st = await rest.request('GET', `${rest.site}/rest/api/3/project/${cfg.p.project}/statuses`);
  const statusNames = new Map();
  for (const t of st || []) for (const s of t.statuses || []) statusNames.set(String(s.name).toLowerCase(), s);
  const mapped = alm.STAGES.filter((s) => cfg.states[s]);
  const missing = mapped.filter((s) => !statusNames.has(String(cfg.states[s]).toLowerCase()));
  check('estados', !missing.length, missing.length ? `não existem no projeto: ${missing.map((s) => `${s} → "${cfg.states[s]}"`).join(', ')}` : `${mapped.length} etapa(s) mapeada(s), todas existem`);
  const notTracked = (cfg.track || []).filter((s) => !cfg.states[s]);
  check('track', !notTracked.length, notTracked.length ? `etapas em alm.track sem estado mapeado: ${notTracked.join(', ')}` : `o OXE move ${cfg.track.join(', ') || 'nada'}`);
  try {
    const boards = await rest.request('GET', `${rest.site}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(cfg.p.project)}`);
    const board = boards && boards.values && boards.values[0];
    if (!board) check('quadro', false, 'nenhum quadro do projeto');
    else {
      const conf = await rest.request('GET', `${rest.site}/rest/agile/1.0/board/${board.id}/configuration`);
      const cols = ((conf && conf.columnConfig && conf.columnConfig.columns) || []).map((c) => ({ name: c.name, statuses: (c.statuses || []).map((s) => String(s.id)) }));
      const idOf = (name) => { const s = statusNames.get(String(name).toLowerCase()); return s ? String(s.id) : null; };
      const colIndex = (stage) => cols.findIndex((c) => c.statuses.includes(idOf(cfg.states[stage])));
      const placed = mapped.map((s) => ({ s, i: colIndex(s) }));
      const off = placed.filter((p) => p.i < 0).map((p) => p.s);
      const order = placed.filter((p) => p.i >= 0);
      const outOfOrder = order.filter((p, k) => k > 0 && p.i < order[k - 1].i).map((p) => p.s);
      check('colunas', !off.length && !outOfOrder.length, off.length ? `estados fora de qualquer coluna do quadro "${board.name}": ${off.join(', ')}` : outOfOrder.length ? `colunas fora da ordem das etapas: ${outOfOrder.join(', ')}` : `quadro "${board.name}": ${cols.length} coluna(s), na ordem das etapas`);
    }
  } catch (err) { check('quadro', false, `não deu para ler o quadro (${err.message})`); }
  return out;
}

module.exports = { logUsage, usageReport, intake, versionEnsure, doctor, KINDS };
