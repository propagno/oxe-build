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

const CANONICAL_WORKFLOWS_DIR = path.join(ROOT, 'oxe', 'workflows');
const CONTRACTS_PATH = path.join(CANONICAL_WORKFLOWS_DIR, 'references', 'workflow-runtime-contracts.json');

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

function stripWorkflowResolution(body) {
  return body.replace(
    /<!-- oxe-workflow-resolution:start -->[\s\S]*?<!-- oxe-workflow-resolution:end -->\s*/g,
    ''
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLegacyWorkflowInstructions(body, slug) {
  const workflowPattern = escapeRegExp(slug);
  const workflowLine = new RegExp(
    `^\\*\\*Workflow can[óôo]nic[oa]:\\*\\*\\s*\\\`(?:\\.oxe|oxe)/workflows/${workflowPattern}\\.md\\\`\\s*$`,
    'gmi'
  );
  const workflowPathLine = new RegExp(
    `^\\\`(?:\\.oxe|oxe)/workflows/${workflowPattern}\\.md\\\`(?:\\s*\\([^\\n]*\\))?\\s*$`,
    'gmi'
  );
  const workflowTail = new RegExp(
    `\\s*L[eê]\\s+\\\`(?:\\.oxe|oxe)/workflows/${workflowPattern}\\.md\\\`[^\\n]*`,
    'gi'
  );

  return body
    .replace(workflowLine, '')
    .replace(workflowPathLine, '')
    .replace(/^Execut[ae] integralmente esse ficheiro[^.]*\.\s*/gmi, '')
    .replace(/^Executa o workflow \*\*OXE [^*]+\*\*.*$/gmi, '')
    .replace(workflowTail, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
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
  const cleanedBody = stripLegacyWorkflowInstructions(stripWorkflowResolution(stripReasoningContract(body)), slug).trimStart();
  const contract = runtimeSemantics.buildReasoningContractBlock(meta);
  const resolution = runtimeSemantics.buildWorkflowResolutionBlock(slug);
  const next = `---\n${updatedFront}\n---\n\n${contract}\n\n${resolution}\n\n${cleanedBody.replace(/\n+$/g, '')}\n`;
  fs.writeFileSync(fullPath, next, 'utf8');
}

function writeRuntimeSemanticsManifest(root) {
  const audit = runtimeSemantics.auditRuntimeTargets(root);
  const manifestPath = path.join(root, '.oxe', 'install', 'runtime-semantics.json');
  const wrappers = {};
  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) continue;
    wrappers[path.relative(root, target.dir).replace(/\\/g, '/')] = fs
      .readdirSync(target.dir)
      .filter((name) => target.filter(name))
      .sort()
      .map((name) => {
        const filePath = path.join(target.dir, name);
        return {
          path: path.relative(root, filePath).replace(/\\/g, '/'),
          hash: require('../bin/lib/oxe-manifest.cjs').sha256File(filePath),
        };
      });
  }
  const payload = {
    schema_version: 1,
    target: 'runtime-semantics',
    synced_at: new Date().toISOString(),
    contract_version: runtimeSemantics.CONTRACT_VERSION,
    semantics_hashes: Object.fromEntries(
      runtimeSemantics.getAllWorkflowContracts().map((contract) => [
        contract.workflow_slug,
        runtimeSemantics.computeSemanticsHash(contract.workflow_slug),
      ])
    ),
    wrappers,
    audit: {
      ok: audit.ok,
      warnings: audit.warnings,
      mismatchCount: audit.mismatches.length,
    },
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function main() {
  if (!fs.existsSync(CANONICAL_WORKFLOWS_DIR)) {
    throw new Error(`Fonte canónica ausente: ${CANONICAL_WORKFLOWS_DIR}`);
  }
  if (!fs.existsSync(CONTRACTS_PATH)) {
    throw new Error(`Contrato semântico ausente: ${CONTRACTS_PATH}`);
  }
  const registryIssues = runtimeSemantics.validateWorkflowContractsRegistry();
  if (runtimeSemantics.CONTRACT_VERSION === '0.0.0' || registryIssues.length) {
    throw new Error(`workflow-runtime-contracts.json inválido: ${registryIssues.join('; ') || 'contract_version ausente'}`);
  }
  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) {
      throw new Error(`Superfície derivada ausente: ${target.dir}`);
    }
  }
  let count = 0;
  for (const target of TARGETS) {
    if (!fs.existsSync(target.dir)) continue;
    for (const name of fs.readdirSync(target.dir)) {
      if (!target.filter(name)) continue;
      syncOne(path.join(target.dir, name), target.slug(name));
      count++;
    }
  }
  writeRuntimeSemanticsManifest(ROOT);
  console.log(`sync-runtime-metadata: ${count} ficheiro(s) atualizados`);
}

main();
