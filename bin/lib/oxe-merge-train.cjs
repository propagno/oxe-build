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

const TRAIN_RE = /^\s*merge-train:\s*(.+)$/im;

/** The train state from labels and the latest merge-train comment. */
function trainState(pr) {
  if (!pr) return { state: 'unknown' };
  if (String(pr.state || '').toUpperCase() === 'MERGED') return { state: 'merged' };
  const labels = (pr.labels || []).map((l) => String(l.name || l).toLowerCase());
  const comments = (pr.comments || []).map((c) => String(c.body || c)).filter((b) => TRAIN_RE.test(b));
  const last = comments.length ? TRAIN_RE.exec(comments[comments.length - 1])[1].trim().toLowerCase() : '';
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

/**
 * Re-syncs one PR that left the train. ctx: { root, item, verifyCommand, reopen(task), spawn }.
 * Returns the steps done; stops at the first failure (nothing is pushed after a red verify or a conflicted merge).
 */
function resync(ctx) {
  const spawn = ctx.spawn || spawnSync;
  const run = (cmd, args, cwd) => spawn(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const steps = [];
  const item = ctx.item;
  if (item.state !== 'left') return { steps: [{ step: 'skip', why: `estado ${item.state}: só um PR que saiu do trem é sincronizado` }], ok: false };
  if (ctx.reopen) { ctx.reopen(item.task); steps.push({ step: 'reopen', ok: true }); }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-train-'));
  const add = run('git', ['worktree', 'add', ws, item.branch], ctx.root);
  if (add.status !== 0) { fs.rmSync(ws, { recursive: true, force: true }); return { steps: [...steps, { step: 'worktree', ok: false, error: String(add.stderr).trim() }], ok: false }; }
  try {
    run('git', ['fetch', 'origin', item.base], ctx.root);
    const m = run('git', ['merge', '--no-edit', `origin/${item.base}`], ws);
    steps.push({ step: `merge origin/${item.base}`, ok: m.status === 0 });
    if (m.status !== 0) { run('git', ['merge', '--abort'], ws); return { steps, ok: false, why: 'conflito no merge da base — resolva à mão; nada foi enviado' }; }
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
