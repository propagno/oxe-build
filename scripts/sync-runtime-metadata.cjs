#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

const ROOT = process.env.OXE_SYNC_REPO_ROOT
  ? path.resolve(process.env.OXE_SYNC_REPO_ROOT)
  : path.join(__dirname, '..');

const TARGETS = [
  {
    dir: path.join(ROOT, '.github', 'prompts'),
    filter: (name) => (name === 'oxe.prompt.md' || name.startsWith('oxe-')) && name.endsWith('.prompt.md'),
    slug: runtimeSemantics.slugFromPromptFilename,
  },
  {
    dir: path.join(ROOT, 'commands', 'oxe'),
    filter: (name) => name.endsWith('.md'),
    slug: runtimeSemantics.slugFromCommandFilename,
  },
];

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

function splitFrontmatter(raw) {
  const normalized = normalizeNewlines(raw).replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: '', body: normalized.trimStart() };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatter: '', body: normalized.trimStart() };
  }
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).trimStart(),
  };
}

function stripReasoningContract(body) {
  return body.replace(
    /<!-- oxe-reasoning-contract:start -->[\s\S]*?<!-- oxe-reasoning-contract:end -->\s*/g,
    ''
  );
}

function syncOne(fullPath, slug) {
  const raw = fs.readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  if (!frontmatter) {
    throw new Error(`Frontmatter ausente em ${fullPath}`);
  }
  const meta = runtimeSemantics.getRuntimeMetadataForSlug(slug);
  const cleanedFront = frontmatter
    .split('\n')
    .filter((line) => !runtimeSemantics.RUNTIME_METADATA_KEYS.some((key) => line.startsWith(`${key}:`)))
    .join('\n')
    .trimEnd();
  const updatedFront = `${cleanedFront}\n${runtimeSemantics.renderRuntimeMetadataLines(meta).join('\n')}`.trim();
  const cleanedBody = stripReasoningContract(body).trimStart();
  const contract = runtimeSemantics.buildReasoningContractBlock(meta);
  const next = `---\n${updatedFront}\n---\n\n${contract}\n\n${cleanedBody.replace(/\n+$/g, '')}\n`;
  fs.writeFileSync(fullPath, next, 'utf8');
}

function main() {
  let count = 0;
  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) continue;
    for (const name of fs.readdirSync(target.dir)) {
      if (!target.filter(name)) continue;
      syncOne(path.join(target.dir, name), target.slug(name));
      count++;
    }
  }
  console.log(`sync-runtime-metadata: ${count} ficheiro(s) atualizados`);
}

main();
