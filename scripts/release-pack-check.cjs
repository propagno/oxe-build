#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runPackageManagerSync } = require('../bin/lib/oxe-process.cjs');

const PROJECT_ROOT = path.join(__dirname, '..');

function parsePackOutput(stdout) {
  const parsed = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function validatePackEntry(entry, pkg) {
  const files = Array.isArray(entry && entry.files)
    ? entry.files.map((file) => String(file.path || file))
    : [];
  const blockers = [];

  if (!entry || entry.name !== pkg.name) {
    blockers.push(`nome do pacote divergente (${entry && entry.name ? entry.name : 'ausente'} != ${pkg.name})`);
  }
  if (!entry || entry.version !== pkg.version) {
    blockers.push(`versão do pacote divergente (${entry && entry.version ? entry.version : 'ausente'} != ${pkg.version})`);
  }
  for (const filePath of files) {
    if (/\.tgz$/i.test(filePath)) blockers.push(`tarball aninhado no pacote: ${filePath}`);
    if (/\.vsix$/i.test(filePath)) blockers.push(`VSIX histórico no pacote: ${filePath}`);
    if (/^\.oxe\//i.test(filePath)) blockers.push(`estado operacional .oxe incluído no pacote: ${filePath}`);
  }
  for (const required of ['package.json', 'README.md', 'CHANGELOG.md', 'bin/oxe-cc.js', 'lib/sdk/index.cjs']) {
    if (!files.includes(required)) blockers.push(`arquivo obrigatório ausente do pacote: ${required}`);
  }

  return { blockers, files };
}

function runPackCheck(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const pkg = options.pkg || require(path.join(projectRoot, 'package.json'));
  const run = options.runPackageManagerSync || options.spawn || runPackageManagerSync;
  const packed = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });

  if (packed.status !== 0) {
    return {
      ok: false,
      error: (packed.error && packed.error.message)
        || packed.stderr
        || packed.stdout
        || 'npm pack --dry-run falhou',
      blockers: [],
      files: [],
    };
  }

  let entry;
  try {
    entry = parsePackOutput(packed.stdout);
  } catch (error) {
    return {
      ok: false,
      error: `npm pack --json retornou JSON inválido: ${error.message}`,
      blockers: [],
      files: [],
    };
  }

  const validation = validatePackEntry(entry, pkg);
  return {
    ok: validation.blockers.length === 0,
    error: null,
    blockers: validation.blockers,
    files: validation.files,
    entry,
  };
}

function main() {
  const result = runPackCheck();
  if (!result.ok) {
    console.error('release-pack-check: BLOCKED');
    if (result.error) console.error(result.error);
    for (const blocker of result.blockers) console.error(`- ${blocker}`);
    return 1;
  }
  const filename = result.entry.filename || `${result.entry.name}-${result.entry.version}.tgz`;
  console.log(`release-pack-check: OK (${filename}, ${result.files.length} arquivos)`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parsePackOutput, validatePackEntry, runPackCheck };
