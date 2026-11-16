'use strict';

/**
 * OXB-102: merge-train awareness. For each task PR the promote opened (TaskPromoted events, `pr` URL or branch), the
 * train status reads the PR (`gh pr view --json state,labels,comments,headRefName,url`) and its latest `merge-train:`
 * comment (queued / car N / removed <reason> / merged).
 *  - `oxe-cc runtime train status` — read-only: per task, the train state and what would be done.
 *  - `oxe-cc runtime train sync [--apply]` — for a PR that LEFT the train (removed/kicked/dequeued, or a
 *    `merge-train:removed` label): reopen the task in PLAN.json, merge the base into its branch in a temporary worktree,
 *    run the task's verify there, push (never force) and relabel (`--remove-label merge-train:removed --add-label
 *    merge-train`). Without --apply it only prints the plan.
 * Never pushes to a PR that is queued or riding a car; never deletes a branch or a tag; never merges the PR itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TRAIN_RE_GLOBAL = /^\s*merge-train:\s*(.+)$/gim;

/** The train state from labels and the latest merge-train comment. */
function trainState(pr) {
  if (!pr) return { state: 'unknown' };
  if (String(pr.state || '').toUpperCase() === 'MERGED') return { state: 'merged' };
  const labels = (pr.labels || []).map((l) => String(l.name || l).toLowerCase());
  const directives = [];
  for (const c of pr.comments || []) {
    for (const m of String(c && (c.body || c)).matchAll(TRAIN_RE_GLOBAL)) directives.push(m[1].trim().toLowerCase());
  }
  const last = directives.length ? directives[directives.length - 1] : '';
  if (/merged|mergeado/.test(last)) return { state: 'merged', note: last };
  if (/removed|kicked|dequeued|ejected|saiu|removido/.test(last) || labels.includes('merge-train:removed')) return { state: 'left', note: last || 'label merge-train:removed' };
  if (/car\s*\d+|vag[aã]o|riding|testing/.test(last)) return { state: 'riding', note: last };
  if (/queued|na fila|enfileirado/.test(last) || labels.includes('merge-train')) return { state: 'queued', note: last || 'label merge-train' };
  return { state: 'none', note: last || null };
}

function promotedTasks(events) {
  const byTask = new Map();
  for (const e of events) if (e && e.type === 'TaskPromoted' && e.work_item_id) byTask.set(e.work_item_id, e.payload || {});
  return [...byTask.entries()].map(([task, p]) => ({ task, branch: p.branch || null, pr: p.pr || null, base: p.base || 'main' }));
}

function readPr(root, ref, spawn) {
  const r = spawn('gh', ['pr', 'view', String(ref), '--json', 'state,labels,comments,headRefName,url'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return { error: String(r.stderr || '').trim().slice(0, 200) };
  try { return JSON.parse(r.stdout); } catch { return { error: 'resposta do gh ilegível' }; }
}

function status(root, events, options = {}) {
  const spawn = options.spawn || spawnSync;
  return promotedTasks(events).map((t) => {
    const pr = t.pr || t.branch ? readPr(root, t.pr || t.branch, spawn) : null;
    const st = pr && !pr.error ? trainState(pr) : { state: 'unknown', note: pr && pr.error };
    const action = st.state === 'left' ? 'reabrir, merge da base, verify, push e relabel' : st.state === 'queued' || st.state === 'riding' ? 'nada (o PR está no trem — nunca empurrar)' : 'nada';
    return { ...t, branch: (pr && pr.headRefName) || t.branch, url: (pr && pr.url) || t.pr, ...st, action };
  });
}

function loadConfigFallback(dir) {
  let merged = {};
  for (const rel of ['oxe.config.json', path.join('.oxe', 'config.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
      if (parsed && typeof parsed === 'object') merged = { ...merged, ...parsed, lint: { ...(merged.lint || {}), ...(parsed.lint || {}) } };
    } catch { /* optional */ }
  }
  return merged;
}

/**
 * Re-syncs one PR that left the train. ctx: { root, item, verifyCommand, config?, reopen(task), spawn }.
 * Auto-resolves cap-only merge conflicts on `lint.ratchets` files and recalculates `cap = realCount` on the merged
 * tree before running `verify` (OXB-C2 Adendo 16/11 06:10Z: frozen design-lint tests require `cap === count`).
 * Returns the steps done; stops at the first failure (nothing is pushed after a red verify or a conflicted merge).
 */
function resync(ctx) {
  const spawn = ctx.spawn || spawnSync;
  const run = (cmd, args, cwd, extra = {}) => spawn(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...extra });
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const steps = [];
  const item = ctx.item;
  if (item.state !== 'left') return { steps: [{ step: 'skip', why: `estado ${item.state}: só um PR que saiu do trem é sincronizado` }], ok: false };
  if (ctx.reopen) { ctx.reopen(item.task); steps.push({ step: 'reopen', ok: true }); }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-train-'));
  const add = run('git', ['worktree', 'add', '--detach', ws, item.branch], ctx.root);
  if (add.status !== 0) { fs.rmSync(ws, { recursive: true, force: true }); return { steps: [...steps, { step: 'worktree', ok: false, error: String(add.stderr).trim() }], ok: false }; }
  try {
    run('git', ['fetch', 'origin', item.base], ctx.root);
    const ratchetsLib = require('./oxe-ratchets.cjs');
    const localWsCfg = loadConfigFallback(ws);
    const localRootCfg = loadConfigFallback(ctx.root);
    const cfg = (ctx.config && Object.keys(ctx.config).length) ? ctx.config : (Object.keys(localWsCfg).length ? localWsCfg : localRootCfg);
    const ratchets = ratchetsLib.ratchetsOf(cfg);
    const ratchetFileSet = new Set(ratchets.map((r) => norm(r.file)));

    const prLog = run('git', ['log', '-1', '--format=%B', 'HEAD'], ws);
    const prTrailers = String(prLog.stdout || '').split(/\r?\n/).filter((l) => /^OXE-[A-Za-z-]+:\s*\S/.test(l));
    const mbRes = ratchets.length ? run('git', ['merge-base', 'HEAD', `origin/${item.base}`], ws) : { status: 1, stdout: '' };
    const mergeBase = mbRes.status === 0 ? String(mbRes.stdout || '').trim() : null;

    const m = run('git', ['merge', '--no-edit', `origin/${item.base}`], ws);
    let mergeOk = m.status === 0;
    let ratchetConflictResolved = false;

    if (!mergeOk && ratchets.length && mergeBase) {
      const uRes = run('git', ['diff', '--name-only', '--diff-filter=U'], ws);
      const unmerged = String(uRes.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (unmerged.length && unmerged.every((f) => ratchetFileSet.has(norm(f)))) {
        let canAutoResolve = true;
        for (const f of unmerged) {
          const nf = norm(f);
          const baseShow = run('git', ['show', `${mergeBase}:${nf}`], ws);
          const oursShow = run('git', ['show', `:2:${nf}`], ws);
          const theirsShow = run('git', ['show', `:3:${nf}`], ws);
          if (baseShow.status !== 0 || oursShow.status !== 0 || theirsShow.status !== 0) { canAutoResolve = false; break; }
          const oursCapOnly = ratchetsLib.onlyCapChanged(baseShow.stdout, oursShow.stdout, cfg, nf);
          const theirsCapOnly = ratchetsLib.onlyCapChanged(baseShow.stdout, theirsShow.stdout, cfg, nf);
          if (oursCapOnly) {
            if (run('git', ['checkout', '--theirs', '--', nf], ws).status !== 0) { canAutoResolve = false; break; }
          } else if (theirsCapOnly) {
            if (run('git', ['checkout', '--ours', '--', nf], ws).status !== 0) { canAutoResolve = false; break; }
          } else {
            canAutoResolve = false;
            break;
          }
        }
        if (canAutoResolve && run('git', ['add', '--', ...unmerged], ws).status === 0) {
          const fin = run('git', ['-c', 'core.editor=true', 'commit', '--no-edit'], ws, { env: { ...process.env, GIT_EDITOR: 'true' } });
          if (fin.status === 0) {
            mergeOk = true;
            ratchetConflictResolved = true;
          }
        }
      }
    }

    steps.push({ step: `merge origin/${item.base}`, ok: mergeOk });
    if (!mergeOk) { run('git', ['merge', '--abort'], ws); return { steps, ok: false, why: 'conflito no merge da base — resolva à mão; nada foi enviado' }; }

    if (ratchets.length) {
      const changedSinceMb = mergeBase
        ? new Set(String(run('git', ['diff', '--name-only', mergeBase, 'HEAD'], ws).stdout || '').split(/\r?\n/).map(norm).filter(Boolean))
        : new Set();
      const adjusted = [];
      const updatedFiles = new Set();
      for (const r of ratchets) {
        const abs = path.join(ws, r.file);
        if (!fs.existsSync(abs)) continue;
        let text = '';
        try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
        const cap = ratchetsLib.capOf(text, r);
        if (!cap) continue;
        const realCount = ratchetsLib.countOf(ws, r);
        if (cap.value === realCount) continue;
        const mbShow = mergeBase ? run('git', ['show', `${mergeBase}:${norm(r.file)}`], ws) : { status: 1, stdout: '' };
        const mbCap = mbShow.status === 0 ? ratchetsLib.capOf(mbShow.stdout, r) : null;
        const violated = r.direction === 'down' ? cap.value < realCount : cap.value > realCount;
        if (!ratchetConflictResolved && !changedSinceMb.has(norm(r.file)) && !violated && !(mbCap && mbCap.value !== realCount)) continue;
        const nextText = text.slice(0, cap.index) + String(realCount) + text.slice(cap.index + cap.length);
        fs.writeFileSync(abs, nextText, 'utf8');
        updatedFiles.add(norm(r.file));
        adjusted.push({ file: norm(r.file), line: cap.line, from: cap.value, to: realCount });
      }
      if (updatedFiles.length || updatedFiles.size) {
        run('git', ['add', '--', ...updatedFiles], ws);
        const commitArgs = ['commit', '-q', '-m', `chore(ratchet): recalculate ratchet cap after merge with ${item.base}`, '-m', adjusted.map((a) => `${a.file}:${a.line} ${a.from} -> ${a.to}`).join('\n')];
        if (prTrailers.length) commitArgs.push('-m', prTrailers.join('\n'));
        const rc = run('git', commitArgs, ws);
        steps.push({ step: 'ratchet', ok: rc.status === 0, adjusted });
        if (rc.status !== 0) return { steps, ok: false, why: 'falha ao commitar recálculo de ratchet após merge da base' };
      }
    }

    if (ctx.verifyCommand) {
      const v = spawn(ctx.verifyCommand, { cwd: ws, shell: true, encoding: 'utf8', windowsHide: true, timeout: 30 * 60_000 });
      steps.push({ step: 'verify', ok: v.status === 0 });
      if (v.status !== 0) return { steps, ok: false, why: 'verify vermelho depois do merge da base — nada foi enviado' };
    }
    const p = run('git', ['push', 'origin', `HEAD:${item.branch}`], ws);
    steps.push({ step: 'push (sem force)', ok: p.status === 0 });
    if (p.status !== 0) return { steps, ok: false, why: String(p.stderr).trim().slice(0, 200) };
    const l = run('gh', ['pr', 'edit', String(item.url || item.branch), '--remove-label', 'merge-train:removed', '--add-label', 'merge-train'], ctx.root);
    steps.push({ step: 'relabel', ok: l.status === 0 });
    return { steps, ok: l.status === 0 };
  } finally {
    run('git', ['worktree', 'remove', ws], ctx.root);
    if (fs.existsSync(ws)) { run('git', ['worktree', 'prune'], ctx.root); }
  }
}

module.exports = { trainState, promotedTasks, status, resync };
