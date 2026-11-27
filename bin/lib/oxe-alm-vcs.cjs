'use strict';

/**
 * 1.23.0 (OXB-230-08): Native VCS Issue Tracker ALM adapters for GitHub Issues (`gh`)
 * and GitLab Issues (`glab`). Zero external npm dependencies, zero Jira calls, strict
 * dry-run read-only safety, and injectable `spawn` for deterministic unit/acceptance tests.
 */

const { spawnSync } = require('child_process');

function normIssueKey(key) {
  return String(key || '').trim().replace(/^#/, '');
}

function parseIssueNumberFromOutput(text) {
  const s = String(text || '').trim();
  const urlMatch = /\/issues\/(\d+)\b/.exec(s);
  if (urlMatch) return urlMatch[1];
  const bareMatch = /#?(\d+)\b/.exec(s);
  return bareMatch ? bareMatch[1] : null;
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function extractLabels(issue) {
  const raw = issue && Array.isArray(issue.labels) ? issue.labels : [];
  return raw.map((l) => (typeof l === 'string' ? l : (l && l.name ? String(l.name) : ''))).filter(Boolean);
}

function extractStatus(issue) {
  if (!issue || typeof issue !== 'object') return null;
  const st = String(issue.state || '').toLowerCase();
  if (st === 'closed') return 'closed';
  const labels = extractLabels(issue);
  const stageLabel = labels.find((l) => /^stage:/i.test(l));
  return stageLabel || (st || 'open');
}

function isClosingState(stateName) {
  return /^(?:closed|done|released|integrated|resolved)$/i.test(String(stateName || '').trim());
}

function checkVcsCli(cli, options = {}) {
  const spawn = options.spawn || spawnSync;
  const res = spawn(cli, ['--version'], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
  });
  const ok = Boolean(res && res.status === 0);
  const versionLine = ok ? String(res.stdout || res.stderr || '').split(/\r?\n/)[0].trim() : null;
  return { ok, cli, version: versionLine, error: ok ? null : String((res && (res.stderr || (res.error && res.error.message))) || `${cli} indisponível`).trim() };
}

function runCli(cli, args, options = {}) {
  const spawn = options.spawn || spawnSync;
  const res = spawn(cli, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs || 30000,
  });
  if (!res || res.status !== 0) {
    const detail = String((res && (res.stderr || res.stdout || (res.error && res.error.message))) || 'erro desconhecido').trim();
    throw Object.assign(new Error(`${cli} ${args.slice(0, 2).join(' ')} falhou: ${detail.slice(0, 300)}`), { fatal: true });
  }
  return String(res.stdout || '');
}

function assertWritable(readOnly, action) {
  if (readOnly) {
    throw Object.assign(new Error(`simulação: ${action} bloqueado (--dry-run nunca grava no ALM)`), { fatal: true, dryRunBlocked: true });
  }
}

function githubIssuesProvider(cfg, options = {}) {
  const repo = String((cfg && cfg.p && (cfg.p.repo || cfg.p.project)) || '').trim();
  const host = String((cfg && cfg.p && cfg.p.host) || 'https://github.com').replace(/\/+$/, '');
  const readOnly = Boolean(options.readOnly);
  const run = (args) => runCli('gh', args, options);

  return {
    name: 'github-issues',
    cli: 'gh',
    keyText: (key) => `#${normIssueKey(key)}`,
    url: (key) => `${host}/${repo}/issues/${normIssueKey(key)}`,
    async findByLabel(label) {
      const out = run(['issue', 'list', '--repo', repo, '--label', String(label), '--state', 'all', '--json', 'number,title,state,labels', '--limit', '2']);
      const list = parseJsonSafe(out);
      const first = Array.isArray(list) ? list[0] : null;
      if (!first || first.number == null) return null;
      const key = String(first.number);
      return { key, id: key, status: extractStatus(first) };
    },
    async create(item) {
      assertWritable(readOnly, 'gh issue create');
      const args = ['issue', 'create', '--repo', repo, '--title', String(item.title || 'OXE item').slice(0, 250), '--body', String(item.description || '')];
      const labels = [...new Set((item.labels || []).map((l) => String(l).trim()).filter(Boolean))];
      for (const lbl of labels) args.push('--label', lbl);
      const out = run(args);
      const num = parseIssueNumberFromOutput(out);
      if (!num) throw Object.assign(new Error(`gh issue create não retornou número de issue: ${out.slice(0, 200)}`), { fatal: true });
      return { key: num, id: num };
    },
    async read(key) {
      const num = normIssueKey(key);
      const out = run(['issue', 'view', num, '--repo', repo, '--json', 'number,title,state,labels']);
      const doc = parseJsonSafe(out);
      if (!doc) return null;
      const k = String(doc.number || num);
      return { key: k, id: k, status: extractStatus(doc), labels: extractLabels(doc) };
    },
    async status(key) {
      const r = await this.read(key);
      return r ? r.status : null;
    },
    async labels(key) {
      const r = await this.read(key);
      return (r && Array.isArray(r.labels)) ? r.labels : [];
    },
    async transition(key, stateName) {
      assertWritable(readOnly, 'gh issue transition');
      const num = normIssueKey(key);
      const target = String(stateName || '').trim();
      const closing = isClosingState(target);
      if (closing) {
        run(['issue', 'close', num, '--repo', repo]);
      } else {
        const label = /^stage:/i.test(target) ? target : `stage:${target.toLowerCase().replace(/\s+/g, '_')}`;
        run(['issue', 'edit', num, '--repo', repo, '--add-label', label]);
      }
      return { changed: true, status: closing ? 'closed' : target };
    },
    async comment(key, text) {
      assertWritable(readOnly, 'gh issue comment');
      run(['issue', 'comment', normIssueKey(key), '--repo', repo, '--body', String(text || '')]);
    },
    async link(key, otherKey) {
      assertWritable(readOnly, 'gh issue comment (link)');
      run(['issue', 'comment', normIssueKey(key), '--repo', repo, '--body', `Relacionado a #${normIssueKey(otherKey)}`]);
    },
    async remoteLink(key, url, title) {
      assertWritable(readOnly, 'gh issue comment (remoteLink)');
      run(['issue', 'comment', normIssueKey(key), '--repo', repo, '--body', `[${title || url}](${url})`]);
      return { linked: true };
    },
    async addLabels(key, labels) {
      assertWritable(readOnly, 'gh issue edit --add-label');
      const args = ['issue', 'edit', normIssueKey(key), '--repo', repo];
      for (const l of labels) args.push('--add-label', String(l));
      run(args);
    },
    async removeLabels(key, labels) {
      assertWritable(readOnly, 'gh issue edit --remove-label');
      const args = ['issue', 'edit', normIssueKey(key), '--repo', repo];
      for (const l of labels) args.push('--remove-label', String(l));
      run(args);
    },
    async releaseVersion() {
      return { changed: false, note: 'GitHub Issues usa milestones/releases do repositório' };
    },
  };
}

function gitlabIssuesProvider(cfg, options = {}) {
  const repo = String((cfg && cfg.p && (cfg.p.repo || cfg.p.project)) || '').trim();
  const host = String((cfg && cfg.p && cfg.p.host) || 'https://gitlab.com').replace(/\/+$/, '');
  const readOnly = Boolean(options.readOnly);
  const run = (args) => runCli('glab', args, options);

  return {
    name: 'gitlab-issues',
    cli: 'glab',
    keyText: (key) => `#${normIssueKey(key)}`,
    url: (key) => `${host}/${repo}/-/issues/${normIssueKey(key)}`,
    async findByLabel(label) {
      const out = run(['issue', 'list', '--repo', repo, '--label', String(label), '--all', '--output', 'json', '--per-page', '2']);
      const list = parseJsonSafe(out);
      const first = Array.isArray(list) ? list[0] : null;
      const num = first && (first.iid != null ? first.iid : first.id);
      if (num == null) return null;
      const key = String(num);
      return { key, id: key, status: extractStatus(first) };
    },
    async create(item) {
      assertWritable(readOnly, 'glab issue create');
      const args = ['issue', 'create', '--repo', repo, '--title', String(item.title || 'OXE item').slice(0, 250), '--description', String(item.description || ''), '--yes'];
      const labels = [...new Set((item.labels || []).map((l) => String(l).trim()).filter(Boolean))];
      if (labels.length) args.push('--label', labels.join(','));
      const out = run(args);
      const num = parseIssueNumberFromOutput(out);
      if (!num) throw Object.assign(new Error(`glab issue create não retornou iid da issue: ${out.slice(0, 200)}`), { fatal: true });
      return { key: num, id: num };
    },
    async read(key) {
      const num = normIssueKey(key);
      const out = run(['issue', 'view', num, '--repo', repo, '--output', 'json']);
      const doc = parseJsonSafe(out);
      if (!doc) return null;
      const k = String(doc.iid != null ? doc.iid : (doc.number || num));
      return { key: k, id: k, status: extractStatus(doc), labels: extractLabels(doc) };
    },
    async status(key) {
      const r = await this.read(key);
      return r ? r.status : null;
    },
    async labels(key) {
      const r = await this.read(key);
      return (r && Array.isArray(r.labels)) ? r.labels : [];
    },
    async transition(key, stateName) {
      assertWritable(readOnly, 'glab issue transition');
      const num = normIssueKey(key);
      const target = String(stateName || '').trim();
      const closing = isClosingState(target);
      if (closing) {
        run(['issue', 'close', num, '--repo', repo]);
      } else {
        const label = /^stage:/i.test(target) ? target : `stage:${target.toLowerCase().replace(/\s+/g, '_')}`;
        run(['issue', 'update', num, '--repo', repo, '--label', label]);
      }
      return { changed: true, status: closing ? 'closed' : target };
    },
    async comment(key, text) {
      assertWritable(readOnly, 'glab issue note');
      run(['issue', 'note', normIssueKey(key), '--repo', repo, '--message', String(text || '')]);
    },
    async link(key, otherKey) {
      assertWritable(readOnly, 'glab issue note (link)');
      run(['issue', 'note', normIssueKey(key), '--repo', repo, '--message', `Relacionado a #${normIssueKey(otherKey)}`]);
    },
    async remoteLink(key, url, title) {
      assertWritable(readOnly, 'glab issue note (remoteLink)');
      run(['issue', 'note', normIssueKey(key), '--repo', repo, '--message', `[${title || url}](${url})`]);
      return { linked: true };
    },
    async addLabels(key, labels) {
      assertWritable(readOnly, 'glab issue update --label');
      run(['issue', 'update', normIssueKey(key), '--repo', repo, '--label', labels.join(',')]);
    },
    async removeLabels(key, labels) {
      assertWritable(readOnly, 'glab issue update --unlabel');
      run(['issue', 'update', normIssueKey(key), '--repo', repo, '--unlabel', labels.join(',')]);
    },
    async releaseVersion() {
      return { changed: false, note: 'GitLab Issues usa milestones/releases do repositório' };
    },
  };
}

module.exports = {
  githubIssuesProvider,
  gitlabIssuesProvider,
  checkVcsCli,
  normIssueKey,
  parseIssueNumberFromOutput,
};
