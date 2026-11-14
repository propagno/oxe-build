'use strict';

/**
 * 1.21.2 — ALM (Jira / Azure DevOps) end to end: the PRD's user stories and the plan's tasks become work items, and
 * the OXE lifecycle moves them — task started → in progress, PR opened → in review, merge train → queued / back to
 * review with the reason, merged → merged, deploy → released (and the Jira version released), a defect after the
 * deploy → a bug item linked to its origin.
 *
 * Config (.oxe/config.json):
 *   "alm": {
 *     "provider": "jira" | "azure-devops" | "none",
 *     "transport": "rest" | "mcp",   // mcp: no token; writes go to alm-mcp-queue.json for the agent's MCP tools
 *     "dry_run": false,              // show, never write (also --dry-run on every command)
 *     "auto": true,                  // sync at the lifecycle points (start-task, execute, promote, deploy, close)
 *     "program": "152code",          // idempotency label ref-<program>-<ref> (default: the project folder name)
 *     "epic": "OXE-4",               // parent of the stories (optional; per phase: { "F1": "OXE-4" })
 *     "labels": ["area-oxecode"],    // added to the task's own labels, never replacing them
 *     "fix_version": "1.5.2",        // or per phase: { "F1": "1.5.2", "F3": "1.5.3" }
 *     "release_version": false,      // release the version at the deploy (off when a tag pipeline does it)
 *     "adopt_prefixes": ["CODE", "VIS", "BRD"],  // a task carrying CODE-8 adopts the item labeled ref-CODE-8
 *     "states": { "in_progress": "Em andamento", "in_review": "Em revisão", "queued": "Na fila",
 *                 "merged": "Na main", "released": "Lançado" },        // by NAME; the transition id is resolved live
 *     "track": ["in_progress", "in_review", "merged", "released"],   // stages the OXE moves (default: all)
 *     "jira":  { "project": "OXE", "site_env": "JIRA_SITE", "email_env": "JIRA_EMAIL", "token_env": "JIRA_API_TOKEN",
 *                "types": { "story": "Story", "task": "Task", "bug": "Task" }, "bug_label": "bug" },
 *     "azure_devops": { "project": "…", "org_env": "AZURE_DEVOPS_ORG", "token_env": "AZURE_DEVOPS_EXT_PAT",
 *                "types": { "story": "User Story", "task": "Task", "bug": "Bug" }, "area_path": "…", "iteration_path": "…" }
 *   }
 * Credentials come ONLY from the environment variables named there; their values are never printed or written.
 *
 * State: .oxe/program/alm-links.ndjson (append-only: OXE id → key/url), .oxe/program/alm-state.json (the event cursor,
 * the stage each item reached, and the failed writes waiting for a retry). An ALM failure never fails the OXE
 * command that triggered it: it is recorded and retried on the next sync.
 */

const fs = require('fs');
const path = require('path');

/**
 * The canonical stages of a card, in order. Each project maps them to its own board's column names (alm.states); a
 * stage with no column is skipped. The OXE moves only the stages in alm.track (the ones it owns: grill → grooming,
 * refine → refinement / ready, task start → in_progress); a repository workflow may own the rest.
 */
const STAGES = ['intake', 'grooming', 'refinement', 'ready', 'in_progress', 'review', 'verified', 'queued', 'integrated', 'staging', 'accepted', 'released'];
/** The names of 1.21.2 before the 12 stages, still accepted in states / track / move. */
const STAGE_ALIASES = { todo: 'intake', in_review: 'review', merged: 'integrated' };
const canonStage = (s) => STAGE_ALIASES[s] || s;
/** Who moves each stage by default, and what proves a card may enter it (documentation and metrics). */
const STAGE_INFO = {
  intake: { owner: 'human', proof: null },
  grooming: { owner: 'oxe', proof: 'grill / perguntas do refine' },
  refinement: { owner: 'oxe', proof: 'alm refine em curso' },
  ready: { owner: 'oxe', proof: 'spec-v1 + lint OK + sem needs-info' },
  in_progress: { owner: 'oxe', proof: 'tarefa iniciada (com ready_gate: spec-v1)' },
  review: { owner: 'ci', proof: 'PR aberto' },
  verified: { owner: 'ci', proof: 'pr:ready (CI verde)' },
  queued: { owner: 'ci', proof: 'no trem de merge' },
  integrated: { owner: 'ci', proof: 'merge na main' },
  staging: { owner: 'ci', proof: 'branch release/X.Y.Z ou stage homologacao' },
  accepted: { owner: 'human', proof: 'relatório de homologação' },
  released: { owner: 'ci', proof: 'release verify / deploy' },
};
const DEFAULT_STATES = {
  jira: { intake: 'To Do', in_progress: 'In Progress', review: 'In Review', integrated: 'Done', released: 'Done' },
  'azure-devops': { intake: 'New', in_progress: 'Active', review: 'Resolved', integrated: 'Resolved', released: 'Closed' },
};
const canonStates = (st) => Object.fromEntries(Object.entries(st || {}).map(([k, v]) => [canonStage(k), v]));

// ── config ───────────────────────────────────────────────────────────────────────────────────────────────────────

function almConfig(config, options = {}) {
  const a = config && config.alm;
  if (!a || typeof a !== 'object') return null;
  const provider = String(a.provider || 'none').toLowerCase().replace('_', '-');
  if (provider === 'none' || provider === 'false') return null;
  if (!['jira', 'azure-devops'].includes(provider)) throw new Error(`alm.provider "${a.provider}" desconhecido (jira | azure-devops | none)`);
  const p = provider === 'jira' ? (a.jira || {}) : (a.azure_devops || a['azure-devops'] || {});
  const transport = String(a.transport || 'rest').toLowerCase();
  if (!['rest', 'mcp'].includes(transport)) throw new Error(`alm.transport "${a.transport}" desconhecido (rest | mcp)`);
  return {
    provider,
    // rest: the oxe-cc talks to the API (token in the environment). mcp: the oxe-cc decides WHAT to do and queues it;
    // the agent runs the queue with the session's MCP tools (the user's own login) and reports back (alm ack).
    transport,
    dry_run: a.dry_run === true,
    // OXB-G13: write only with an explicit --apply; without it every writing command is a simulation
    require_apply: a.require_apply === true,
    // the intake label: ref-<program>-<ref> (default; push refs like F2-T5 repeat across programs) or, with "plain",
    // ref-<ref> for intake ids that are unique by themselves (ref-TOKENS-1-CAMADA, the board convention)
    ref_label: a.ref_label === "plain" ? "plain" : "program",
    auto: a.auto !== false,
    // The program name in the idempotency label (ref-<program>-<ref>): refs like F2-T5 repeat across programs.
    program: String(a.program || options.defaultProgram || 'oxe').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'oxe',
    epic: a.epic || null,
    labels: Array.isArray(a.labels) ? a.labels.map(String) : [],
    // one version, or one per phase ({ "F1": "1.5.2", "F3": "1.5.3" }) like the epic
    fix_version: a.fix_version && typeof a.fix_version === 'object' ? a.fix_version : (a.fix_version ? String(a.fix_version) : null),
    // old codes a task may carry (refs: ["CODE-8"] or "CODE-8" in its text): an item labeled ref-CODE-8 is adopted
    adopt_prefixes: Array.isArray(a.adopt_prefixes) ? a.adopt_prefixes.map(String) : [],
    // Jira's label search can take MINUTES to see a new item: with ledger_guard, a missing local record refuses any
    // create until `alm push --rebuild-ledger` rebuilt it from the search (no creates in that mode).
    ledger_guard: a.ledger_guard === true,
    search_settle_ms: Number.isFinite(Number(a.search_settle_ms)) && Number(a.search_settle_ms) >= 0 ? Number(a.search_settle_ms) : (a.ledger_guard === true ? 60_000 : 5000),
    release_version: a.release_version === true,
    // One writer per program: with alm.writer set, only the session that exports OXE_ALM_WRITER=<that name> creates
    // or moves items; the others read and comment (two sessions creating the same batch duplicated 19 items).
    writer: a.writer ? String(a.writer) : null,
    // where the stories come from: "prd" (new project: the push creates them) or "alm" (the cards already exist: the
    // push only links a PRD story to the card its row names, and never creates a story or an epic)
    stories_source: a.stories_source === 'alm' ? 'alm' : 'prd',
    // Definition of Ready: an item goes to in_progress only with the refined-spec label (alm refine → spec-v1)
    ready_gate: a.ready_gate === true ? 'spec-v1' : (typeof a.ready_gate === 'string' && a.ready_gate ? a.ready_gate : null),
    // The stages the OXE moves. A repository that already moves PR / train / tag (e.g. a GitHub Action) keeps only
    // what it does not cover: "track": ["in_progress"].
    track: Array.isArray(a.track) ? a.track.map((s) => canonStage(String(s))).filter((s) => STAGES.includes(s)) : STAGES.slice(),
    states: { ...DEFAULT_STATES[provider], ...canonStates(a.states) },
    // optional WIP limits per stage (warning only, in alm metrics): { "in_progress": 5 }
    wip: a.wip && typeof a.wip === 'object' ? canonStates(a.wip) : {},
    p,
  };
}

/** Missing settings / environment variables (names only). */
/** Is this process the program's ALM writer? (no alm.writer → everyone writes, as before) */
function isWriter(cfg, env = process.env) {
  return !cfg || !cfg.writer || String(env.OXE_ALM_WRITER || '') === cfg.writer;
}

function writerError(cfg) {
  return Object.assign(new Error(`ALM só leitura nesta sessão: o escritor do programa é "${cfg.writer}" (alm.writer). Daqui só se lê e comenta (oxe-cc alm comment); para escrever, rode na sessão escritora (OXE_ALM_WRITER=${cfg.writer})`), { readOnly: true });
}

/**
 * A local lock while a session writes (push/sync/defect): a second writer on the same machine waits for nothing and
 * is refused. A lock older than 15 minutes, or of a dead process, is taken over.
 */
function withWriteLock(programDir, fn) {
  const file = path.join(programDir, 'alm-write.lock');
  fs.mkdirSync(programDir, { recursive: true });
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
    let alive = false;
    try { process.kill(cur.pid, 0); alive = true; } catch { alive = false; }
    if (alive && cur.pid !== process.pid && Date.now() - Date.parse(cur.at) < 15 * 60_000) {
      throw Object.assign(new Error(`outra sessão está escrevendo no ALM agora (pid ${cur.pid}, desde ${cur.at}) — rode de novo quando ela terminar; nada foi escrito`), { locked: true });
    }
  } catch (err) { if (err.locked) throw err; }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const release = () => { try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(file); } catch { /* */ } };
  let out;
  try { out = fn(); } catch (err) { release(); throw err; }
  if (out && typeof out.then === 'function') return out.finally(release);
  release();
  return out;
}

function checkConfig(cfg, env = process.env) {
  const problems = [];
  if (!cfg) return ['alm não configurado (alm.provider: "jira" | "azure-devops" no .oxe/config.json)'];
  if (!cfg.p.project) problems.push(`alm.${cfg.provider === 'jira' ? 'jira' : 'azure_devops'}.project ausente`);
  if (cfg.transport === 'mcp') return problems; // the MCP server holds the login: no variable needed
  const vars = cfg.provider === 'jira'
    ? [cfg.p.site_env || 'JIRA_SITE', cfg.p.email_env || 'JIRA_EMAIL', cfg.p.token_env || 'JIRA_API_TOKEN']
    : [cfg.p.org_env || 'AZURE_DEVOPS_ORG', cfg.p.token_env || 'AZURE_DEVOPS_EXT_PAT'];
  for (const v of vars) if (!env[v]) problems.push(`variável de ambiente ${v} não definida`);
  return problems;
}

// ── http with retry and backoff ──────────────────────────────────────────────────────────────────────────────────

/** Default transport: global fetch. Tests inject { http } with the same contract. */
async function fetchHttp(method, url, headers, body) {
  const res = await fetch(url, { method, headers, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, headers: { retryAfter: res.headers.get('retry-after') } };
}

/** A read-only POST (Azure WIQL query): allowed in a dry run. Everything else that is not GET writes. */
const isReadOnlyCall = (method, url) => method === 'GET' || (method === 'POST' && /\/wit\/wiql\?/.test(url));

async function request(ctx, method, url, body, extraHeaders = {}) {
  // OXB-G13: a dry run (or a read-only session) never reaches a write endpoint, whatever the command does above
  if (ctx.readOnly && !isReadOnlyCall(method, url)) {
    throw Object.assign(new Error(`simulação: ${method} ${url.replace(/\?.*$/, '')} bloqueado (--dry-run nunca grava no ALM)`), { fatal: true, dryRunBlocked: true });
  }
  const attempts = ctx.retries ?? 3;
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await ctx.http(method, url, { ...ctx.headers, ...extraHeaders }, body);
      if (r.status === 429 || r.status >= 500) {
        last = new Error(`HTTP ${r.status}`);
        const wait = Math.min(Number(r.headers && r.headers.retryAfter) * 1000 || (1000 * 3 ** i), 30_000);
        await ctx.sleep(wait);
        continue;
      }
      if (r.status === 401) throw Object.assign(new Error('HTTP 401: credencial recusada (confira as variáveis de ambiente do ALM)'), { fatal: true });
      if (r.status === 403) throw Object.assign(new Error(`HTTP 403: sem permissão para ${method} ${url.replace(/\?.*$/, '')}`), { fatal: true });
      if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}: ${String(r.text || '').slice(0, 300)}`), { fatal: true });
      return r.json;
    } catch (err) {
      if (err.fatal) throw err;
      last = err;
      await ctx.sleep(1000 * 3 ** i);
    }
  }
  throw last || new Error('falha de rede');
}

// ── providers (one interface) ────────────────────────────────────────────────────────────────────────────────────

const adf = (text) => ({ type: 'doc', version: 1, content: String(text || '').split(/\n{2,}/).filter(Boolean).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.replace(/\n/g, ' ') }] })) });

function jiraProvider(cfg, env, ctx) {
  const site = String(env[cfg.p.site_env || 'JIRA_SITE'] || '').replace(/\/+$/, '');
  const auth = Buffer.from(`${env[cfg.p.email_env || 'JIRA_EMAIL']}:${env[cfg.p.token_env || 'JIRA_API_TOKEN']}`).toString('base64');
  const c = { ...ctx, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' } };
  const types = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Task', ...(cfg.p.types || {}) };
  const project = cfg.p.project;
  const keyUrl = (key) => `${site}/browse/${key}`;
  return {
    name: 'jira',
    keyText: (key) => key,
    url: keyUrl,
    async findByLabel(label) {
      const jql = `project = "${project}" AND labels = "${label}"`;
      const r = await request(c, 'GET', `${site}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=2`);
      const issue = r && Array.isArray(r.issues) ? r.issues[0] : null;
      return issue ? { key: issue.key, id: issue.id, status: issue.fields && issue.fields.status ? issue.fields.status.name : null } : null;
    },
    async create(item) {
      const fields = {
        project: { key: project },
        issuetype: { name: types[item.kind] || types.task },
        summary: item.title.slice(0, 250),
        description: adf(item.description),
        labels: [...new Set([...(item.labels || [])])].map((l) => l.replace(/\s+/g, '-')),
        ...(item.parent ? { parent: { key: item.parent } } : {}),
        ...(item.fixVersion ? { fixVersions: [{ name: item.fixVersion }] } : {}),
      };
      // No retry on the POST itself: a create that timed out may have landed; the caller records the key at once and
      // confirms with read() (GET by key — the label search takes minutes to see a new item).
      const r = await request({ ...c, retries: 1 }, 'POST', `${site}/rest/api/3/issue`, { fields });
      return { key: r.key, id: r.id };
    },
    async read(key) {
      const back = await request(c, 'GET', `${site}/rest/api/3/issue/${key}?fields=summary,status,labels`);
      return back ? { key: back.key, id: back.id, status: back.fields && back.fields.status ? back.fields.status.name : null } : null;
    },
    async status(key) {
      const r = await request(c, 'GET', `${site}/rest/api/3/issue/${key}?fields=status`);
      return r && r.fields && r.fields.status ? r.fields.status.name : null;
    },
    async transition(key, stateName) {
      const now = await this.status(key);
      if (now && now.toLowerCase() === stateName.toLowerCase()) return { changed: false, status: now };
      const r = await request(c, 'GET', `${site}/rest/api/3/issue/${key}/transitions`);
      const ts = (r && r.transitions) || [];
      const t = ts.find((x) => x.to && String(x.to.name).toLowerCase() === stateName.toLowerCase()) || ts.find((x) => String(x.name).toLowerCase() === stateName.toLowerCase());
      if (!t) throw Object.assign(new Error(`${key}: nenhuma transição leva a "${stateName}" (disponíveis: ${ts.map((x) => x.to ? x.to.name : x.name).join(', ') || '—'})`), { fatal: true });
      await request(c, 'POST', `${site}/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
      const after = await this.status(key);
      return { changed: true, status: after };
    },
    async comment(key, text) { await request(c, 'POST', `${site}/rest/api/3/issue/${key}/comment`, { body: adf(text) }); },
    async link(key, otherKey, type = 'Relates') { await request(c, 'POST', `${site}/rest/api/3/issueLink`, { type: { name: type }, inwardIssue: { key }, outwardIssue: { key: otherKey } }); },
    async remoteLink(key, url, title) {
      // globalId makes it idempotent: the same PR posted again updates the link instead of adding a second one
      await request(c, 'POST', `${site}/rest/api/3/issue/${key}/remotelink`, { globalId: `oxe-pr:${url}`, object: { url, title, icon: { url16x16: 'https://github.com/favicon.ico', title: 'GitHub' } } });
      return { linked: true };
    },
    async labels(key) {
      const r = await request(c, 'GET', `${site}/rest/api/3/issue/${key}?fields=labels`);
      return (r && r.fields && r.fields.labels) || [];
    },
    async addLabels(key, labels) {
      await request(c, 'PUT', `${site}/rest/api/3/issue/${key}`, { update: { labels: labels.map((l) => ({ add: l })) } });
    },
    /** The fix versions of an item (names). */
    async fixVersions(key) {
      const r = await request(c, 'GET', `${site}/rest/api/3/issue/${key}?fields=fixVersions`);
      return ((r && r.fields && r.fields.fixVersions) || []).map((v) => v.name);
    },
    /**
     * Sets the fix version of an existing item. A PUT of `fields.fixVersions` came back empty on Jira Cloud; what works
     * is `update.fixVersions[].set` with the version id.
     */
    async setFixVersion(key, name) {
      const vs = await request(c, 'GET', `${site}/rest/api/3/project/${project}/versions`);
      const v = (vs || []).find((x) => x.name === name);
      if (!v) throw Object.assign(new Error(`versão ${name} não existe no projeto ${project}`), { fatal: true });
      await request(c, 'PUT', `${site}/rest/api/3/issue/${key}`, { update: { fixVersions: [{ set: [{ id: String(v.id) }] }] } });
      const now = await this.fixVersions(key);
      return { changed: true, ok: now.includes(name), versions: now };
    },
    async releaseVersion(name) {
      const vs = await request(c, 'GET', `${site}/rest/api/3/project/${project}/versions`);
      const v = (vs || []).find((x) => x.name === name);
      if (!v) throw Object.assign(new Error(`versão ${name} não existe no projeto ${project}`), { fatal: true });
      if (v.released) return { changed: false };
      await request(c, 'PUT', `${site}/rest/api/3/version/${v.id}`, { released: true, releaseDate: new Date().toISOString().slice(0, 10) });
      return { changed: true };
    },
  };
}

function azureProvider(cfg, env, ctx) {
  const org = String(env[cfg.p.org_env || 'AZURE_DEVOPS_ORG'] || '').replace(/\/+$/, '');
  const orgUrl = /^https?:\/\//.test(org) ? org : `https://dev.azure.com/${org}`;
  const project = cfg.p.project;
  const base = `${orgUrl}/${encodeURIComponent(project)}/_apis`;
  const auth = Buffer.from(`:${env[cfg.p.token_env || 'AZURE_DEVOPS_EXT_PAT']}`).toString('base64');
  const c = { ...ctx, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' } };
  const types = { epic: 'Epic', story: 'User Story', task: 'Task', bug: 'Bug', ...(cfg.p.types || {}) };
  const api = 'api-version=7.1';
  const html = (t) => String(t || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
  return {
    name: 'azure-devops',
    keyText: (id) => `AB#${id}`,
    url: (id) => `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
    async findByLabel(label) {
      const r = await request(c, 'POST', `${base}/wit/wiql?${api}`, { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${label.replace(/'/g, "''")}'` });
      const id = r && Array.isArray(r.workItems) && r.workItems[0] ? r.workItems[0].id : null;
      return id ? { key: String(id), id: String(id), status: await this.status(String(id)) } : null;
    },
    async create(item) {
      const ops = [
        { op: 'add', path: '/fields/System.Title', value: item.title.slice(0, 250) },
        { op: 'add', path: '/fields/System.Description', value: html(item.description) },
        { op: 'add', path: '/fields/System.Tags', value: [...new Set(item.labels || [])].join('; ') },
        ...(cfg.p.area_path ? [{ op: 'add', path: '/fields/System.AreaPath', value: cfg.p.area_path }] : []),
        ...(cfg.p.iteration_path ? [{ op: 'add', path: '/fields/System.IterationPath', value: cfg.p.iteration_path }] : []),
        ...(item.parent ? [{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${orgUrl}/_apis/wit/workItems/${item.parent}` } }] : []),
      ];
      const r = await request({ ...c, retries: 1 }, 'POST', `${base}/wit/workitems/$${encodeURIComponent(types[item.kind] || types.task)}?${api}`, ops, { 'Content-Type': 'application/json-patch+json' });
      return { key: String(r.id), id: String(r.id) };
    },
    async read(id) {
      const back = await request(c, 'GET', `${base}/wit/workitems/${id}?${api}`);
      return back ? { key: String(back.id), id: String(back.id), status: back.fields ? back.fields['System.State'] : null } : null;
    },
    async status(id) {
      const r = await request(c, 'GET', `${base}/wit/workitems/${id}?fields=System.State&${api}`);
      return r && r.fields ? r.fields['System.State'] : null;
    },
    async transition(id, stateName) {
      const now = await this.status(id);
      if (now && now.toLowerCase() === stateName.toLowerCase()) return { changed: false, status: now };
      await request(c, 'PATCH', `${base}/wit/workitems/${id}?${api}`, [{ op: 'add', path: '/fields/System.State', value: stateName }], { 'Content-Type': 'application/json-patch+json' });
      return { changed: true, status: await this.status(id) };
    },
    async comment(id, text) { await request(c, 'POST', `${base}/wit/workItems/${id}/comments?api-version=7.1-preview.4`, { text: html(text) }); },
    async link(id, otherId) {
      await request(c, 'PATCH', `${base}/wit/workitems/${id}?${api}`, [{ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Related', url: `${orgUrl}/_apis/wit/workItems/${otherId}` } }], { 'Content-Type': 'application/json-patch+json' });
    },
    async remoteLink(id, url, title) {
      await request(c, 'PATCH', `${base}/wit/workitems/${id}?${api}`, [{ op: 'add', path: '/relations/-', value: { rel: 'Hyperlink', url, attributes: { comment: title } } }], { 'Content-Type': 'application/json-patch+json' });
      return { linked: true };
    },
    async releaseVersion() { return { changed: false, note: 'Azure DevOps não tem versão de release no item; use iteration_path' }; },
  };
}

/**
 * transport "mcp": nothing leaves the oxe-cc. Every write becomes an operation in .oxe/program/alm-mcp-queue.json; the
 * agent runs them in order with the MCP tools of its session and reports each one with `oxe-cc alm ack`.
 */
function queueProvider(cfg) {
  return { name: cfg.provider, deferred: true, url: () => null };
}

/** A raw Jira REST context ({ request(method, url, body), site }) with the same auth, retries and backoff. */
function jiraRest(cfg, options = {}) {
  const env = options.env || process.env;
  const site = String(env[cfg.p.site_env || 'JIRA_SITE'] || '').replace(/\/+$/, '');
  const auth = Buffer.from(`${env[cfg.p.email_env || 'JIRA_EMAIL']}:${env[cfg.p.token_env || 'JIRA_API_TOKEN']}`).toString('base64');
  const c = { http: options.http || fetchHttp, sleep: options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), retries: options.retries, readOnly: isDry(cfg, options), headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' } };
  return { site, readOnly: c.readOnly, request: (method, url, body) => request(c, method, url, body) };
}

/** Is this call a simulation? --dry-run, alm.dry_run, or an explicit read-only context. */
/**
 * Deprecation (coordination 14/11): today a writing command without --apply still writes; the next minor makes
 * alm.require_apply true by default. Said once per process, on stderr, so a JSON output stays clean.
 */
let applyWarned = false;
function warnApply(cfg, options = {}) {
  if (applyWarned || !cfg || cfg.require_apply || options.apply || isDry(cfg, options) || options.quietApply) return false;
  applyWarned = true;
  process.stderr.write('  ! isto grava no ALM sem --apply; na próxima versão vai exigir --apply (alm.require_apply passa a true)\n');
  return true;
}

const isDry = (cfg, options = {}) => Boolean(options.dryRun || options.readOnly || (cfg && cfg.dry_run) || (cfg && cfg.require_apply && !options.apply));

function provider(cfg, options = {}) {
  if (cfg.transport === 'mcp') return queueProvider(cfg);
  const env = options.env || process.env;
  const ctx = { http: options.http || fetchHttp, sleep: options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), retries: options.retries, readOnly: isDry(cfg, options) };
  return cfg.provider === 'jira' ? jiraProvider(cfg, env, ctx) : azureProvider(cfg, env, ctx);
}

// ── ledger and state ─────────────────────────────────────────────────────────────────────────────────────────────

const linksFile = (programDir) => path.join(programDir, 'alm-links.ndjson');
const stateFile = (programDir) => path.join(programDir, 'alm-state.json');

function links(programDir) {
  const out = new Map();
  let raw = '';
  try { raw = fs.readFileSync(linksFile(programDir), 'utf8'); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) { try { const r = JSON.parse(line); if (r && r.ref && r.key) out.set(r.ref, r); } catch { /* */ } }
  return out;
}

function addLink(programDir, rec) {
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(linksFile(programDir), `${JSON.stringify({ ...rec, at: new Date().toISOString() })}\n`, 'utf8');
}

function readState(programDir) {
  try { return JSON.parse(fs.readFileSync(stateFile(programDir), 'utf8')); } catch { return { cursor: 0, stages: {}, pending: [] }; }
}

function writeState(programDir, st) {
  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(stateFile(programDir), JSON.stringify(st, null, 2), 'utf8');
}

// ── MCP queue (transport "mcp") ──────────────────────────────────────────────────────────────────────────────────

const REF_MARK = '@ref:'; // an item still queued, named by its ref where a key would go
const queueFile = (programDir) => path.join(programDir, 'alm-mcp-queue.json');

function readQueue(programDir) {
  try { const q = JSON.parse(fs.readFileSync(queueFile(programDir), 'utf8')); return Array.isArray(q.ops) ? q : { ops: [] }; } catch { return { ops: [] }; }
}

function writeQueue(programDir, q) {
  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(queueFile(programDir), JSON.stringify({ ...q, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

/** The search the agent runs BEFORE creating (an item already there is adopted, never duplicated). */
function searchFor(cfg, labels) {
  if (cfg.provider === 'jira') return { jql: `project = "${cfg.p.project}" AND labels in (${labels.map((l) => `"${l}"`).join(', ')})` };
  return { wiql: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${String(cfg.p.project).replace(/'/g, "''")}' AND (${labels.map((l) => `[System.Tags] CONTAINS '${l.replace(/'/g, "''")}'`).join(' OR ')})` };
}

/**
 * Adds (or replaces, by id) operations, keeping the order a parent needs: an ensure keeps its first position. A newer
 * transition of the same item replaces the older one (the state is set by name, the last one wins) and keeps the
 * comments of both. Ops whose item is already linked carry its key; the others name the parent by `parent_ref`.
 */
function enqueue(programDir, ops) {
  const q = readQueue(programDir);
  for (const op of ops) {
    const i = q.ops.findIndex((o) => o.id === op.id);
    if (i < 0) { q.ops.push({ ...op, queued_at: new Date().toISOString() }); continue; }
    const prev = q.ops[i];
    const comments = [...new Set([...(prev.comments || []), ...(op.comments || [])])];
    q.ops[i] = { ...prev, ...op, ...(comments.length ? { comments } : {}), queued_at: prev.queued_at };
  }
  writeQueue(programDir, q);
  return q;
}

/** The queue with the keys known since (a parent created by an earlier op) filled in. */
function pendingOps(programDir) {
  const known = links(programDir);
  return readQueue(programDir).ops.map((o) => {
    const out = { ...o };
    if (o.parent_ref && known.has(o.parent_ref)) out.parent = known.get(o.parent_ref).key;
    if (o.ref && !o.key && known.has(o.ref) && o.op !== 'ensure') out.key = known.get(o.ref).key;
    if (o.other_ref && known.has(o.other_ref)) out.other_key = known.get(o.other_ref).key;
    return out;
  });
}

/**
 * The agent reports one operation: done (an ensure needs the key it created or found), or failed (it stays queued,
 * with the error). An id or, for convenience, the item ref (US-3, F1-T2: its ensure first, else its transition).
 */
function ack(programDir, cfg, idOrRef, input = {}) {
  const q = readQueue(programDir);
  const op = q.ops.find((o) => o.id === idOrRef) || q.ops.find((o) => o.ref === idOrRef && o.op === 'ensure') || q.ops.find((o) => o.ref === idOrRef);
  if (!op) throw new Error(`${idOrRef}: nenhuma operação na fila do ALM (oxe-cc alm queue)`);
  if (input.error) {
    op.attempts = (op.attempts || 0) + 1;
    op.last_error = String(input.error).slice(0, 300);
    writeQueue(programDir, q);
    return { id: op.id, failed: true, attempts: op.attempts };
  }
  if (op.op === 'ensure') {
    if (!input.key) throw new Error(`${op.id}: informe a chave criada ou encontrada (--key OXE-12 / --key 123)`);
    const key = String(input.key).replace(/^AB#/i, '');
    addLink(programDir, { ref: op.ref, key, url: input.url || null, kind: op.kind, provider: cfg.provider, via: 'mcp', ...(input.adopted ? { adopted: input.adopted } : {}), ...(op.cr ? { cr: op.cr } : {}) });
  } else if (op.op === 'transition') {
    const st = readState(programDir);
    st.stages[op.ref] = op.stage;
    writeState(programDir, st);
  } else if (op.op === 'release_version') {
    const st = readState(programDir);
    st.versions_released = [...new Set([...(st.versions_released || []), op.version])];
    writeState(programDir, st);
  }
  q.ops = q.ops.filter((o) => o !== op);
  writeQueue(programDir, q);
  return { id: op.id, done: true, remaining: q.ops.length };
}

/** `alm link` by hand settles the ensure of that ref too. */
function dropEnsure(programDir, ref) {
  const q = readQueue(programDir);
  const n = q.ops.length;
  q.ops = q.ops.filter((o) => !(o.op === 'ensure' && o.ref === ref));
  if (q.ops.length !== n) writeQueue(programDir, q);
}

/**
 * The idempotency label: ref-<program>-<ref> (ref-152code-US-3, ref-152code-F2-T5). The project's own convention
 * (ref-CODE-8, ref-BRD-nn) and never confused with the item keys (OXE-n) in a search.
 */
const refLabel = (ref, cfg) => `ref-${(cfg && cfg.program) || 'oxe'}-${ref}`;
const taskRef = (phase, taskId) => (phase ? `${phase}-${taskId}` : taskId);
const perPhase = (v, phase) => (v && typeof v === 'object' ? v[phase] || null : v || null);

/** Old codes a task carries: its `refs`, plus <PREFIX>-<n> in its text for the configured prefixes. */
function oldRefs(cfg, t) {
  const out = new Set((Array.isArray(t.refs) ? t.refs : []).map(String));
  if (cfg.adopt_prefixes.length) {
    const re = new RegExp(`\\b(?:${cfg.adopt_prefixes.map((p) => p.replace(/[^A-Za-z0-9]/g, '')).join('|')})-\\d+\\b`, 'g');
    for (const m of `${t.title || ''} ${t.description || ''}`.match(re) || []) out.add(m);
  }
  return [...out];
}

// ── push (stories, tasks) ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Creates the missing items: each PRD story (parent = alm.epic), then each pending plan task (parent = the story whose
 * criteria it delivers, else the epic). Idempotent: an item already linked, or found by its oxe-… label, is reused.
 * @param {{ stories: object[], tasks: object[], phase: string|null, dryRun: boolean }} input
 */
async function push(programDir, cfg, input, options = {}) {
  const prov = options.provider || provider(cfg, options);
  const known = links(programDir);
  const result = { created: [], reused: [], planned: [], failed: [] };
  const ledgerExists = fs.existsSync(linksFile(programDir));
  if (cfg.ledger_guard && !ledgerExists && !input.dryRun && !input.rebuild && !input.firstPush) {
    throw new Error(`registro local do ALM ausente (${path.relative(process.cwd(), linksFile(programDir)) || linksFile(programDir)}): com alm.ledger_guard, nada é criado no escuro — rode oxe-cc alm push --rebuild-ledger (refaz o registro pela busca, sem criar) ou, se é o primeiro push deste programa, --first-push`);
  }
  if (input.rebuild) result.missing = [];
  let createdEpic = null;
  const epicFor = (phase) => perPhase(cfg.epic, phase) || createdEpic;
  const fixVersion = perPhase(cfg.fix_version, input.phase);
  // Dry run with credentials: READS only (what exists, what would be adopted); no credentials: nothing leaves.
  const canRead = !prov.deferred && (!input.dryRun || options.readOnlyLookup === true);
  let settled = false;
  // transport "mcp": an item not linked yet becomes an `ensure` op (search by label → adopt or create → alm ack); the
  // children name it by ref until the agent reports its key.
  // The target version on an item that exists (adopted, or created without it): set by id via update.set — never
  // trusted to the create alone. A failure here is a warning, not a lost item.
  const ensureVersion = async (key, version) => {
    if (!version || input.dryRun || typeof prov.fixVersions !== 'function') return;
    try {
      const have = await prov.fixVersions(key);
      if (have.includes(version)) return;
      const r = await prov.setFixVersion(key, version);
      (result.versions = result.versions || []).push({ key, version, ok: r.ok });
    } catch (err) { (result.versions = result.versions || []).push({ key, version, ok: false, error: err.message }); }
  };
  const deferred = prov.deferred && !input.dryRun && !input.rebuild;
  const ops = [];
  if (deferred) result.queued = [];
  const TYPES = cfg.provider === 'jira' ? { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Task' } : { epic: 'Epic', story: 'User Story', task: 'Task', bug: 'Bug' };
  const parentField = (p) => (typeof p === 'string' && p.startsWith(REF_MARK) ? { parent_ref: p.slice(REF_MARK.length) } : (p ? { parent: p } : {}));
  const keyRe = new RegExp(`^${String(cfg.p.project || '[A-Z][A-Z0-9]+').replace(/[^A-Za-z0-9]/g, '')}-\\d+$`);
  const ensure = async (ref, item, adopt = [], hints = {}) => {
    if (known.has(ref)) { result.reused.push({ ref, key: known.get(ref).key }); return known.get(ref).key; }
    // the item names its card (OXE-48 in the PRD row, "(OXE-20)" in the task): that card is it, confirmed by key
    const cardKey = (hints.keys || []).find((k) => keyRe.test(k)) || null;
    if (cardKey && !deferred && (canRead || !input.dryRun)) {
      try {
        const got = await prov.read(cardKey);
        if (got) {
          if (input.dryRun) { result.reused.push({ ref, key: got.key, by_key: true, dry_run: true }); return got.key; }
          addLink(programDir, { ref, key: got.key, url: prov.url(got.key), kind: item.kind, provider: prov.name, by_key: true });
          known.set(ref, { ref, key: got.key });
          result.reused.push({ ref, key: got.key, by_key: true });
          return got.key;
        }
      } catch { /* not found by key: the usual path below */ }
    }
    if (hints.noCreate) {
      (result.missing = result.missing || []).push({ ref, kind: item.kind, title: item.title, why: cardKey ? `o card ${cardKey} não foi encontrado` : 'alm.stories_source "alm": a história não cita o card — ponha a chave na linha da US no PRD (ex.: "OXE-48") ou rode oxe-cc alm link ' + ref + ' <chave>' });
      return null;
    }
    if (deferred) {
      ops.push({
        id: `ensure:${ref}`, op: 'ensure', ref, kind: item.kind,
        type: { ...TYPES, ...(cfg.p.types || {}) }[item.kind] || TYPES.task,
        project: cfg.p.project, title: item.title, description: item.description, labels: item.labels,
        ...parentField(item.parent), ...(item.fixVersion ? { fix_version: item.fixVersion } : {}),
        ...(cfg.provider === 'azure-devops' && cfg.p.area_path ? { area_path: cfg.p.area_path } : {}),
        ...(cfg.provider === 'azure-devops' && cfg.p.iteration_path ? { iteration_path: cfg.p.iteration_path } : {}),
        ...(adopt.length ? { adopt } : {}),
        ...(cardKey ? { adopt_key: cardKey } : {}),
        search: searchFor(cfg, [refLabel(ref, cfg), ...adopt.map((o) => `ref-${o}`)]),
      });
      result.queued.push({ ref, kind: item.kind, title: item.title });
      return `${REF_MARK}${ref}`;
    }
    try {
      let found = canRead ? await prov.findByLabel(refLabel(ref, cfg)) : null;
      let adopted = null;
      for (const old of adopt) {
        if (found || !canRead) break;
        found = await prov.findByLabel(`ref-${old}`);
        if (found) adopted = old;
      }
      if (input.dryRun) {
        if (found) result.reused.push({ ref, key: found.key, ...(adopted ? { adopted } : {}), dry_run: true });
        else result.planned.push({ ref, kind: item.kind, title: item.title, parent: item.parent || null, labels: item.labels, fix_version: item.fixVersion || null });
        return found ? found.key : null;
      }
      // The label search lags behind a create (minutes, measured on Jira Cloud): with no local record, absence is only
      // trusted after a second search, spaced (alm.search_settle_ms, default 5 s).
      if (!found) {
        // one wait per push is enough: the lag concerns items created BEFORE this push
        if (!settled) { settled = true; await (options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(cfg.search_settle_ms); }
        found = await prov.findByLabel(refLabel(ref, cfg));
      }
      if (found) {
        addLink(programDir, { ref, key: found.key, url: prov.url(found.key), kind: item.kind, provider: prov.name, ...(adopted ? { adopted } : {}) });
        known.set(ref, { ref, key: found.key });
        result.reused.push({ ref, key: found.key, ...(adopted ? { adopted } : {}) });
        await ensureVersion(found.key, item.fixVersion);
        return found.key;
      }
      // --rebuild-ledger: only what the search finds is recorded; nothing is created in this mode
      if (input.rebuild) { result.missing.push({ ref, kind: item.kind, title: item.title }); return null; }
      const it = await prov.create(item);
      // the key goes to the local record BEFORE any other write — a lost read-back must never cause a duplicate
      addLink(programDir, { ref, key: it.key, url: prov.url(it.key), kind: item.kind, provider: prov.name });
      known.set(ref, { ref, key: it.key });
      let confirmed = true;
      try { confirmed = Boolean(await prov.read(it.key)); } catch { confirmed = false; }
      result.created.push({ ref, key: it.key, ...(confirmed ? {} : { unconfirmed: true }) });
      if (confirmed) await ensureVersion(it.key, item.fixVersion);
      return it.key;
    } catch (err) {
      result.failed.push({ ref, error: err.message });
      return null;
    }
  };
  // Spec approved → the epic, when the config names none (one per program, or per phase with input.phase).
  if (cfg.stories_source !== 'alm' && !epicFor(input.phase) && input.epicTitle && (input.stories || []).length) {
    // one epic per spec (program); per phase only when the config already maps epics per phase
    const ref = cfg.epic && typeof cfg.epic === 'object' && input.phase ? `EPIC-${input.phase}` : 'EPIC';
    createdEpic = await ensure(ref, { kind: 'epic', title: input.epicTitle, description: input.epicDescription || 'Criado pelo OXE a partir do PRD.md.', labels: [...cfg.labels, refLabel(ref, cfg)], fixVersion });
  }
  const storyKeyByCriterion = new Map();
  const storyRefByCriterion = new Map();
  for (const s of input.stories || []) for (const a of s.criteria) if (!storyRefByCriterion.has(a)) storyRefByCriterion.set(a, s.id);
  for (const s of input.stories || []) {
    const key = await ensure(s.id, {
      kind: 'story',
      title: `${s.id}: ${s.want}`,
      description: [`Como ${s.persona}, quero ${s.want}, para ${s.benefit}.`, s.criteria.length ? `Critérios de aceite: ${s.criteria.join(', ')}` : '', s.requirements.length ? `Requisitos: ${s.requirements.join(', ')}` : '', 'Criado pelo OXE (PRD.md).'].filter(Boolean).join('\n\n'),
      labels: [...cfg.labels, refLabel(s.id, cfg)],
      parent: epicFor(input.phase),
      fixVersion,
    }, [], { keys: s.cards || [], noCreate: cfg.stories_source === 'alm' });
    for (const a of s.criteria) if (!storyKeyByCriterion.has(a)) storyKeyByCriterion.set(a, key || (input.dryRun ? s.id : null));
  }
  for (const t of input.tasks || []) {
    if (t.done) continue;
    const ref = taskRef(input.phase, t.id);
    const crit = [...(t.acceptance || t.aceite || [])];
    const story = crit.map((a) => storyKeyByCriterion.get(a)).find(Boolean) || null;
    // Jira: a task cannot be the child of a story in a team-managed project unless it is a subtask; parent = the epic,
    // and the story is linked. Azure DevOps: Task under User Story is the native hierarchy.
    const parent = cfg.provider === 'azure-devops' ? (story || epicFor(input.phase)) : epicFor(input.phase);
    const key = await ensure(ref, {
      kind: 'task',
      title: `${t.id}: ${t.title || 'tarefa'}`,
      description: [t.description || '', (t.files || []).length ? `Arquivos: ${t.files.join(', ')}` : '', crit.length ? `Critérios: ${crit.join(', ')}` : '', `Fase ${input.phase || '—'} · criado pelo OXE (PLAN.json).`].filter(Boolean).join('\n\n'),
      // the block's labels PLUS the task's own (area-…), never replacing them
      labels: [...new Set([...cfg.labels, ...(Array.isArray(t.labels) ? t.labels.map(String) : []), refLabel(ref, cfg)])],
      parent,
      fixVersion,
    }, oldRefs(cfg, t), { keys: require('./oxe-prd.cjs').cardKeys([t.title, t.description, ...(Array.isArray(t.refs) ? t.refs : [])].join(' ')) });
    if (key && story && cfg.provider === 'jira' && !input.dryRun && story !== key) {
      const storyRef = crit.map((a) => storyRefByCriterion.get(a)).find(Boolean);
      if (deferred) { if (storyRef && !known.has(ref)) ops.push({ id: `link:${ref}:${storyRef}`, op: 'link', ref, other_ref: storyRef, type: 'Relates' }); } else {
        try { await prov.link(key, story); } catch { /* the link is a convenience */ }
      }
    }
  }
  if (deferred && ops.length) enqueue(programDir, ops);
  if (deferred) result.queue = readQueue(programDir).ops.length;
  return result;
}

// ── sync (lifecycle → stages) ────────────────────────────────────────────────────────────────────────────────────

/**
 * The stage each OXE event moves an item to. Pure: tested without a network.
 * @returns {Array<{ ref: string, stage: string, comment?: string }>}
 */
function stagesFromEvents(events, ctx = {}) {
  const out = [];
  const phase = ctx.phase || null;
  const phaseOfTask = ctx.phaseOfTask || (() => phase);
  for (const e of events) {
    const task = e.work_item_id || (e.payload && e.payload.task) || null;
    if (e.type === 'TaskStarted' && task) out.push({ ref: taskRef(phaseOfTask(task), task), stage: 'in_progress' });
    else if (e.type === 'TaskPromoted' && task && e.payload && e.payload.pr) out.push({ ref: taskRef(phaseOfTask(task), task), stage: 'review', comment: `PR aberto: ${e.payload.pr}` });
    else if (e.type === 'TaskPromoteFailed' && task) out.push({ ref: taskRef(phaseOfTask(task), task), stage: 'review', comment: `Promoção falhou: ${(e.payload && (e.payload.reason || e.payload.error)) || 'sem detalhe'}` });
    else if (e.type === 'AlmMerged' && task) out.push({ ref: taskRef(phaseOfTask(task), task), stage: 'integrated', comment: e.payload && e.payload.pr ? `Merge: ${e.payload.pr}` : undefined });
    else if (e.type === 'DeployAttached' && e.payload && e.payload.ok !== false && (!ctx.releasedEnv || e.payload.env === ctx.releasedEnv)) {
      for (const ref of (ctx.refsOfPhase ? ctx.refsOfPhase(e.payload.phase) : [])) out.push({ ref, stage: 'released', comment: `Deploy ${e.payload.env || ''} ${e.payload.version || ''}`.trim() });
    }
  }
  return out;
}

const RANK = Object.fromEntries(STAGES.map((s, i) => [s, i]));

/**
 * Applies the stages of the events after the cursor, plus the writes that failed before. Never throws: failures go to
 * `pending` and are retried next time. An item never moves backwards, except in_review after a failed promotion.
 */
async function sync(programDir, cfg, events, ctx = {}, options = {}) {
  const prov = options.provider || provider(cfg, options);
  const st = readState(programDir);
  const known = links(programDir);
  const fresh = events.slice(st.cursor || 0);
  const moves = [...(st.pending || []), ...stagesFromEvents(fresh, ctx)];
  const result = { moved: [], skipped: [], failed: [], planned: [], comments: 0 };
  const pending = [];
  const deferred = prov.deferred && !(options.dryRun || cfg.dry_run);
  const ops = [];
  const ensureQueued = deferred ? new Set(readQueue(programDir).ops.filter((o) => o.op === 'ensure').map((o) => o.ref)) : new Set();
  if (deferred) result.queued = [];
  for (const m of moves) {
    const link = known.get(m.ref);
    const state = cfg.states[m.stage];
    if (!cfg.track.includes(m.stage)) { result.skipped.push({ ref: m.ref, stage: m.stage, why: 'etapa fora de alm.track (outra ferramenta move)' }); continue; }
    if (deferred && state && (link || ensureQueued.has(m.ref))) {
      const prev = st.stages[m.ref];
      if (prev && RANK[m.stage] < RANK[prev] && !/^Promoção falhou/.test(m.comment || '')) { result.skipped.push({ ref: m.ref, stage: m.stage, why: `já em ${prev}` }); continue; }
      ops.push({ id: `transition:${m.ref}`, op: 'transition', ref: m.ref, ...(link ? { key: link.key } : {}), stage: m.stage, state, ...(m.comment ? { comments: [m.comment] } : {}) });
      result.queued.push({ ref: m.ref, stage: m.stage, state });
      continue;
    }
    if (!link || !state) { result.skipped.push({ ref: m.ref, stage: m.stage, why: !link ? 'sem item no ALM (oxe-cc alm push)' : `estado de ${m.stage} não mapeado` }); continue; }
    const prev = st.stages[m.ref];
    const backwards = prev && RANK[m.stage] < RANK[prev] && !/^Promoção falhou/.test(m.comment || '');
    if (backwards) { result.skipped.push({ ref: m.ref, stage: m.stage, why: `já em ${prev}` }); continue; }
    if (options.dryRun || cfg.dry_run) { result.planned.push({ ref: m.ref, key: link.key, stage: m.stage, state }); continue; }
    try {
      // Another tool may own the later states (a repository workflow moving PR → train → main → release): read the
      // live state and never pull an item back from a more advanced one.
      // Definition of Ready, before "ready" and before development starts: the refined spec, with no open question.
      if (cfg.ready_gate && (m.stage === 'in_progress' || m.stage === 'ready') && typeof prov.labels === 'function') {
        const have = await prov.labels(link.key);
        const missing = !have.includes(cfg.ready_gate) ? `sem o rótulo ${cfg.ready_gate}` : have.includes('needs-info') ? 'com needs-info (perguntas em aberto)' : null;
        if (missing) {
          result.skipped.push({ ref: m.ref, stage: m.stage, why: `Definition of Ready: ${link.key} ${missing} — rode oxe-cc alm refine ${link.key} e responda as perguntas antes de começar` });
          pending.push(m);
          continue;
        }
      }
      if (typeof prov.status === 'function' && !/^Promoção falhou/.test(m.comment || '')) {
        const live = await prov.status(link.key);
        const liveStage = STAGES.filter((s) => cfg.states[s] && live && String(cfg.states[s]).toLowerCase() === String(live).toLowerCase()).sort((a, b) => RANK[b] - RANK[a])[0];
        if (liveStage && RANK[liveStage] > RANK[m.stage]) {
          st.stages[m.ref] = liveStage;
          result.skipped.push({ ref: m.ref, stage: m.stage, why: `já em "${live}" (movido por outra ferramenta) — o OXE nunca recua um item` });
          continue;
        }
      }
      const r = await prov.transition(link.key, state);
      if (m.comment && r.changed) { await prov.comment(link.key, m.comment); result.comments += 1; }
      st.stages[m.ref] = m.stage;
      result.moved.push({ ref: m.ref, key: link.key, stage: m.stage, state: r.status, changed: r.changed });
    } catch (err) {
      result.failed.push({ ref: m.ref, key: link.key, stage: m.stage, error: err.message });
      if (!err.fatal) pending.push(m);
    }
  }
  // Tag / deploy → the Jira version released (alm.release_version + alm.fix_version), once.
  const deployed = fresh.some((e) => e.type === 'DeployAttached' && e.payload && e.payload.ok !== false && (!ctx.releasedEnv || e.payload.env === ctx.releasedEnv));
  const version = perPhase(cfg.fix_version, ctx.phase);
  if (deployed && cfg.release_version && version && cfg.track.includes('released') && !(st.versions_released || []).includes(version)) {
    if (options.dryRun || cfg.dry_run) result.planned.push({ ref: `version:${version}`, stage: 'released' });
    else if (deferred) { if (cfg.provider === 'jira') { ops.push({ id: `release:${version}`, op: 'release_version', project: cfg.p.project, version }); result.queued.push({ ref: `version:${version}`, stage: 'released' }); } } else {
      try { await prov.releaseVersion(version); st.versions_released = [...(st.versions_released || []), version]; result.version_released = version; } catch (err) { result.failed.push({ ref: `version:${version}`, error: err.message }); }
    }
  }
  if (deferred) { if (ops.length) enqueue(programDir, ops); result.queue = readQueue(programDir).ops.length; }
  if (!(options.dryRun || cfg.dry_run)) {
    st.cursor = events.length;
    st.pending = pending;
    st.last_sync = new Date().toISOString();
    writeState(programDir, st);
  }
  return result;
}

/** A defect found after the deploy: a bug item linked to the item of its origin (story or task). */
async function reportDefect(programDir, cfg, input, options = {}) {
  const prov = options.provider || provider(cfg, options);
  const known = links(programDir);
  const ref = input.ref;
  if (known.has(ref)) return { key: known.get(ref).key, reused: true };
  const origin = input.origin ? known.get(input.origin) : null;
  if (options.dryRun || cfg.dry_run) return { planned: { ref, title: input.title, origin: origin ? origin.key : null } };
  const labels = [...cfg.labels, refLabel(ref, cfg), ...(cfg.provider === 'jira' ? [cfg.p.bug_label || 'bug'] : [])];
  if (prov.deferred) {
    const type = { ...(cfg.provider === 'jira' ? { bug: 'Task' } : { bug: 'Bug' }), ...(cfg.p.types || {}) }.bug;
    const ops = [{ id: `ensure:${ref}`, op: 'ensure', ref, kind: 'bug', type, project: cfg.p.project, title: `${ref}: ${input.title}`, description: [input.description || '', origin ? `Origem: ${origin.key}` : ''].filter(Boolean).join('\n\n'), labels, ...(perPhase(cfg.fix_version, input.phase || null) ? { fix_version: perPhase(cfg.fix_version, input.phase || null) } : {}), search: searchFor(cfg, [refLabel(ref, cfg)]), ...(input.cr ? { cr: String(input.cr) } : {}) }];
    if (origin) ops.push({ id: `link:${ref}:${input.origin}`, op: 'link', ref, other_ref: input.origin, other_key: origin.key, type: 'Relates' });
    enqueue(programDir, ops);
    return { ref, queued: ops.length };
  }
  const it = (await prov.findByLabel(refLabel(ref, cfg))) || await prov.create({ kind: 'bug', title: `${ref}: ${input.title}`, description: [input.description || '', origin ? `Origem: ${origin.key}` : ''].filter(Boolean).join('\n\n'), labels, fixVersion: perPhase(cfg.fix_version, input.phase || null) });
  addLink(programDir, { ref, key: it.key, url: prov.url(it.key), kind: 'bug', provider: prov.name, origin: origin ? origin.key : null, ...(input.cr ? { cr: String(input.cr) } : {}) });
  if (origin) { try { await prov.link(it.key, origin.key); } catch { /* */ } }
  return { key: it.key, created: true };
}

/** A manual move (the merge train's "na fila", a fix by hand): by OXE ref (US-3, F2-T5) or by the item key. */
async function move(programDir, cfg, refOrKey, stage, options = {}) {
  stage = canonStage(stage);
  if (!STAGES.includes(stage)) throw new Error(`etapa "${stage}" desconhecida (${STAGES.join(' | ')})`);
  const state = cfg.states[stage];
  if (!state) throw new Error(`alm.states.${stage} não está mapeado no .oxe/config.json`);
  const link = resolveItem(programDir, cfg, refOrKey);
  if (!link) throw new Error(`${refOrKey}: sem item no ALM (oxe-cc alm push, alm link ${refOrKey} <chave>, ou a chave do item, ex.: ${cfg.provider === 'jira' ? `${cfg.p.project}-12` : '123'})`);
  if (options.dryRun || cfg.dry_run) return { planned: { ref: link.ref, key: link.key, stage, state, ...(options.comment ? { comment: options.comment } : {}) } };
  const prov = options.provider || provider(cfg, options);
  if (prov.deferred) {
    enqueue(programDir, [{ id: `transition:${link.ref}`, op: 'transition', ref: link.ref, key: link.key, stage, state, ...(options.comment ? { comments: [options.comment] } : {}) }]);
    return { ref: link.ref, key: link.key, stage, state, queued: true };
  }
  const r = await prov.transition(link.key, state);
  if (options.comment && r.changed) await prov.comment(link.key, options.comment);
  // the lifecycle state is the OXE refs'; a card moved by its key alone is not one of them
  if (!link.direct) {
    const st = readState(programDir);
    st.stages[link.ref] = stage;
    writeState(programDir, st);
  }
  return { ref: link.ref, key: link.key, stage, state: r.status, changed: r.changed, ...(options.comment && r.changed ? { commented: true } : {}) };
}

/**
 * The item of an OXE ref (US-3, F2-T5) or of a key: the ledger first, then a key of this project used directly
 * (OXE-12 in Jira, 123 in Azure), the way refine and grill publish take it (OXB-G17). "US-1" is never a key.
 */
function resolveItem(programDir, cfg, refOrKey) {
  const s = String(refOrKey || '').trim();
  const all = links(programDir);
  const known = all.get(s) || [...all.values()].find((l) => l.key === s || l.key === s.toUpperCase());
  if (known) return known;
  const direct = cfg.provider === 'jira' ? new RegExp(`^${String(cfg.p.project || '[A-Z][A-Z0-9]+').toUpperCase()}-\\d+$`, 'i').test(s) : /^\d+$/.test(s);
  return direct ? { ref: s.toUpperCase(), key: s.toUpperCase(), direct: true } : null;
}

/**
 * A label on an item and "Relates" links between items — the umbrella card (OxeSpace 14/11: OXE-22/23 point to the
 * BRD items that split them). By key, idempotent (Jira adds a label once; an existing link is not repeated).
 */
async function labelItem(programDir, cfg, refOrKey, labels, options = {}) {
  const item = resolveItem(programDir, cfg, refOrKey);
  if (!item) throw new Error(`${refOrKey}: sem item no ALM (use a chave do item)`);
  const add = (Array.isArray(labels) ? labels : String(labels || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  if (!add.length) throw new Error('informe o rótulo: --add <rótulo>[,<rótulo>]');
  if (add.some((l) => /\s/.test(l))) throw new Error('rótulo do Jira não tem espaço');
  if (options.dryRun || cfg.dry_run) return { planned: { key: item.key, add } };
  const prov = options.provider || provider(cfg, options);
  if (typeof prov.addLabels !== 'function') throw new Error(`${cfg.provider}: rótulo ainda não suportado (Azure: tags)`);
  const have = typeof prov.labels === 'function' ? await prov.labels(item.key) : [];
  const missing = add.filter((l) => !have.includes(l));
  if (missing.length) await prov.addLabels(item.key, missing);
  return { key: item.key, added: missing, existed: add.filter((l) => have.includes(l)) };
}

async function relateItems(programDir, cfg, refOrKey, others, options = {}) {
  const item = resolveItem(programDir, cfg, refOrKey);
  if (!item) throw new Error(`${refOrKey}: sem item no ALM (use a chave do item)`);
  const targets = (Array.isArray(others) ? others : String(others || '').split(',')).map((s) => resolveItem(programDir, cfg, String(s).trim())).filter(Boolean);
  if (!targets.length) throw new Error('informe os itens: --relates <KEY>[,<KEY>]');
  if (options.dryRun || cfg.dry_run) return { planned: { key: item.key, relates: targets.map((t) => t.key) } };
  const prov = options.provider || provider(cfg, options);
  const linked = [];
  const existed = [];
  let current = [];
  if (cfg.provider === 'jira' && typeof prov.read === 'function') {
    try {
      const r = await (options.rest || jiraRest(cfg, options)).request('GET', `${String((options.env || process.env)[cfg.p.site_env || 'JIRA_SITE'] || '').replace(/\/+$/, '')}/rest/api/3/issue/${item.key}?fields=issuelinks`);
      current = ((r && r.fields && r.fields.issuelinks) || []).map((l) => (l.outwardIssue || l.inwardIssue || {}).key).filter(Boolean);
    } catch { current = []; }
  }
  for (const t of targets) {
    if (current.includes(t.key)) { existed.push(t.key); continue; }
    await prov.link(item.key, t.key, 'Relates');
    linked.push(t.key);
  }
  return { key: item.key, linked, existed };
}

/** A link from the item to a pull request (Jira remote link / Azure hyperlink): "entregue no #771". Idempotent. */
async function linkPr(programDir, cfg, refOrKey, input, options = {}) {
  const item = resolveItem(programDir, cfg, refOrKey);
  if (!item) throw new Error(`${refOrKey}: sem item no ALM (use a chave do item, ex.: ${cfg.provider === 'jira' ? `${cfg.p.project}-12` : '123'})`);
  const pr = String(input.pr || '').replace(/^#/, '');
  if (!/^\d+$/.test(pr)) throw new Error('informe o número do PR (--pr 771)');
  const repo = String(input.repo || '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(repo)) throw new Error('o repositório do PR não está configurado: --repo https://github.com/<dono>/<repo> ou alm.docs.repo no .oxe/config.json');
  const url = `${repo}/pull/${pr}`;
  const title = input.title || `PR #${pr}`;
  if (options.dryRun || cfg.dry_run) return { planned: { key: item.key, pr: Number(pr), url, title } };
  const prov = options.provider || provider(cfg, options);
  if (prov.deferred) {
    enqueue(programDir, [{ id: `remotelink:${item.key}:${pr}`, op: 'remotelink', ref: item.ref, key: item.key, url, title }]);
    return { key: item.key, url, queued: true };
  }
  if (typeof prov.remoteLink !== 'function') throw new Error(`${cfg.provider}: link para PR ainda não suportado`);
  const r = await prov.remoteLink(item.key, url, title);
  return { key: item.key, pr: Number(pr), url, linked: true, ...(r && r.existed ? { existed: true } : {}) };
}

/** A comment on an item (by OXE ref or key) — allowed to reader sessions too (alm.writer). */
async function comment(programDir, cfg, refOrKey, text, options = {}) {
  if (!text || String(text).trim().length < 2) throw new Error('informe o comentário (--text "…")');
  const link = resolveItem(programDir, cfg, refOrKey);
  if (!link) throw new Error(`${refOrKey}: sem item no ALM (oxe-cc alm push, ou use a chave do item)`);
  if (options.dryRun || cfg.dry_run) return { planned: { ref: link.ref, key: link.key, comment: String(text) } };
  const prov = options.provider || provider(cfg, options);
  if (prov.deferred) {
    enqueue(programDir, [{ id: `comment:${link.ref}:${Date.now().toString(36)}`, op: 'comment', ref: link.ref, key: link.key, comments: [String(text)] }]);
    return { ref: link.ref, key: link.key, queued: true };
  }
  await prov.comment(link.key, String(text));
  return { ref: link.ref, key: link.key, commented: true };
}

/** "(OXE-12)" / "(AB#123)" for a task: what goes in the PR title, the commit and the branch. */
function keyFor(programDir, cfg, phase, taskId) {
  const l = links(programDir).get(taskRef(phase, taskId));
  if (!l) return null;
  return cfg && cfg.provider === 'azure-devops' ? `AB#${l.key}` : l.key;
}

module.exports = { almConfig, checkConfig, jiraRest, isWriter, writerError, withWriteLock, comment, provider, readQueue, pendingOps, enqueue, ack, dropEnsure, push, sync, move, stagesFromEvents, reportDefect, links, addLink, readState, keyFor, refLabel, taskRef, oldRefs, perPhase, STAGES, STAGE_INFO, STAGE_ALIASES, canonStage, adf, request, isDry, warnApply, resolveItem, linkPr, labelItem, relateItems };
