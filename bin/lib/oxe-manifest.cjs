'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_DIR = '.oxe-cc';
const MANIFEST_FILE = 'manifest.json';
const PATCHES_DIR = 'oxe-local-patches';

function manifestPath(home) {
  return path.join(home, MANIFEST_DIR, MANIFEST_FILE);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * @param {string} home
 * @returns {Record<string, string>}
 */
function loadFileManifest(home) {
  const p = manifestPath(home);
  if (!fs.existsSync(p)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j.files === 'object' ? j.files : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} home
 * @param {Record<string, string>} files absPath -> sha256
 * @param {string} version
 */
function writeFileManifest(home, files, version) {
  const dir = path.join(home, MANIFEST_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version,
    updated_at: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(manifestPath(home), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * Before overwriting with --force, backup files that diverged from last manifest.
 * @param {string} home
 * @param {Record<string, string>} prevManifest
 * @param {{ dryRun: boolean, force: boolean }} opts
 * @param {{ yellow: string, cyan: string, dim: string, reset: string }} colors
 * @returns {string[]} modified paths
 */
function backupModifiedFromManifest(home, prevManifest, opts, colors) {
  const { yellow, cyan, dim, reset } = colors;
  if (!opts.force || opts.dryRun) return [];
  const modified = [];
  for (const [absPath, oldHash] of Object.entries(prevManifest)) {
    if (!fs.existsSync(absPath)) continue;
    let now;
    try {
      now = sha256File(absPath);
    } catch {
      continue;
    }
    if (now !== oldHash) modified.push(absPath);
  }
  if (modified.length === 0) return [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const patchesRoot = path.join(home, MANIFEST_DIR, PATCHES_DIR, stamp);
  for (const absPath of modified) {
    const rel = path.basename(absPath);
    const dest = path.join(patchesRoot, rel.replace(/[^a-zA-Z0-9._-]+/g, '_'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
  }
  const meta = { backed_up_at: new Date().toISOString(), files: modified };
  fs.writeFileSync(path.join(patchesRoot, 'backup-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(
    `  ${yellow}i${reset}  ${modified.length} arquivo(s) OXE alterado(s) localmente — backup em ${cyan}${path.relative(home, patchesRoot)}${reset}`
  );
  for (const f of modified) console.log(`     ${dim}${f}${reset}`);
  return modified;
}

/**
 * @param {string} dir
 * @param {(f: string) => boolean} filter
 */
function collectFilesRecursive(dir, filter) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (filter(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

module.exports = {
  loadFileManifest,
  writeFileManifest,
  backupModifiedFromManifest,
  collectFilesRecursive,
  sha256File,
  MANIFEST_DIR,
  PATCHES_DIR,
};
