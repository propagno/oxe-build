#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

const npmBin = 'npm';
const packed = spawnSync(npmBin, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: PROJECT_ROOT,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  shell: process.platform === 'win32',
});

if (packed.status !== 0) {
  console.error('release-pack-check: BLOCKED');
  console.error(
    (packed.error && packed.error.message)
    || packed.stderr
    || packed.stdout
    || 'npm pack --dry-run falhou'
  );
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(packed.stdout || '[]');
} catch (error) {
  console.error('release-pack-check: BLOCKED');
  console.error(`npm pack --json retornou JSON inválido: ${error.message}`);
  process.exit(1);
}

const entry = Array.isArray(parsed) ? parsed[0] : parsed;
const files = Array.isArray(entry && entry.files) ? entry.files.map((file) => String(file.path || file)) : [];
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

if (blockers.length) {
  console.error('release-pack-check: BLOCKED');
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exit(1);
}

console.log(`release-pack-check: OK (${entry.filename || `${pkg.name}-${pkg.version}.tgz`}, ${files.length} arquivos)`);
