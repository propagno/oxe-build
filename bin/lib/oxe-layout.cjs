'use strict';

/**
 * OXB-230-23: layout do repositório para os assets estáticos que o install copia.
 *
 * - `core`    → `.oxe/core/<kind>` (raiz `.oxe/` fica só com o estado do projeto)
 * - `nested`  → `.oxe/<kind>` (padrão até a 1.22)
 * - `classic` → `oxe/<kind>` na raiz do repositório
 *
 * A leitura é retroativa: `.oxe/core/` → `.oxe/` → `oxe/`, o primeiro que existir.
 */

const fs = require('fs');
const path = require('path');

/** Assets estáticos do install que o layout core isola em `.oxe/core/`. */
const ASSET_KINDS = ['workflows', 'templates', 'personas', 'agents', 'schemas', 'install'];
/** Os que também existem no layout clássico (`oxe/<kind>` na raiz). */
const CLASSIC_KINDS = new Set(['workflows', 'templates', 'personas', 'agents', 'schemas']);
const REPO_LAYOUTS = ['nested', 'classic', 'core'];

function coreDir(projectRoot) {
  return path.join(projectRoot, '.oxe', 'core');
}

function readConfiguredLayout(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.oxe', 'config.json'), 'utf8'));
    const layout = cfg && cfg.install && cfg.install.repo_layout;
    return REPO_LAYOUTS.includes(layout) ? layout : null;
  } catch {
    return null;
  }
}

/** O projeto usa o layout core: `.oxe/core/` existe ou o config pede `repo_layout: "core"`. */
function isCoreLayout(projectRoot) {
  if (fs.existsSync(coreDir(projectRoot))) return true;
  return readConfiguredLayout(projectRoot) === 'core';
}

/** Candidatos de leitura de um asset, na ordem de precedência. */
function assetCandidates(projectRoot, kind) {
  const list = [path.join(coreDir(projectRoot), kind), path.join(projectRoot, '.oxe', kind)];
  if (CLASSIC_KINDS.has(kind)) list.push(path.join(projectRoot, 'oxe', kind));
  return list;
}

/**
 * Diretório de um asset estático no projeto.
 * Leitura: o primeiro de `.oxe/core/<kind>`, `.oxe/<kind>`, `oxe/<kind>` que existir; sem nenhum, `null`.
 * Com `forWrite: true`, nunca devolve `null`: sem nenhum existente, o destino do layout do projeto.
 * @param {string} projectRoot
 * @param {string} kind
 * @param {{ forWrite?: boolean }} [options]
 * @returns {string | null}
 */
function resolveOxeAssetDir(projectRoot, kind, options = {}) {
  const found = assetCandidates(projectRoot, kind).find((p) => fs.existsSync(p));
  if (found) return found;
  if (!options.forWrite) return null;
  return isCoreLayout(projectRoot) ? path.join(coreDir(projectRoot), kind) : path.join(projectRoot, '.oxe', kind);
}

/** Um arquivo dentro de um asset (ex.: `install/runtime-semantics.json`), pelo mesmo critério. */
function resolveOxeAssetFile(projectRoot, kind, fileName, options = {}) {
  for (const dir of assetCandidates(projectRoot, kind)) {
    const file = path.join(dir, fileName);
    if (fs.existsSync(file)) return file;
  }
  if (!options.forWrite) return null;
  return path.join(resolveOxeAssetDir(projectRoot, kind, { forWrite: true }), fileName);
}

/** Destino de install de um asset para o layout pedido (`core` ou `nested`). */
function installAssetDir(projectRoot, kind, layout) {
  return layout === 'core' ? path.join(coreDir(projectRoot), kind) : path.join(projectRoot, '.oxe', kind);
}

function rel(projectRoot, abs) {
  return path.relative(projectRoot, abs).split(path.sep).join('/');
}

/**
 * O que `doctor --migrate-layout` faria: `.oxe/<kind>` → `.oxe/core/<kind>` para cada asset presente.
 * Um destino que já existe é conflito (nada é sobrescrito).
 */
function planLayoutMigration(projectRoot) {
  const moves = [];
  const conflicts = [];
  for (const kind of ASSET_KINDS) {
    const from = path.join(projectRoot, '.oxe', kind);
    if (!fs.existsSync(from)) continue;
    const to = path.join(coreDir(projectRoot), kind);
    const item = { kind, from: rel(projectRoot, from), to: rel(projectRoot, to) };
    if (fs.existsSync(to)) conflicts.push({ ...item, reason: `${item.to} já existe` });
    else moves.push(item);
  }
  const layout = readConfiguredLayout(projectRoot);
  return { moves, conflicts, config_layout: layout, config_update: layout !== 'core' };
}

function moveDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    // Windows (arquivo aberto, antivírus) ou outro volume: copia e só então apaga a origem
    if (!err || !['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function writeCoreLayoutConfig(projectRoot) {
  const cfgPath = path.join(projectRoot, '.oxe', 'config.json');
  let cfg = {};
  if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.install || typeof cfg.install !== 'object' || Array.isArray(cfg.install)) cfg.install = {};
  cfg.install.repo_layout = 'core';
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

/**
 * `oxe-cc doctor --migrate-layout [--apply]`: ensaio por padrão; com `apply`, move os assets estáticos de `.oxe/`
 * para `.oxe/core/` e grava `install.repo_layout: "core"`. Estado do projeto (STATE.md, sessions/, runs/…) não se mexe.
 * Idempotente: depois de migrado, `moves` é vazio.
 * @param {string} projectRoot
 * @param {{ apply?: boolean }} [options]
 */
function migrateLayout(projectRoot, options = {}) {
  const apply = options.apply === true;
  const base = { oxeLayoutMigrationSchema: 1, apply, projectRoot };
  if (!fs.existsSync(path.join(projectRoot, '.oxe'))) {
    return { ...base, ok: false, moves: [], conflicts: [], config_update: false, errors: [`sem .oxe/ em ${projectRoot}`] };
  }
  const plan = planLayoutMigration(projectRoot);
  if (plan.conflicts.length) {
    return { ...base, ok: false, ...plan, errors: plan.conflicts.map((c) => `conflito: ${c.reason} — resolva à mão antes de migrar`) };
  }
  if (!apply) return { ...base, ok: true, ...plan, errors: [] };
  const done = [];
  for (const mv of plan.moves) {
    moveDir(path.join(projectRoot, mv.from), path.join(projectRoot, mv.to));
    done.push(mv);
  }
  if (plan.config_update) writeCoreLayoutConfig(projectRoot);
  return { ...base, ok: true, moves: done, conflicts: [], config_layout: 'core', config_update: plan.config_update, errors: [] };
}

module.exports = {
  ASSET_KINDS,
  REPO_LAYOUTS,
  coreDir,
  readConfiguredLayout,
  isCoreLayout,
  resolveOxeAssetDir,
  resolveOxeAssetFile,
  installAssetDir,
  planLayoutMigration,
  migrateLayout,
  writeCoreLayoutConfig,
};
