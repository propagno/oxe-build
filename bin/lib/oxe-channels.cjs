'use strict';

/**
 * OXB-100: two channels, `next` (release candidates) and `stable`.
 *  - `oxe-cc release channel status` shows what each channel points to (release-evidence/channels.json).
 *  - `oxe-cc release channel promote <version> --to stable --evidence <ref> --phase <Fn> --project <name>` promotes only
 *    with a phase of a real project (OXESpace) CLOSED on that build — the evidence is the close (dossier/commit ref) —
 *    and prints the npm commands; it never publishes (publishing is the maintainer's, with their OTP).
 *  - `oxe-cc release channel next <version>` records a new RC on `next`.
 * Config migrations: `oxe/migrations/config-migrations.json` lists, per version, the notes and the mechanical moves of
 * `.oxe/config.json` keys. `oxe-cc doctor --migrate-config` shows the pending ones; with `--apply` it backs the config up
 * (`config.json.bak-<version>`) and applies the moves; notes are printed, never applied silently.
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const ROOT = path.join(__dirname, '..', '..');
const CHANNELS = (root) => path.join(root, 'release-evidence', 'channels.json');
const MIGRATIONS = path.join(ROOT, 'oxe', 'migrations', 'config-migrations.json');

function readChannels(root) {
  try { return JSON.parse(fs.readFileSync(CHANNELS(root), 'utf8')); } catch { return { schema: 1, next: null, stable: null, history: [] }; }
}
function writeChannels(root, doc) {
  fs.mkdirSync(path.dirname(CHANNELS(root)), { recursive: true });
  fs.writeFileSync(CHANNELS(root), `${JSON.stringify(doc, null, 2)}\n`);
}

function recordNext(root, version) {
  if (!semver.valid(version)) throw new Error(`versão inválida: ${version}`);
  const doc = readChannels(root);
  doc.next = version;
  doc.history.push({ channel: 'next', version, at: new Date().toISOString() });
  writeChannels(root, doc);
  return { doc, commands: [`npm publish --tag next   # ${version}`] };
}

function promote(root, version, input = {}) {
  if (!semver.valid(version)) throw new Error(`versão inválida: ${version}`);
  if (input.to !== 'stable') throw new Error('use: release channel promote <versão> --to stable --evidence <ref> --phase Fn --project <nome>');
  if (!input.evidence || !input.phase || !input.project) throw new Error(`stable só depois de uma fase de projeto real fechada nesta build: informe --project, --phase e --evidence (o commit/dossiê do close feito com ${version})`);
  if (semver.prerelease(version)) throw new Error(`${version} é pré-release: promova a versão final (sem -rc) depois de publicá-la`);
  const doc = readChannels(root);
  doc.stable = version;
  doc.history.push({ channel: 'stable', version, project: input.project, phase: input.phase, evidence: input.evidence, by: input.by || null, at: new Date().toISOString() });
  writeChannels(root, doc);
  return { doc, commands: [`npm dist-tag add oxe-cc@${version} latest`, `npm dist-tag add oxe-cc@${version} stable`] };
}

function loadMigrations(file = MIGRATIONS) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).migrations || []; } catch { return []; }
}

const getPath = (obj, p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
function setPath(obj, p, v) { const ks = p.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; } o[ks[ks.length - 1]] = v; }
function delPath(obj, p) { const ks = p.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (!o || typeof o !== 'object') return; o = o[k]; } if (o && typeof o === 'object') delete o[ks[ks.length - 1]]; }

/** Pending migrations of a project's config, from the version it was last migrated to (or installed with). */
function pending(config, fromVersion, toVersion, migrations = loadMigrations()) {
  return migrations.filter((m) => semver.valid(m.version) && (!fromVersion || semver.gt(m.version, fromVersion)) && (!toVersion || semver.lte(m.version, toVersion))).map((m) => ({
    version: m.version,
    notes: m.notes || [],
    moves: (m.moves || []).filter((mv) => getPath(config, mv.from) !== undefined && getPath(config, mv.to) === undefined),
  }));
}

function apply(configPath, toVersion, migrations = loadMigrations()) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  const from = config.oxe_config_version || null;
  const list = pending(config, from, toVersion, migrations);
  fs.writeFileSync(`${configPath}.bak-${from || 'antes'}`, raw);
  const applied = [];
  for (const m of list) for (const mv of m.moves) { setPath(config, mv.to, getPath(config, mv.from)); delPath(config, mv.from); applied.push(`${mv.from} → ${mv.to}`); }
  config.oxe_config_version = toVersion;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { from, to: toVersion, applied, notes: list.flatMap((m) => m.notes.map((n) => `${m.version}: ${n}`)), backup: `${configPath}.bak-${from || 'antes'}` };
}

module.exports = { readChannels, recordNext, promote, loadMigrations, pending, apply, CHANNELS, MIGRATIONS };
