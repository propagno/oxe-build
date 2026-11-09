'use strict';

/**
 * OXB-144: non-functional criteria with measured evidence. `.oxe/program/nfr.json` declares, per criterion:
 *   { metric, method (a command that prints the value), threshold ("<=1500"), environment, samples (≥ 1) }.
 * `oxe-cc runtime nfr measure --criteria A12` runs the method `samples` times, takes the value of each run (the
 * `<metric>=<n>` / `<metric>: <n>` line, else the last number printed), and records median and dispersion (min, max,
 * relative spread) in `.oxe/program/nfr-history.ndjson` with the phase. The criterion passes only within the threshold
 * and with every sample measured. A median worse than the previous phase's by more than `nfr.regression_pct` (default
 * 10%) is an `nfr-regression` finding even inside the threshold. Each NFR criterion of a phase is an implicit phase
 * gate (`nfr-A12`); the dossier gets `nfr.md` with the series.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DECL = (programDir) => path.join(programDir, 'nfr.json');
const HIST = (programDir) => path.join(programDir, 'nfr-history.ndjson');

function readDecl(programDir) { try { return JSON.parse(fs.readFileSync(DECL(programDir), 'utf8')); } catch { return { criteria: {} }; } }

function parseThreshold(t) {
  const m = /^\s*(<=|>=|<|>|==)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(t || ''));
  if (!m) throw new Error(`threshold inválido: "${t}" (use <=1500, <2, >=99.9)`);
  return { op: m[1], value: Number(m[2]) };
}
const within = (v, th) => ({ '<=': v <= th.value, '<': v < th.value, '>=': v >= th.value, '>': v > th.value, '==': v === th.value }[th.op]);
const lowerIsBetter = (th) => th.op === '<=' || th.op === '<';

function declare(programDir, criterion, input) {
  const id = String(criterion || '').toUpperCase();
  if (!/^A\d+$/.test(id)) throw new Error('informe o critério: oxe-cc runtime nfr declare --criteria A12 …');
  if (!input.metric || !input.method) throw new Error('nfr exige --metric <nome> e --method "<comando que imprime o valor>"');
  parseThreshold(input.threshold);
  const samples = Number(input.samples || 5);
  if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples: inteiro ≥ 1');
  const d = readDecl(programDir);
  d.criteria = d.criteria || {};
  d.criteria[id] = { metric: String(input.metric), method: String(input.method), threshold: String(input.threshold), environment: input.environment || null, samples };
  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(DECL(programDir), `${JSON.stringify(d, null, 2)}\n`);
  return { criterion: id, ...d.criteria[id] };
}

/** The value a run printed: `<metric>=<n>` / `<metric>: <n>`, else the last number. */
function parseValue(out, metric) {
  const text = String(out || '');
  const re = new RegExp(`${String(metric).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[=:]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
  const m = re.exec(text);
  if (m) return Number(m[1]);
  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  return nums && nums.length ? Number(nums[nums.length - 1]) : null;
}

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { n, median, min: v[0], max: v[n - 1], spread: median ? Math.round(((v[n - 1] - v[0]) / Math.abs(median)) * 1000) / 1000 : 0 };
}

function history(programDir) {
  let raw = '';
  try { raw = fs.readFileSync(HIST(programDir), 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Measures one criterion. run(cmd) → { ok, stdout } (tests inject it). Returns the measurement with pass / regression.
 */
function measure(root, programDir, criterion, ctx = {}) {
  const decl = readDecl(programDir).criteria || {};
  const d = decl[criterion];
  if (!d) throw new Error(`${criterion} não é um critério não funcional (oxe-cc runtime nfr declare --criteria ${criterion} …)`);
  const th = parseThreshold(d.threshold);
  const run = ctx.run || ((cmd) => { const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: 600_000, windowsHide: true }); return { ok: r.status === 0, stdout: `${r.stdout || ''}\n${r.stderr || ''}` }; });
  const values = [];
  const failures = [];
  for (let i = 0; i < d.samples; i += 1) {
    const r = run(d.method);
    const v = r.ok ? parseValue(r.stdout, d.metric) : null;
    if (v == null || Number.isNaN(v)) failures.push(i + 1); else values.push(v);
  }
  const s = values.length ? stats(values) : null;
  const enough = values.length === d.samples;
  const pass = Boolean(s && enough && within(s.median, th));
  const prev = history(programDir).filter((h) => h.criterion === criterion && h.phase && h.phase !== ctx.phase && h.median != null).pop() || null;
  const pct = Number((ctx.config && ctx.config.nfr && ctx.config.nfr.regression_pct) ?? 10);
  let regression = null;
  if (s && prev && prev.median) {
    const delta = (s.median - prev.median) / Math.abs(prev.median);
    const worse = lowerIsBetter(th) ? delta : -delta;
    if (worse * 100 > pct) regression = { from_phase: prev.phase, from: prev.median, to: s.median, worse_pct: Math.round(worse * 1000) / 10 };
  }
  const rec = { kind: 'nfr', criterion, phase: ctx.phase || null, metric: d.metric, threshold: d.threshold, environment: d.environment, samples: d.samples, measured: values.length, failed_samples: failures, ...(s || { median: null }), pass, regression, at: new Date().toISOString() };
  fs.mkdirSync(programDir, { recursive: true });
  fs.appendFileSync(HIST(programDir), `${JSON.stringify(rec)}\n`, 'utf8');
  return { ...rec, reason: pass ? null : !enough ? `amostras insuficientes: ${values.length}/${d.samples} (falharam ${failures.join(', ')})` : `mediana ${s.median} fora do limite ${d.threshold}` };
}

function renderSeries(programDir) {
  const h = history(programDir);
  const by = new Map();
  for (const r of h) { if (!by.has(r.criterion)) by.set(r.criterion, []); by.get(r.criterion).push(r); }
  const lines = ['# Critérios não funcionais — série por fase', ''];
  for (const [c, rs] of by) {
    lines.push(`## ${c} — ${rs[0].metric} (${rs[0].threshold})`, '', '| Fase | Mediana | Mín | Máx | Dispersão | Amostras | Resultado |', '|---|---|---|---|---|---|---|');
    for (const r of rs) lines.push(`| ${r.phase || '—'} | ${r.median ?? '—'} | ${r.min ?? '—'} | ${r.max ?? '—'} | ${r.spread ?? '—'} | ${r.measured}/${r.samples} | ${r.pass ? 'passa' : 'reprova'}${r.regression ? ` · regressão ${r.regression.worse_pct}% vs ${r.regression.from_phase}` : ''} |`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { readDecl, declare, parseThreshold, parseValue, stats, measure, history, renderSeries };
