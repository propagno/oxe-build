'use strict';

/**
 * OXB-146: customize a workflow per team and per person WITHOUT copying it.
 *  - Overlays: `.oxe/custom/<workflow>.json` (team, versioned) and `.oxe/custom/<workflow>.user.json` (personal; keep
 *    it out of git). Precedence on the same point: personal > team > package.
 *    { "extensions": [{ "point": "after:verificar" | "before:<heading-slug>", "text": "…" }],
 *      "rules": ["regra extra…"], "fields": { "<name>": "<value>" } }   (fields replace `{{oxe:<name>}}` tokens)
 *  - Extension points are named from the workflow's own headings: `before:<slug>` / `after:<slug>` (slug of the
 *    heading text) — no copy, no markers to maintain.
 *  - `oxe-cc update` (and install) applies the new workflow and REAPPLIES the overlays; an overlay whose point no
 *    longer exists is listed for a decision (keep / drop / rewrite) and never dropped silently.
 *  - Direct edits of the installed copy are detected by hash (`.oxe/workflows/.oxe-applied.json`) and `customize
 *    migrate` turns the added lines into overlay entries (removed lines are reported, not guessed).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');
const slug = (h) => String(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[`*_]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CUSTOM = (root) => path.join(root, '.oxe', 'custom');
const APPLIED = (root) => path.join(root, '.oxe', 'workflows', '.oxe-applied.json');

/** Sections by heading: [{ slug, level, start, end }] (line indexes; end exclusive). */
function sections(lines) {
  const heads = [];
  lines.forEach((l, i) => { const m = /^(#{2,4})\s+(.+?)\s*$/.exec(l); if (m) heads.push({ level: m[1].length, slug: slug(m[2]), start: i }); });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    return { ...h, end: next ? next.start : lines.length };
  });
}
function points(text) { return sections(String(text).split(/\r?\n/)).flatMap((s) => [`before:${s.slug}`, `after:${s.slug}`]); }

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

/** team + personal overlays of one workflow, merged by point (personal wins). */
function overlayFor(root, workflow) {
  const base = workflow.replace(/\.md$/, '');
  const team = readJson(path.join(CUSTOM(root), `${base}.json`)) || {};
  const user = readJson(path.join(CUSTOM(root), `${base}.user.json`)) || {};
  const byPoint = new Map();
  for (const [src, o] of [['equipe', team], ['pessoal', user]]) for (const e of o.extensions || []) if (e && e.point && e.text) byPoint.set(e.point, { ...e, source: src });
  return { extensions: [...byPoint.values()], rules: [...(team.rules || []), ...(user.rules || [])], fields: { ...(team.fields || {}), ...(user.fields || {}) }, empty: !(team.extensions || team.rules || team.fields || user.extensions || user.rules || user.fields) };
}

function apply(text, overlay) {
  let lines = String(text).split(/\r?\n/);
  const applied = [];
  const missing = [];
  // after before before: insert from the bottom so indexes stay valid
  const plan = [];
  const secs = sections(lines);
  for (const e of overlay.extensions) {
    const [where, s] = String(e.point).split(':');
    const sec = secs.find((x) => x.slug === s);
    if (!sec || !['before', 'after'].includes(where)) { missing.push(e); continue; }
    plan.push({ at: where === 'before' ? sec.start : sec.end, e });
  }
  // same index: insert the `before:` of the next section first, so the `after:` of the previous one lands above it
  const rank = (p) => (String(p.e.point).startsWith('before:') ? 0 : 1);
  for (const p of plan.sort((a, b) => b.at - a.at || rank(a) - rank(b))) {
    lines.splice(p.at, 0, `<!-- oxe-custom: ${p.e.point} (${p.e.source}) -->`, ...String(p.e.text).split(/\r?\n/), '');
    applied.push(p.e.point);
  }
  let out = lines.join('\n');
  for (const [k, v] of Object.entries(overlay.fields || {})) out = out.split(`{{oxe:${k}}}`).join(String(v));
  if ((overlay.rules || []).length) out = `${out.replace(/\s*$/, '\n')}\n## Regras extras do projeto\n<!-- oxe-custom: rules -->\n${overlay.rules.map((r) => `- ${r}`).join('\n')}\n`;
  return { text: out, applied, missing };
}

/** Applies every overlay to the installed copies (`.oxe/workflows/`); records the applied hashes. */
function applyAll(root, options = {}) {
  const wfDir = path.join(root, '.oxe', 'workflows');
  const pkgDir = options.pkgDir || path.join(__dirname, '..', '..', 'oxe', 'workflows');
  const out = { reapplied: 0, decisions: [], workflows: [] };
  if (!fs.existsSync(wfDir)) return out;
  const hashes = {};
  for (const name of fs.readdirSync(wfDir).filter((n) => n.endsWith('.md'))) {
    const pkgFile = path.join(pkgDir, name);
    const base = fs.existsSync(pkgFile) ? fs.readFileSync(pkgFile, 'utf8') : fs.readFileSync(path.join(wfDir, name), 'utf8');
    const ov = overlayFor(root, name);
    if (ov.empty) { hashes[name] = sha(fs.readFileSync(path.join(wfDir, name), 'utf8')); continue; }
    const r = apply(base, ov);
    fs.writeFileSync(path.join(wfDir, name), r.text);
    hashes[name] = sha(r.text);
    out.reapplied += r.applied.length + (ov.rules.length ? 1 : 0);
    for (const m of r.missing) out.decisions.push({ workflow: name, point: m.point, source: m.source, text: String(m.text).slice(0, 80), options: ['manter (escolher outro ponto)', 'retirar', 'reescrever'] });
    out.workflows.push(name);
  }
  fs.writeFileSync(APPLIED(root), `${JSON.stringify(hashes, null, 2)}\n`);
  return out;
}

/** Installed copies edited by hand since the last apply. */
function directEdits(root) {
  const rec = readJson(APPLIED(root)) || {};
  const wfDir = path.join(root, '.oxe', 'workflows');
  return Object.entries(rec).filter(([n, h]) => fs.existsSync(path.join(wfDir, n)) && sha(fs.readFileSync(path.join(wfDir, n), 'utf8')) !== h).map(([n]) => n);
}

/** Turns the lines added by hand into team overlay entries (after:<section>); removed lines are reported. */
function migrate(root, options = {}) {
  const pkgDir = options.pkgDir || path.join(__dirname, '..', '..', 'oxe', 'workflows');
  const result = [];
  for (const name of directEdits(root)) {
    const edited = fs.readFileSync(path.join(root, '.oxe', 'workflows', name), 'utf8').split(/\r?\n/);
    const expected = apply(fs.readFileSync(path.join(pkgDir, name), 'utf8'), overlayFor(root, name)).text.split(/\r?\n/);
    const expSet = new Set(expected.map((l) => l.trim()));
    const editSet = new Set(edited.map((l) => l.trim()));
    const secs = sections(edited);
    const added = new Map();
    edited.forEach((l, i) => {
      if (!l.trim() || expSet.has(l.trim())) return;
      const sec = [...secs].reverse().find((s) => s.start <= i);
      const key = sec ? `after:${sec.slug}` : 'before:start';
      added.set(key, [...(added.get(key) || []), l]);
    });
    const removed = expected.filter((l) => l.trim() && !editSet.has(l.trim()) && !/^<!-- oxe-custom/.test(l));
    const teamFile = path.join(CUSTOM(root), `${name.replace(/\.md$/, '')}.json`);
    const team = readJson(teamFile) || {};
    team.extensions = [...(team.extensions || []), ...[...added.entries()].map(([point, ls]) => ({ point, text: ls.join('\n'), migrated_at: new Date().toISOString() }))];
    fs.mkdirSync(CUSTOM(root), { recursive: true });
    fs.writeFileSync(teamFile, `${JSON.stringify(team, null, 2)}\n`);
    result.push({ workflow: name, migrated: [...added.keys()], removed_lines: removed.slice(0, 20) });
  }
  if (result.length) applyAll(root, { pkgDir });
  return result;
}

function addExtension(root, workflow, input) {
  if (!input.point || !input.text) throw new Error('use: oxe-cc customize edit <workflow> --point after:<seção> --text "…" [--user]');
  const pkg = path.join(__dirname, '..', '..', 'oxe', 'workflows', workflow.endsWith('.md') ? workflow : `${workflow}.md`);
  const text = fs.existsSync(pkg) ? fs.readFileSync(pkg, 'utf8') : '';
  if (text && !points(text).includes(input.point)) throw new Error(`ponto ${input.point} não existe em ${workflow} (oxe-cc customize list ${workflow})`);
  const file = path.join(CUSTOM(root), `${workflow.replace(/\.md$/, '')}${input.user ? '.user' : ''}.json`);
  const o = readJson(file) || {};
  o.extensions = [...(o.extensions || []).filter((e) => e.point !== input.point), { point: input.point, text: input.text }];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(o, null, 2)}\n`);
  return { file, point: input.point };
}

module.exports = { slug, sections, points, overlayFor, apply, applyAll, directEdits, migrate, addExtension };
