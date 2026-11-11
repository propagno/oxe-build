'use strict';

/**
 * OXB-204: safe dirty-tree inspection, JSON/TS syntax validation, and scoped reset when an executor
 * dies mid-task (e.g. network drop / 429 RESOURCE_EXHAUSTED).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeScratchMatcher } = require('./oxe-scratch.cjs');

function normalizeRel(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function unquotePorcelainPath(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
}

function isPathInScope(relPath, scopeList) {
  const f = normalizeRel(relPath);
  if (!f) return false;
  for (const raw of scopeList || []) {
    const s = normalizeRel(raw);
    if (!s) continue;
    if (/[*?[{]/.test(s)) {
      const re = new RegExp(
        `^${s
          .replace(/[.+^$()|\\]/g, '\\$&')
          .replace(/\*\*\/?/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\u0000/g, '.*')}$`
      );
      if (re.test(f)) return true;
    } else {
      const clean = s.replace(/\/+$/, '');
      if (clean && (f === clean || f.startsWith(`${clean}/`))) return true;
    }
  }
  return false;
}

const defaultIsPathInScope = isPathInScope;

function validateTouchedFileSyntax(projectRoot, relPath) {
  const rel = normalizeRel(relPath);
  const abs = path.join(projectRoot, rel);
  if (!fs.existsSync(abs)) {
    return { path: rel, valid: true, kind: 'deleted', error: null };
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return { path: rel, valid: false, kind: 'io', error: String(err && err.message ? err.message : err) };
  }
  if (!stat.isFile()) {
    return { path: rel, valid: true, kind: 'directory', error: null };
  }

  const ext = path.extname(rel).toLowerCase();
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { path: rel, valid: false, kind: 'io', error: String(err && err.message ? err.message : err) };
  }

  if (ext === '.json') {
    if (!raw.trim()) {
      return { path: rel, valid: false, kind: 'json', error: 'JSON vazio ou truncado' };
    }
    try {
      JSON.parse(raw);
      return { path: rel, valid: true, kind: 'json', error: null };
    } catch (err) {
      return { path: rel, valid: false, kind: 'json', error: String(err && err.message ? err.message : err) };
    }
  }

  if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    let ts;
    try {
      ts = require('typescript');
    } catch {
      return { path: rel, valid: true, kind: 'ts_skipped', error: null };
    }
    const result = ts.transpileModule(raw, {
      fileName: rel,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.Latest,
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
      },
    });
    const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      const first = errors[0];
      const msg = ts.flattenDiagnosticMessageText(first.messageText, ' ');
      let loc = '';
      if (first.file && typeof first.start === 'number') {
        const pos = first.file.getLineAndCharacterOfPosition(first.start);
        loc = `:${pos.line + 1}:${pos.character + 1}`;
      }
      return { path: rel, valid: false, kind: 'ts', error: `${rel}${loc} — ${msg}` };
    }
    return { path: rel, valid: true, kind: 'ts', error: null };
  }

  return { path: rel, valid: true, kind: 'other', error: null };
}

function collectDirtyDiffs(projectRoot) {
  const isScratch = makeScratchMatcher(projectRoot);
  const statusRes = spawnSync('git', ['status', '--porcelain', '-uall'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (statusRes.status !== 0) return [];

  const numstatMap = new Map();
  const diffRes = spawnSync('git', ['diff', '--numstat', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diffRes.status === 0 && diffRes.stdout) {
    for (const line of diffRes.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parts[0] === '-' ? null : Number(parts[0]);
      const deleted = parts[1] === '-' ? null : Number(parts[1]);
      const filePart = normalizeRel(unquotePorcelainPath(parts.slice(2).join('\t')));
      numstatMap.set(filePart, { added, deleted });
    }
  }

  const out = [];
  const seen = new Set();
  for (const line of String(statusRes.stdout || '').split(/\r?\n/)) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rawPath = line.slice(3);
    if (rawPath.includes(' -> ')) {
      rawPath = rawPath.split(' -> ').pop();
    }
    const rel = normalizeRel(unquotePorcelainPath(rawPath));
    if (!rel || seen.has(rel)) continue;
    if (rel === '.oxe' || rel.startsWith('.oxe/')) continue;
    if (isScratch(rel)) continue;
    seen.add(rel);

    const code = xy.trim() || 'M';
    let stats = numstatMap.get(rel) || null;
    if (!stats && code === '??') {
      try {
        const content = fs.readFileSync(path.join(projectRoot, rel), 'utf8');
        const lines = content ? content.split(/\r?\n/).length : 0;
        stats = { added: lines, deleted: 0 };
      } catch {
        stats = { added: null, deleted: null };
      }
    }
    const added = stats && Number.isFinite(stats.added) ? stats.added : null;
    const deleted = stats && Number.isFinite(stats.deleted) ? stats.deleted : null;
    const summary = code === '??'
      ? `untracked${added != null ? ` (+${added} linhas)` : ''}`
      : `${code}${added != null || deleted != null ? ` (+${added ?? 0}/-${deleted ?? 0})` : ''}`;

    out.push({ path: rel, status: code, added, deleted, summary });
  }
  return out;
}

function findInProgressTasks(planDoc, events) {
  const tasksById = new Map();
  for (const t of (planDoc && Array.isArray(planDoc.tasks) ? planDoc.tasks : [])) {
    if (t && t.id) tasksById.set(t.id, t);
  }

  const eventState = new Map();
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== 'object') continue;
    const payload = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    const id = payload.task || ev.work_item_id || null;
    if (!id) continue;
    if (ev.type === 'TaskStarted') {
      eventState.set(id, {
        in_progress: true,
        executor: payload.executor || null,
        base_sha: payload.base_sha || null,
        started_at: ev.timestamp || null,
      });
    } else if (ev.type === 'TaskCompleted' || ev.type === 'WorkItemCompleted' || ev.type === 'TaskReset') {
      eventState.set(id, { in_progress: false });
    }
  }

  const found = [];
  const seen = new Set();
  for (const [id, t] of tasksById.entries()) {
    if (t.done === true || t.status === 'done') continue;
    const ev = eventState.get(id);
    if (t.status === 'in_progress' || (ev && ev.in_progress)) {
      seen.add(id);
      found.push({
        id,
        title: t.title || null,
        files: Array.isArray(t.files) ? [...t.files] : [],
        executor: t.executor || (ev && ev.executor) || null,
        base_sha: t.base_sha || (ev && ev.base_sha) || null,
        started_at: t.started_at || (ev && ev.started_at) || null,
      });
    }
  }

  for (const [id, ev] of eventState.entries()) {
    if (!ev.in_progress || seen.has(id)) continue;
    const t = tasksById.get(id);
    if (t && (t.done === true || t.status === 'done')) continue;
    found.push({
      id,
      title: (t && t.title) || null,
      files: t && Array.isArray(t.files) ? [...t.files] : [],
      executor: ev.executor || null,
      base_sha: ev.base_sha || null,
      started_at: ev.started_at || null,
    });
  }

  return found;
}

function inspectDirtyResume(projectRoot, planDoc, events, isPathInScope = defaultIsPathInScope) {
  const inProgressTasks = findInProgressTasks(planDoc, events);
  const dirtyFiles = collectDirtyDiffs(projectRoot);
  if (!inProgressTasks.length || !dirtyFiles.length) {
    return {
      has_dirty_in_progress: false,
      tasks: inProgressTasks,
      active_task: inProgressTasks[0] || null,
      dirty_files: dirtyFiles,
      in_scope: [],
      out_of_scope: dirtyFiles,
      validation: [],
      invalid_files: [],
    };
  }

  const activeTask = inProgressTasks[0];
  const combinedScope = inProgressTasks.flatMap((t) => t.files || []);
  const inScope = [];
  const outOfScope = [];
  for (const entry of dirtyFiles) {
    if (isPathInScope(entry.path, activeTask.files || combinedScope)) {
      inScope.push(entry);
    } else {
      outOfScope.push(entry);
    }
  }

  const validation = dirtyFiles.map((entry) => ({
    ...validateTouchedFileSyntax(projectRoot, entry.path),
    in_scope: inScope.some((x) => x.path === entry.path),
  }));
  const invalidFiles = validation.filter((v) => !v.valid);

  return {
    has_dirty_in_progress: true,
    tasks: inProgressTasks,
    active_task: activeTask,
    dirty_files: dirtyFiles,
    in_scope: inScope,
    out_of_scope: outOfScope,
    validation,
    invalid_files: invalidFiles,
  };
}

function resetTaskFiles(projectRoot, baseSha, inScopeDiffs) {
  const ref = baseSha && /^[0-9a-f]{7,40}$/i.test(String(baseSha)) ? String(baseSha) : 'HEAD';
  const discarded = [];
  for (const item of inScopeDiffs || []) {
    const rel = normalizeRel(typeof item === 'string' ? item : item.path);
    if (!rel) continue;
    const cat = spawnSync('git', ['cat-file', '-e', `${ref}:${rel}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (cat.status === 0) {
      spawnSync('git', ['checkout', ref, '--', rel], {
        cwd: projectRoot,
        encoding: 'utf8',
        windowsHide: true,
      });
    } else {
      spawnSync('git', ['rm', '-f', '--cached', '--ignore-unmatch', '--', rel], {
        cwd: projectRoot,
        encoding: 'utf8',
        windowsHide: true,
      });
      try {
        fs.rmSync(path.join(projectRoot, rel), { force: true });
      } catch { /* ignore */ }
    }
    discarded.push(rel);
  }
  return discarded;
}

module.exports = {
  isPathInScope,
  validateTouchedFileSyntax,
  collectDirtyDiffs,
  findInProgressTasks,
  inspectDirtyResume,
  resetTaskFiles,
};
