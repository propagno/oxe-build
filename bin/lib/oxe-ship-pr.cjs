'use strict';

/**
 * 1.21.2 — G5/G8 (OxeSpace 14/11, MARCA OXE-49 / PR #799): `ship status` read only the PRs the phase promoted, so a
 * PR outside a phase (#798–#805), a card's PRs or the merge train had no CI verdict, and "799" was taken for a folder.
 *   - `ship status --pr 799` · `ship status --card OXE-49` · `ship status --repo` (the open PRs, with the train labels);
 *   - each PR's CI classified against the REPOSITORY's known failures (expired when the PR that fixes them merges):
 *     green / pending / known_flake (rerun) / regression;
 *   - `--comment --apply` puts the verdict on the PR ("CI (OXE)", updated in place), where the train, the CI and
 *     the people read it — a local file never reaches them.
 * gh only (the user's login); `spawn` injectable for tests.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const presets = require('./oxe-presets.cjs');

const MARKER = '<!-- oxe-ci-verdict -->';
const DEFAULT_TRAIN = ['na-fila', 'no-batch', 'fix-main'];
const DEFAULT_REQUIRED_STATUSES = ['marca/conformidade'];

function resolveRequiredCommitStatuses(cwd, options = {}) {
  if (Array.isArray(options.requiredStatuses)) {
    return options.requiredStatuses.map((s) => String(s).toLowerCase()).filter(Boolean);
  }
  const hasConfigFile = Boolean(
    cwd && (fs.existsSync(path.join(cwd, 'oxe.config.json')) || fs.existsSync(path.join(cwd, '.oxe', 'config.json')))
  );
  const presetCfg = cwd ? presets.resolvePresetConfig(cwd) : null;
  if (presetCfg && Array.isArray(presetCfg.ship && presetCfg.ship.requiredCommitStatuses) && presetCfg.ship.requiredCommitStatuses.length) {
    return presetCfg.ship.requiredCommitStatuses.map((s) => String(s).toLowerCase()).filter(Boolean);
  }
  if (presetCfg && presetCfg.hasExplicitPreset) return [];
  if (cwd && fs.existsSync(path.join(cwd, 'src', 'design', 'targets'))) return DEFAULT_REQUIRED_STATUSES;
  if (hasConfigFile) return [];
  return Array.isArray(options.commitStatuses) ? DEFAULT_REQUIRED_STATUSES : [];
}

function gh(spawn, cwd, args, input) {
  const r = spawn('gh', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...(input != null ? { input } : {}) });
  if (!r || r.error || r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${String((r && (r.stderr || (r.error && r.error.message))) || 'sem resposta').trim().split('\n')[0]}`);
  return String(r.stdout || '');
}

const FIELDS = 'number,title,headRefName,headRefOid,url,labels,isDraft,state';

/**
 * OXB-G14: Evaluates GitHub commit statuses (specifically `marca/conformidade` or configured `requiredStatuses`)
 * so a green Actions job never masks an enforced brand-conformance divergence posted as a commit status.
 */
function inspectRequiredCommitStatuses(cwd, headSha, options = {}) {
  const required = resolveRequiredCommitStatuses(cwd, options);
  if (!headSha || !required.length) return { ok: true, checked: [], failures: [] };
  const spawn = options.spawn || spawnSync;
  let statuses = [];
  if (Array.isArray(options.commitStatuses)) {
    statuses = options.commitStatuses;
  } else {
    try {
      const raw = gh(spawn, cwd, ['api', `repos/{owner}/{repo}/commits/${headSha}/status`]);
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.statuses)) statuses = parsed.statuses;
    } catch {
      return { ok: true, checked: [], failures: [] };
    }
  }
  // Keep latest status per context
  const latestByCtx = new Map();
  for (const st of statuses) {
    if (!st || !st.context) continue;
    const key = String(st.context).toLowerCase();
    if (!latestByCtx.has(key)) latestByCtx.set(key, st);
  }
  const checked = [];
  const failures = [];
  for (const reqCtx of required) {
    const st = latestByCtx.get(reqCtx);
    if (!st) continue;
    const state = String(st.state || '').toLowerCase();
    const desc = String(st.description || '');
    const divMatch = /(\d+)\s*(?:enforced\s+)?diverg[êe]nc/i.exec(desc) || /enforced[^0-9]{0,20}(\d+)/i.exec(desc);
    const enforcedDivergences = divMatch ? Number(divMatch[1]) : 0;
    const failed = state === 'failure' || state === 'error' || enforcedDivergences > 0;
    const entry = {
      context: st.context,
      state,
      description: desc,
      enforced_divergences: enforcedDivergences,
      target_url: st.target_url || null,
      ok: !failed,
    };
    checked.push(entry);
    if (failed) failures.push(entry);
  }
  return { ok: failures.length === 0, checked, failures };
}

function prState(spawn, cwd) {
  const cache = new Map();
  return (pr) => {
    if (cache.has(pr)) return cache.get(pr);
    let st = null;
    try { st = JSON.parse(gh(spawn, cwd, ['pr', 'view', String(pr), '--json', 'state'])).state || null; } catch { st = null; }
    cache.set(pr, st);
    return st;
  };
}

/** The PRs to look at: one, a card's (title, body or branch name it), or every open one. */
function selectPrs(spawn, cwd, sel) {
  if (sel.pr) return [JSON.parse(gh(spawn, cwd, ['pr', 'view', String(sel.pr).replace(/^#/, ''), '--json', FIELDS]))];
  const open = JSON.parse(gh(spawn, cwd, ['pr', 'list', '--state', 'open', '--limit', String(sel.limit || 50), '--json', `${FIELDS},body`]));
  if (!sel.card) return open;
  const key = String(sel.card).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-#]/g, '[-_#]?')}($|[^0-9])`, 'i');
  return open.filter((p) => re.test(p.title || '') || re.test(p.body || '') || re.test(p.headRefName || ''));
}

/**
 * `{ pr | card | repo }` → the PRs with their CI verdict. `known`: the known failures in force (not expired).
 * Supports provider-agnostic delegation via `bin/lib/oxe-ci-adapter.cjs` (`github`, `gitlab`, `azure-devops`, `local`).
 */
function status(cwd, sel, options = {}) {
  const spawn = options.spawn || spawnSync;
  const kf = require('./oxe-known-failures.cjs');
  const ciAdapter = require('./oxe-ci-adapter.cjs');
  const known = (options.known || []).filter((k) => !k.expired);
  const trainLabels = options.trainLabels || DEFAULT_TRAIN;
  const selector = sel.pr ? { pr: Number(String(sel.pr).replace(/^#/, '')) } : sel.card ? { card: String(sel.card).toUpperCase() } : { repo: true };

  const explicitProvider = options.provider ? String(options.provider).toLowerCase() : null;
  const detectedProvider = explicitProvider || ciAdapter.detectCiProvider(cwd);
  // Preserve legacy GitHub behavior when caller supplies a mock `spawn` without explicit provider on a non-git temp dir
  const effectiveProvider = explicitProvider || (['gitlab', 'azure-devops'].includes(detectedProvider) ? detectedProvider : (options.spawn ? 'github' : detectedProvider));

  if (effectiveProvider === 'local') {
    return { provider: 'local', offline: true, selector, prs: [], known: known.length, train_labels: trainLabels };
  }
  if (effectiveProvider !== 'github') {
    const adapter = ciAdapter.resolveCiAdapter(cwd, { provider: effectiveProvider, spawn });
    const listed = adapter.listPullRequests({ state: 'open', limit: sel.limit || 50 });
    const ciRuns = adapter.inspectCiStatus({ limit: 20 });
    const items = (listed.items || []).filter((it) => {
      if (sel.pr) return Number(it.number) === Number(String(sel.pr).replace(/^#/, ''));
      if (sel.card) {
        const key = String(sel.card).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[-#]/g, '[-_#]?')}($|[^0-9])`, 'i');
        return re.test(it.title || '') || re.test(it.branch || '');
      }
      return true;
    });
    const out = items.map((it) => {
      const matchingRun = (ciRuns.runs || []).find((r) => !it.branch || !r.branch || r.branch === it.branch) || (ciRuns.runs || [])[0] || null;
      let ciState = 'unknown';
      if (matchingRun) {
        if (matchingRun.conclusion === 'success') ciState = 'green';
        else if (matchingRun.conclusion === 'failure' || matchingRun.conclusion === 'failed') ciState = 'regression';
        else ciState = 'pending';
      }
      const labels = Array.isArray(it.labels) ? it.labels : [];
      return {
        pr: it.number,
        title: it.title,
        url: it.url,
        branch: it.branch,
        head_sha: it.head_sha || null,
        draft: Boolean(it.draft),
        state: it.state || 'OPEN',
        labels,
        train: labels.filter((l) => trainLabels.includes(l)),
        ci: { state: ciState, failed: [] },
      };
    });
    return { provider: effectiveProvider, offline: false, selector, prs: out, known: known.length, train_labels: trainLabels, ...(listed.ok ? {} : { error: listed.error }) };
  }

  const prs = selectPrs(spawn, cwd, sel);
  const out = prs.map((p) => {
    const labels = (p.labels || []).map((l) => l.name || l);
    const merged = String(p.state || '').toUpperCase() === 'MERGED';
    const row = { pr: p.number, title: p.title, url: p.url, branch: p.headRefName, head_sha: p.headRefOid || null, draft: Boolean(p.isDraft), state: p.state || 'OPEN', labels, train: labels.filter((l) => trainLabels.includes(l)) };
    if (!merged && String(p.state || 'OPEN').toUpperCase() !== 'CLOSED') {
      try { row.ci = kf.classifyPr(p.number, known, { spawn, cwd, itemOpen: options.itemOpen || (() => null) }); } catch { row.ci = { state: 'unknown', failed: [] }; }
      // OXB-G14: inspect explicit commit statuses (e.g. `marca/conformidade`) so a green job never masks enforced divergences
      if (p.headRefOid || Array.isArray(options.commitStatuses)) {
        const cs = inspectRequiredCommitStatuses(cwd, p.headRefOid || 'HEAD', {
          spawn,
          requiredStatuses: options.requiredStatuses,
          commitStatuses: options.commitStatuses,
        });
        if (cs.checked.length) row.commit_statuses = cs;
        if (!cs.ok) {
          row.ci = row.ci || { state: 'regression', failed: [] };
          row.ci.state = 'regression';
          row.ci.failed = [
            ...(Array.isArray(row.ci.failed) ? row.ci.failed : []),
            ...cs.failures.map((f) => ({
              run: f.target_url || 'commit-status',
              checks: [`${f.context} (${f.state}${f.enforced_divergences ? `: ${f.enforced_divergences} enforced divergence(s)` : ''}${f.description ? ` — ${f.description}` : ''})`],
              known: [],
            })),
          ];
        }
      }
    }
    return row;
  });
  return { selector: sel.pr ? { pr: Number(String(sel.pr).replace(/^#/, '')) } : sel.card ? { card: String(sel.card).toUpperCase() } : { repo: true }, prs: out, known: known.length, train_labels: trainLabels };
}

const VERDICT = { green: 'verde', pending: 'rodando', known_flake: 'falha conhecida (rerun)', regression: 'VERMELHO: falha nova', unknown: 'sem leitura' };

/** The PR comment with the verdict (one per PR, updated in place by its marker). */
function verdictComment(row) {
  const ci = row.ci || { state: 'unknown', failed: [] };
  const L = [MARKER, `**CI (OXE): ${VERDICT[ci.state] || ci.state}**`, ''];
  for (const f of ci.failed || []) {
    L.push(`- run ${f.run || '—'} · ${f.checks.join(', ')}${f.known.length ? ` → conhecida: ${f.known.map((k) => `"${k.pattern}" (${k.item}${k.pr ? `, conserto no PR ${k.pr}` : ''})`).join('; ')}` : ' → **sem falha conhecida: regressão**'}`);
  }
  if (ci.suggestion) L.push('', `Rerun: \`${ci.suggestion}\``);
  L.push('', `_oxe-cc ship status --pr ${row.pr} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_`);
  return L.join('\n');
}

function parsePaginatedJsonArray(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const one = JSON.parse(s);
    return Array.isArray(one) ? one : [];
  } catch { /* gh api --paginate concatenates pages as `[...][...]` */ }
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[') { if (depth === 0) start = i; depth += 1; }
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const page = JSON.parse(s.slice(start, i + 1));
        if (Array.isArray(page)) out.push(...page);
        start = -1;
      }
    }
  }
  if (depth !== 0 || (!out.length && s)) throw new SyntaxError('JSON paginado inválido do gh api');
  return out;
}

/** Upserts the verdict comment on the PR (gh api). */
function publishVerdict(cwd, row, options = {}) {
  const spawn = options.spawn || spawnSync;
  const body = verdictComment(row);
  const comments = parsePaginatedJsonArray(gh(spawn, cwd, ['api', `repos/{owner}/{repo}/issues/${row.pr}/comments`, '--paginate']));
  const mine = comments.find((c) => c && String(c.body || '').includes(MARKER));
  if (mine) gh(spawn, cwd, ['api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${mine.id}`, '-F', 'body=@-'], body);
  else gh(spawn, cwd, ['pr', 'comment', String(row.pr), '--body-file', '-'], body);
  return { pr: row.pr, updated: Boolean(mine), created: !mine };
}

module.exports = { status, selectPrs, prState, inspectRequiredCommitStatuses, verdictComment, publishVerdict, parsePaginatedJsonArray, MARKER, DEFAULT_TRAIN, DEFAULT_REQUIRED_STATUSES, VERDICT };
