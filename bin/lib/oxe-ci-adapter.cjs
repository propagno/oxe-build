'use strict';

/**
 * 1.22.2 (OXB-222-20): Provider-agnostic CI/VCS adapter (`github`, `gitlab`, `azure-devops`, `local`).
 * Abstracts PR/MR listing, CI run inspection, and release asset retrieval so `ship` and `release`
 * operate cleanly across GitHub (`gh`), GitLab (`glab`), Azure DevOps (`az`), and offline local repos.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUPPORTED_PROVIDERS = Object.freeze(['github', 'gitlab', 'azure-devops', 'local']);

function readTextQuiet(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readConfiguredProvider(projectRoot) {
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const cfg = { ...(base || {}), ...(local || {}) };
  const candidate = (cfg.ci && cfg.ci.provider) || (cfg.delivery && cfg.delivery.ci_provider) || null;
  if (candidate && SUPPORTED_PROVIDERS.includes(String(candidate).toLowerCase())) {
    return String(candidate).toLowerCase();
  }
  return null;
}

function readOriginUrl(projectRoot) {
  const gitEntry = path.join(projectRoot, '.git');
  let gitDir = gitEntry;
  try {
    const st = fs.statSync(gitEntry);
    if (st.isFile()) {
      const m = /gitdir:\s*(.+)/i.exec(readTextQuiet(gitEntry));
      if (m) {
        const resolved = path.resolve(projectRoot, m[1].trim());
        const commondir = readTextQuiet(path.join(resolved, 'commondir')).trim();
        gitDir = commondir ? path.resolve(resolved, commondir) : resolved;
      }
    }
  } catch {
    return null;
  }
  const cfg = readTextQuiet(path.join(gitDir, 'config'));
  const m = /\[remote "origin"\][\s\S]*?url\s*=\s*([^\r\n]+)/i.exec(cfg);
  return m ? m[1].trim() : null;
}

/**
 * Detects the repository CI/VCS provider without network access:
 * `options.provider` > config (`ci.provider`) > `.git/config` remote host > CI pipeline files > `'local'`.
 */
function detectCiProvider(projectRoot, options = {}) {
  if (options.provider && SUPPORTED_PROVIDERS.includes(String(options.provider).toLowerCase())) {
    return String(options.provider).toLowerCase();
  }
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const fromCfg = readConfiguredProvider(rootAbs);
  if (fromCfg) return fromCfg;

  const remoteUrl = readOriginUrl(rootAbs);
  if (remoteUrl) {
    if (/github\.com/i.test(remoteUrl)) return 'github';
    if (/gitlab\.com|gitlab\./i.test(remoteUrl)) return 'gitlab';
    if (/dev\.azure\.com|visualstudio\.com/i.test(remoteUrl)) return 'azure-devops';
  }

  if (fs.existsSync(path.join(rootAbs, '.github', 'workflows'))) return 'github';
  if (fs.existsSync(path.join(rootAbs, '.gitlab-ci.yml'))) return 'gitlab';
  if (
    fs.existsSync(path.join(rootAbs, 'azure-pipelines.yml'))
    || fs.existsSync(path.join(rootAbs, 'azure-pipelines.yaml'))
    || fs.existsSync(path.join(rootAbs, '.azure-pipelines'))
  ) {
    return 'azure-devops';
  }
  return 'local';
}

function runCliJson(spawn, bin, args, cwd) {
  const res = spawn(bin, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (!res || res.error || res.status !== 0) {
    const msg = String((res && (res.stderr || (res.error && res.error.message) || res.stdout)) || `${bin} falhou`).trim().split(/\r?\n/)[0];
    return { ok: false, error: `${bin} ${args.slice(0, 2).join(' ')}: ${msg}`, data: null };
  }
  try {
    return { ok: true, error: null, data: JSON.parse(String(res.stdout || 'null')) };
  } catch (err) {
    return { ok: false, error: `${bin}: JSON inválido (${err.message})`, data: null };
  }
}

function buildGithubAdapter(rootAbs, spawn) {
  return {
    provider: 'github',
    offline: false,
    listPullRequests(opts = {}) {
      const state = opts.state || 'open';
      const limit = String(opts.limit || 50);
      const r = runCliJson(spawn, 'gh', ['pr', 'list', '--state', state, '--limit', limit, '--json', 'number,title,headRefName,headRefOid,url,labels,isDraft,state'], rootAbs);
      if (!r.ok) return { ok: false, provider: 'github', offline: false, items: [], error: r.error };
      const items = (Array.isArray(r.data) ? r.data : []).map((p) => ({
        number: Number(p.number),
        title: p.title || '',
        branch: p.headRefName || '',
        head_sha: p.headRefOid || null,
        state: String(p.state || 'OPEN').toUpperCase(),
        draft: Boolean(p.isDraft),
        url: p.url || null,
        labels: (p.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
      }));
      return { ok: true, provider: 'github', offline: false, items };
    },
    inspectCiStatus(opts = {}) {
      const args = ['run', 'list', '--limit', String(opts.limit || 10), '--json', 'databaseId,status,conclusion,url,headBranch,displayTitle'];
      if (opts.branch) args.push('--branch', String(opts.branch));
      const r = runCliJson(spawn, 'gh', args, rootAbs);
      if (!r.ok) return { ok: false, provider: 'github', offline: false, runs: [], error: r.error };
      const runs = (Array.isArray(r.data) ? r.data : []).map((run) => ({
        id: run.databaseId || run.id || null,
        status: String(run.status || 'unknown').toLowerCase(),
        conclusion: run.conclusion ? String(run.conclusion).toLowerCase() : null,
        branch: run.headBranch || opts.branch || null,
        url: run.url || null,
      }));
      return { ok: true, provider: 'github', offline: false, runs };
    },
    listReleaseAssets(tag) {
      const r = runCliJson(spawn, 'gh', ['release', 'view', String(tag), '--json', 'tagName,isDraft,assets'], rootAbs);
      if (!r.ok) return { ok: false, provider: 'github', offline: false, tag: String(tag), assets: [], error: r.error };
      const d = r.data || {};
      return {
        ok: true,
        provider: 'github',
        offline: false,
        tag: d.tagName || String(tag),
        draft: Boolean(d.isDraft),
        assets: Array.isArray(d.assets) ? d.assets : [],
      };
    },
  };
}

function buildGitlabAdapter(rootAbs, spawn) {
  return {
    provider: 'gitlab',
    offline: false,
    listPullRequests(opts = {}) {
      const args = ['mr', 'list', '--output', 'json'];
      if (opts.state === 'closed') args.push('--closed');
      else if (opts.state === 'merged') args.push('--merged');
      const r = runCliJson(spawn, 'glab', args, rootAbs);
      if (!r.ok) return { ok: false, provider: 'gitlab', offline: false, items: [], error: r.error };
      const items = (Array.isArray(r.data) ? r.data : []).map((mr) => ({
        number: Number(mr.iid != null ? mr.iid : mr.id),
        title: mr.title || '',
        branch: mr.source_branch || '',
        head_sha: mr.sha || null,
        state: String(mr.state || 'opened').toUpperCase(),
        draft: Boolean(mr.draft || mr.work_in_progress),
        url: mr.web_url || null,
        labels: Array.isArray(mr.labels) ? mr.labels.map(String) : [],
      }));
      return { ok: true, provider: 'gitlab', offline: false, items };
    },
    inspectCiStatus(opts = {}) {
      const args = ['ci', 'list', '--output', 'json'];
      if (opts.branch) args.push('--ref', String(opts.branch));
      const r = runCliJson(spawn, 'glab', args, rootAbs);
      if (!r.ok) return { ok: false, provider: 'gitlab', offline: false, runs: [], error: r.error };
      const runs = (Array.isArray(r.data) ? r.data : []).map((p) => {
        const st = String(p.status || 'unknown').toLowerCase();
        const conclusion = ['success', 'failed', 'canceled', 'skipped'].includes(st) ? st : null;
        return {
          id: p.id || null,
          status: conclusion ? 'completed' : st,
          conclusion,
          branch: p.ref || opts.branch || null,
          url: p.web_url || null,
        };
      });
      return { ok: true, provider: 'gitlab', offline: false, runs };
    },
    listReleaseAssets(tag) {
      const r = runCliJson(spawn, 'glab', ['release', 'view', String(tag), '--output', 'json'], rootAbs);
      if (!r.ok) return { ok: false, provider: 'gitlab', offline: false, tag: String(tag), assets: [], error: r.error };
      const d = r.data || {};
      const links = (d.assets && Array.isArray(d.assets.links)) ? d.assets.links : [];
      const sources = (d.assets && Array.isArray(d.assets.sources)) ? d.assets.sources : [];
      const rawAssets = links.length ? links : (Array.isArray(d.assets) ? d.assets : sources);
      const assets = rawAssets.map((a) => ({
        name: a.name || path.basename(String(a.url || '')),
        url: a.url || null,
      })).filter((a) => a.name);
      return {
        ok: true,
        provider: 'gitlab',
        offline: false,
        tag: d.tag_name || String(tag),
        draft: false,
        assets,
      };
    },
  };
}

function buildAzureDevopsAdapter(rootAbs, spawn) {
  return {
    provider: 'azure-devops',
    offline: false,
    listPullRequests(opts = {}) {
      const args = ['repos', 'pr', 'list', '--output', 'json'];
      if (opts.state) args.push('--status', opts.state === 'open' ? 'active' : String(opts.state));
      const r = runCliJson(spawn, 'az', args, rootAbs);
      if (!r.ok) return { ok: false, provider: 'azure-devops', offline: false, items: [], error: r.error };
      const items = (Array.isArray(r.data) ? r.data : []).map((pr) => ({
        number: Number(pr.pullRequestId != null ? pr.pullRequestId : pr.id),
        title: pr.title || '',
        branch: String(pr.sourceRefName || '').replace(/^refs\/heads\//, ''),
        head_sha: (pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId) || null,
        state: String(pr.status || 'active').toUpperCase(),
        draft: Boolean(pr.isDraft),
        url: pr.url || null,
        labels: Array.isArray(pr.labels) ? pr.labels.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean) : [],
      }));
      return { ok: true, provider: 'azure-devops', offline: false, items };
    },
    inspectCiStatus(opts = {}) {
      const args = ['pipelines', 'runs', 'list', '--top', String(opts.limit || 10), '--output', 'json'];
      if (opts.branch) args.push('--branch', String(opts.branch));
      const r = runCliJson(spawn, 'az', args, rootAbs);
      if (!r.ok) return { ok: false, provider: 'azure-devops', offline: false, runs: [], error: r.error };
      const runs = (Array.isArray(r.data) ? r.data : []).map((run) => {
        const res = String(run.result || '').toLowerCase();
        const conclusion = res === 'succeeded' ? 'success' : (res === 'failed' ? 'failure' : (res || null));
        return {
          id: run.id || null,
          status: String(run.status || 'unknown').toLowerCase(),
          conclusion,
          branch: String(run.sourceBranch || opts.branch || '').replace(/^refs\/heads\//, '') || null,
          url: run.url || null,
        };
      });
      return { ok: true, provider: 'azure-devops', offline: false, runs };
    },
    listReleaseAssets(tag) {
      const r = runCliJson(spawn, 'az', ['pipelines', 'runs', 'artifact', 'list', '--run-id', String(tag), '--output', 'json'], rootAbs);
      if (!r.ok) return { ok: false, provider: 'azure-devops', offline: false, tag: String(tag), assets: [], error: r.error };
      const assets = (Array.isArray(r.data) ? r.data : []).map((a) => ({
        name: a.name || String(a.id || ''),
        url: (a.resource && a.resource.downloadUrl) || a.url || null,
      })).filter((a) => a.name);
      return { ok: true, provider: 'azure-devops', offline: false, tag: String(tag), draft: false, assets };
    },
  };
}

function buildLocalAdapter() {
  return {
    provider: 'local',
    offline: true,
    listPullRequests() {
      return { ok: true, provider: 'local', offline: true, items: [], note: 'modo local offline — nenhum provedor remoto de PR/MR configurado' };
    },
    inspectCiStatus() {
      return { ok: true, provider: 'local', offline: true, runs: [], note: 'modo local offline — valide localmente via phase_gates e oxe-cc runtime verify' };
    },
    listReleaseAssets(tag) {
      return { ok: true, provider: 'local', offline: true, tag: String(tag || ''), draft: false, assets: [], note: 'modo local offline — sem release remota' };
    },
  };
}

function resolveCiAdapter(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const provider = detectCiProvider(rootAbs, options);
  const spawn = options.spawn || spawnSync;
  if (provider === 'github') return buildGithubAdapter(rootAbs, spawn);
  if (provider === 'gitlab') return buildGitlabAdapter(rootAbs, spawn);
  if (provider === 'azure-devops') return buildAzureDevopsAdapter(rootAbs, spawn);
  return buildLocalAdapter();
}

function inspectCiStatus(projectRoot, options = {}) {
  return resolveCiAdapter(projectRoot, options).inspectCiStatus(options);
}

function listReleaseAssets(projectRoot, tag, options = {}) {
  return resolveCiAdapter(projectRoot, options).listReleaseAssets(tag, options);
}

module.exports = {
  SUPPORTED_PROVIDERS,
  detectCiProvider,
  resolveCiAdapter,
  inspectCiStatus,
  listReleaseAssets,
};
