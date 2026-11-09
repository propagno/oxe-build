'use strict';

/**
 * OXB-113: context slack of the orchestrator (the agent driving the OXE flow).
 *  - `oxe-cc runtime context --used <tokens> --limit <tokens>` (called by a host hook, e.g. a PreCompact or a
 *    per-turn hook) records the usage and warns at the thresholds (70% warn, 85% critical); at critical it writes the
 *    handoff on its own.
 *  - `oxe-cc runtime handoff [--note "…"]` writes `.oxe/HANDOFF.md` (+ .json): everything a fresh session needs to
 *    resume without re-reading the conversation — the phase, the run, what is done / failed / pending, the failed
 *    checkpoints, the open CRs and defects, the git state and the next command.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const THRESHOLDS = { warn: 0.7, critical: 0.85 };

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/**
 * @param {object} snap — { phase, run, work, changes, defects, plan } gathered by the caller (operational)
 */
function buildHandoff(projectRoot, snap, options = {}) {
  const branch = git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(projectRoot, ['log', '-1', '--format=%h %s']);
  const dirty = git(projectRoot, ['status', '--porcelain', '-uall']).split(/\r?\n/).filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()).filter((p) => !/^\.oxe\//.test(p));
  const tasks = (snap.plan && snap.plan.tasks) || [];
  const cpFailed = tasks.filter((t) => t && !t.done && t.checkpoint_failed).map((t) => ({ id: t.id, kind: t.checkpoint_failed.kind || null, reason: String(t.checkpoint_failed.reason || '').slice(0, 200) }));
  const data = {
    schema_version: 1,
    at: new Date().toISOString(),
    reason: options.reason || 'manual',
    note: options.note || null,
    context: options.context || null,
    phase: snap.phase || null,
    git: { branch, head, dirty: dirty.slice(0, 40), dirty_count: dirty.length },
    run: snap.run ? { id: snap.run.run_id || null, status: snap.run.status || null } : null,
    work: snap.work || null,
    checkpoint_failed: cpFailed,
    open_crs: (snap.changes || []).filter((c) => c.status === 'open').map((c) => ({ id: c.id, class: c.class, summary: c.summary })),
    open_defects: (snap.defects || []).map((d) => d.id),
    next: (snap.work && snap.work.next_steps) || [],
  };
  return data;
}

function renderHandoff(d) {
  const L = ['# HANDOFF', '', `Gerado em ${d.at} (${d.reason})${d.context ? ` · contexto ${Math.round(d.context.ratio * 100)}% (${d.context.used}/${d.context.limit})` : ''}`, ''];
  if (d.note) L.push(`> ${d.note}`, '');
  L.push('## Onde estamos', '');
  L.push(`- Fase: ${d.phase || '—'}`);
  L.push(`- Git: ${d.git.branch} @ ${d.git.head}${d.git.dirty_count ? ` · ${d.git.dirty_count} arquivo(s) sujo(s) fora de .oxe/` : ' · árvore limpa'}`);
  if (d.run) L.push(`- Run: ${d.run.id || '—'} (${d.run.status || '—'})`);
  if (d.work) L.push(`- Tarefas: ${d.work.done.length}/${d.work.total} done · pendentes: ${d.work.pending.join(', ') || '—'}${d.work.external_pending.length ? ` · externas: ${d.work.external_pending.join(', ')}` : ''}`);
  if (d.checkpoint_failed.length) {
    L.push('', '## Checkpoints falhos (não done)', '');
    for (const c of d.checkpoint_failed) L.push(`- ${c.id}${c.kind ? ` [${c.kind}]` : ''}: ${c.reason}`);
  }
  if (d.open_crs.length) {
    L.push('', '## CRs abertos', '');
    for (const c of d.open_crs) L.push(`- ${c.id} (${c.class}): ${c.summary}`);
  }
  if (d.open_defects.length) L.push('', `## Defeitos abertos: ${d.open_defects.length} (oxe-cc runtime defects)`);
  if (d.git.dirty.length) {
    L.push('', '## Arquivos sujos', '');
    for (const f of d.git.dirty.slice(0, 20)) L.push(`- \`${f}\``);
  }
  L.push('', '## Próximo passo', '');
  if (d.next.length) for (const n of d.next) L.push(`- \`${n}\``);
  else L.push('- `oxe-cc runtime status`');
  L.push('', 'Uma sessão nova lê este arquivo e o .oxe/STATE.md antes de qualquer ação (o /oxe faz isso).');
  return `${L.join('\n')}\n`;
}

function writeHandoff(projectRoot, data) {
  const dir = path.join(projectRoot, '.oxe');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'HANDOFF.json'), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'HANDOFF.md'), renderHandoff(data));
  return { md: '.oxe/HANDOFF.md', json: '.oxe/HANDOFF.json' };
}

/** Classifies a context reading. @returns {{ level: 'ok'|'warn'|'critical', ratio, used, limit }} */
function contextLevel(used, limit, thresholds = THRESHOLDS) {
  const u = Number(used);
  const l = Number(limit);
  if (!(u >= 0) || !(l > 0)) throw new Error('informe --used <tokens> e --limit <tokens> (números)');
  const ratio = u / l;
  return { level: ratio >= thresholds.critical ? 'critical' : ratio >= thresholds.warn ? 'warn' : 'ok', ratio: Math.round(ratio * 1000) / 1000, used: u, limit: l };
}

module.exports = { THRESHOLDS, buildHandoff, renderHandoff, writeHandoff, contextLevel };
