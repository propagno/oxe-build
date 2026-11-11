'use strict';

/**
 * OXB-145: one stable place that says "this run needs someone". Every pause that needs a person (environment, quota,
 * a question waiting for an answer, a pending gate, a repair proposal, a deferred task) raises an item: what stopped,
 * why, the command that resolves it and who owns it. Open items are rendered to `.oxe/ATTENTION.md` (deleted when none
 * is open); `.oxe/attention.ndjson` keeps the log. The configured `attention.notify` command (with `{summary}`) runs
 * ONCE per item — the same pause raised again does not notify twice. `runtime attention resolve <id> --by <role>`
 * closes it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LOG = (root) => path.join(root, '.oxe', 'attention.ndjson');
const MD = (root) => path.join(root, '.oxe', 'ATTENTION.md');

function read(root) {
  let raw = '';
  try { raw = fs.readFileSync(LOG(root), 'utf8'); } catch { return []; }
  const byId = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind === 'raised') byId.set(r.id, { ...r, status: 'open' });
      else if (r.kind === 'resolved' && byId.has(r.id)) Object.assign(byId.get(r.id), { status: 'resolved', resolved_by: r.by, resolved_at: r.at });
    } catch { /* */ }
  }
  return [...byId.values()];
}
const open = (root) => read(root).filter((x) => x.status === 'open');

function render(root) {
  const items = open(root);
  if (!items.length) { try { fs.rmSync(MD(root), { force: true }); } catch { /* */ } return null; }
  const lines = ['# ATENÇÃO — a execução precisa de alguém', ''];
  for (const x of items) {
    lines.push(`## ${x.id} — ${x.what}`, '', `- **Por quê:** ${x.why}`, `- **Resolver:** \`${x.command}\``, `- **Dono:** ${x.owner}`, `- **Desde:** ${x.at}`, `- **Fechar este aviso:** \`oxe-cc runtime attention resolve ${x.id} --by <papel>\``, '');
  }
  fs.mkdirSync(path.dirname(MD(root)), { recursive: true });
  fs.writeFileSync(MD(root), lines.join('\n'));
  return MD(root);
}

function notify(root, cfg, item) {
  const cmd = cfg && cfg.attention && cfg.attention.notify;
  if (!cmd) return null;
  const summary = `[OXE] ${item.what} — ${item.why} → ${item.command}`.replace(/["`$]/g, "'");
  const env = { ...process.env, OXE_ATTENTION_ID: item.id, OXE_ATTENTION_SUMMARY: summary };
  for (const k of Object.keys(env)) if (/^OXESPACE_/i.test(k)) delete env[k];
  const r = spawnSync(String(cmd).replace(/\{summary\}/g, summary), { cwd: root, shell: true, env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return { status: r.status, error: r.error ? String(r.error) : null };
}

/** Raises an item (idempotent by id). @returns {{ item, notified: boolean }} */
function raise(root, input, cfg) {
  const id = String(input.id);
  const current = open(root).find((x) => x.id === id);
  if (current) return { item: current, isNew: false, notified: false };
  const item = { kind: 'raised', id, what: input.what, why: String(input.why || '').slice(0, 600), command: input.command, owner: input.owner || 'tech lead', source: input.source || null, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(LOG(root)), { recursive: true });
  fs.appendFileSync(LOG(root), `${JSON.stringify(item)}\n`, 'utf8');
  render(root);
  const n = notify(root, cfg, item);
  return { item: { ...item, status: 'open' }, isNew: true, notified: Boolean(n), notify: n };
}

function resolve(root, id, by) {
  if (!by) throw new Error('resolve exige --by <papel>');
  const item = open(root).find((x) => x.id === id);
  if (!item) throw new Error(`aviso ${id} não está aberto`);
  fs.appendFileSync(LOG(root), `${JSON.stringify({ kind: 'resolved', id, by, at: new Date().toISOString() })}\n`, 'utf8');
  render(root);
  return { id, resolved_by: by };
}

/** The attention item of a runtime event, or null. */
function fromEvent(e) {
  if (!e || !e.payload) return null;
  const t = e.work_item_id;
  const p = e.payload;
  if (e.type === 'WorkItemBlocked') {
    const reason = String(p.reason || '');
    const detail = typeof p.detail === 'string' ? p.detail : p.detail ? JSON.stringify(p.detail) : '';
    if (reason === 'paused_environment') return { id: `env:${t}`, what: `${t} pausou pelo ambiente`, why: detail || 'a máquina, não o código', command: 'corrija o ambiente e rode oxe-cc runtime execute de novo', owner: 'quem opera a máquina' };
    if (reason === 'paused_quota') return { id: 'quota', what: 'a run pausou pela cota do provedor', why: detail || 'limite de uso', command: 'aguarde o reset da cota e rode oxe-cc runtime execute de novo', owner: 'tech lead' };
    if (reason === 'waiting_answer') return { id: `question:${t}`, what: `${t} espera uma resposta`, why: detail || 'pergunta bloqueante sem evidência', command: 'oxe-cc runtime questions; oxe-cc runtime questions answer Q-n --answer "…"', owner: 'dono do critério' };
    if (reason === 'pending_gate') return { id: `gate:${t}`, what: `${t} espera aprovação`, why: detail || 'gate humano', command: 'oxe-cc runtime gates', owner: 'aprovador do gate' };
    if (reason.startsWith('repair_')) return { id: `repair:${t}`, what: `${t}: reparo ${reason.slice(7)}`, why: detail || 'a tarefa não converge', command: reason === 'repair_decompose' ? `oxe-cc runtime repair apply ${t}` : 'oxe-cc runtime feedback list', owner: 'planner' };
  }
  if (e.type === 'WorkItemDeferred') return { id: `deferred:${t}`, what: `${t} foi adiada`, why: 'esgotou as tentativas; as independentes seguiram', command: 'oxe-cc runtime deferred', owner: 'planner' };
  return null;
}

module.exports = { read, open, raise, resolve, render, fromEvent, MD };
