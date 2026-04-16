'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTRACTS_PATH = path.join(
  __dirname,
  '..',
  '..',
  'oxe',
  'workflows',
  'references',
  'workflow-runtime-contracts.json'
);

const RUNTIME_METADATA_KEYS = [
  'oxe_workflow_slug',
  'oxe_reasoning_mode',
  'oxe_question_policy',
  'oxe_output_contract',
  'oxe_tool_profile',
  'oxe_confidence_policy',
  'oxe_context_tier',
  'oxe_contract_version',
  'oxe_semantics_hash',
];

const REQUIRED_CONTRACT_FIELDS = [
  'reasoning_mode',
  'question_policy',
  'output_contract',
  'tool_profile',
  'confidence_policy',
  'required_artifacts',
  'optional_artifacts',
  'context_tiers',
  'freshness_policy',
  'fallback_policy',
  'blocking_conditions',
  'output_sections',
];

function readContractsRegistry() {
  try {
    const raw = fs.readFileSync(CONTRACTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const CONTRACTS_REGISTRY = readContractsRegistry();
if (!CONTRACTS_REGISTRY.contract_version) {
  process.stderr.write('[oxe] WARN: workflow-runtime-contracts.json ausente ou inválido — usando defaults.\n');
}
const CONTRACT_VERSION = String(CONTRACTS_REGISTRY.contract_version || '0.0.0');
const MODE_REFERENCES = CONTRACTS_REGISTRY.mode_references || {};
const MODE_GUIDANCE = CONTRACTS_REGISTRY.mode_guidance || {};
const MODE_DEFAULT_SPECS = CONTRACTS_REGISTRY.mode_defaults || {};
const MODE_DEFAULTS = Object.fromEntries(
  Object.entries(MODE_DEFAULT_SPECS).map(([mode, spec]) => [
    mode,
    {
      oxe_reasoning_mode: mode,
      oxe_question_policy: spec.question_policy,
      oxe_output_contract: spec.output_contract,
      oxe_tool_profile: spec.tool_profile,
      oxe_confidence_policy: spec.confidence_policy,
    },
  ])
);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uniqueStrings(items) {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function buildContextTiers(requiredArtifacts, optionalArtifacts) {
  const required = uniqueStrings(requiredArtifacts);
  const optional = uniqueStrings(optionalArtifacts);
  const minimalTail = optional.filter((item) => /(phase_summary|project_summary|session_summary)$/.test(item)).slice(0, 2);
  const standardTail = optional.filter((item) => !minimalTail.includes(item)).slice(0, 4);
  return {
    minimal: uniqueStrings([...required, ...minimalTail]),
    standard: uniqueStrings([...required, ...minimalTail, ...standardTail]),
    full: uniqueStrings([...required, ...optional]),
  };
}

function getWorkflowContract(slug) {
  const workflow = (CONTRACTS_REGISTRY.workflows || {})[slug];
  if (!workflow) return null;
  const mode = String(workflow.reasoning_mode || 'status');
  const modeDefaults = MODE_DEFAULT_SPECS[mode] || MODE_DEFAULT_SPECS.status || {};
  const requiredArtifacts = uniqueStrings(workflow.required_artifacts);
  const optionalArtifacts = uniqueStrings(workflow.optional_artifacts);
  return {
    workflow_slug: slug,
    contract_version: CONTRACT_VERSION,
    reasoning_mode: mode,
    question_policy: String(workflow.question_policy || modeDefaults.question_policy || 'none'),
    output_contract: String(workflow.output_contract || modeDefaults.output_contract || 'routing'),
    tool_profile: String(workflow.tool_profile || modeDefaults.tool_profile || 'read_heavy'),
    confidence_policy: String(workflow.confidence_policy || modeDefaults.confidence_policy || 'explicit'),
    required_artifacts: requiredArtifacts,
    optional_artifacts: optionalArtifacts,
    context_tiers: workflow.context_tiers || buildContextTiers(requiredArtifacts, optionalArtifacts),
    freshness_policy: workflow.freshness_policy || modeDefaults.freshness_policy || {},
    fallback_policy: String(workflow.fallback_policy || modeDefaults.fallback_policy || 'read_direct_with_warning'),
    blocking_conditions: uniqueStrings(workflow.blocking_conditions || modeDefaults.blocking_conditions || []),
    output_sections: uniqueStrings(workflow.output_sections || modeDefaults.output_sections || []),
    extraction_intent: String(workflow.extraction_intent || 'status_read'),
    auditor_artifacts: Array.isArray(workflow.auditor_artifacts) ? workflow.auditor_artifacts.slice() : [],
    auditor_excluded: Array.isArray(workflow.auditor_excluded) ? workflow.auditor_excluded.slice() : [],
    reference: MODE_REFERENCES[mode] || null,
    guidance: Array.isArray(MODE_GUIDANCE[mode]) ? MODE_GUIDANCE[mode].slice() : [],
  };
}

function getAllWorkflowContracts() {
  return Object.keys(CONTRACTS_REGISTRY.workflows || {})
    .sort()
    .map((slug) => getWorkflowContract(slug))
    .filter(Boolean);
}

function validateWorkflowContractsRegistry(registry = CONTRACTS_REGISTRY) {
  const issues = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return ['workflow-runtime-contracts.json deve ser um objeto'];
  }
  if (!registry.contract_version || typeof registry.contract_version !== 'string') {
    issues.push('workflow-runtime-contracts.json: contract_version ausente ou inválido');
  }
  if (!registry.workflows || typeof registry.workflows !== 'object' || Array.isArray(registry.workflows)) {
    issues.push('workflow-runtime-contracts.json: workflows ausente ou inválido');
    return issues;
  }
  for (const slug of Object.keys(registry.workflows)) {
    const contract = getWorkflowContract(slug);
    if (!contract) {
      issues.push(`workflow-runtime-contracts.json: workflow "${slug}" inválido`);
      continue;
    }
    for (const field of REQUIRED_CONTRACT_FIELDS) {
      const value = contract[field];
      if (value == null) {
        issues.push(`workflow-runtime-contracts.json: ${slug} sem "${field}"`);
      }
    }
    for (const tier of ['minimal', 'standard', 'full']) {
      if (!Array.isArray(contract.context_tiers[tier])) {
        issues.push(`workflow-runtime-contracts.json: ${slug} context_tiers.${tier} deve ser array`);
      }
    }
  }
  return issues;
}

function computeSemanticsHash(slug) {
  const contract = getWorkflowContract(slug);
  if (!contract) return null;
  return crypto.createHash('sha256').update(stableJson(contract)).digest('hex').slice(0, 16);
}

function slugFromPromptFilename(name) {
  return name.replace(/^oxe-/, '').replace(/\.prompt\.md$/i, '');
}

function slugFromCommandFilename(name) {
  return name.replace(/^oxe-/i, '').replace(/\.md$/i, '');
}

function getRuntimeMetadataForSlug(slug, options = {}) {
  const tier = String(options.tier || 'standard');
  const contract = getWorkflowContract(slug);
  if (!contract) {
    const fallbackHash = crypto.createHash('sha256').update(`fallback:${slug}`).digest('hex').slice(0, 16);
    return {
      oxe_workflow_slug: slug,
      ...(MODE_DEFAULTS.status || {}),
      oxe_context_tier: tier,
      oxe_contract_version: CONTRACT_VERSION,
      oxe_semantics_hash: fallbackHash,
    };
  }
  return {
    oxe_workflow_slug: slug,
    oxe_reasoning_mode: contract.reasoning_mode,
    oxe_question_policy: contract.question_policy,
    oxe_output_contract: contract.output_contract,
    oxe_tool_profile: contract.tool_profile,
    oxe_confidence_policy: contract.confidence_policy,
    oxe_context_tier: tier,
    oxe_contract_version: CONTRACT_VERSION,
    oxe_semantics_hash: computeSemanticsHash(slug),
  };
}

function pickRuntimeMetadata(frontmatter) {
  const out = {};
  for (const key of RUNTIME_METADATA_KEYS) {
    if (frontmatter && typeof frontmatter[key] === 'string' && frontmatter[key].trim()) {
      out[key] = frontmatter[key].trim();
    }
  }
  return out;
}

function renderRuntimeMetadataLines(meta) {
  return RUNTIME_METADATA_KEYS.map((key) => `${key}: ${meta[key] || ''}`);
}

function humanizeValue(value) {
  const key = String(value || '');
  const labels = {
    discovery: 'descoberta',
    planning: 'planejamento',
    execution: 'execução',
    review: 'revisão',
    status: 'estado / roteamento',
    explore_first: 'explorar primeiro',
    ask_high_impact_only: 'perguntar só alto impacto',
    none: 'nenhuma',
    situational: 'situacional',
    plan: 'plano',
    findings: 'achados',
    routing: 'roteamento',
    execution: 'execução',
    read_heavy: 'leitura intensa',
    write_bounded: 'mutação limitada',
    review_heavy: 'revisão intensa',
    mixed: 'misto',
    explicit: 'explícita',
    rubric: 'rubrica',
    optional: 'opcional',
    minimal: 'mínimo',
    standard: 'padrão',
    full: 'completo',
  };
  return labels[key] || key.replace(/_/g, ' ');
}

function buildContextPackPaths(slug) {
  return {
    markdown: `.oxe/context/packs/${slug}.md`,
    json: `.oxe/context/packs/${slug}.json`,
    inspectCommand: `oxe-cc context inspect --workflow ${slug} --json`,
  };
}

function buildReasoningContractBlock(meta, options = {}) {
  const includeReference = options.includeReference !== false;
  const slug = String(meta.oxe_workflow_slug || options.slug || '');
  const contract = getWorkflowContract(slug) || {};
  const mode = meta.oxe_reasoning_mode || contract.reasoning_mode || 'status';
  const guidance = contract.guidance || MODE_GUIDANCE[mode] || [];
  const outputSections = contract.output_sections || [];
  const blocking = contract.blocking_conditions || [];
  const contextPack = buildContextPackPaths(slug);
  const lines = [
    '<!-- oxe-reasoning-contract:start -->',
    '',
    '**Contrato de raciocínio OXE deste comando**',
    `- **Workflow:** ${slug || '—'}`,
    `- **Modo:** ${humanizeValue(meta.oxe_reasoning_mode)}`,
    `- **Perguntas:** ${humanizeValue(meta.oxe_question_policy)}`,
    `- **Saída esperada:** ${humanizeValue(meta.oxe_output_contract)}`,
    `- **Perfil de ferramentas:** ${humanizeValue(meta.oxe_tool_profile)}`,
    `- **Política de confiança:** ${humanizeValue(meta.oxe_confidence_policy)}`,
    `- **Tier de contexto padrão:** ${humanizeValue(meta.oxe_context_tier || 'standard')}`,
    `- **Versão do contrato:** ${meta.oxe_contract_version || CONTRACT_VERSION}`,
    `- **Checksum semântico:** \`${meta.oxe_semantics_hash || computeSemanticsHash(slug) || '—'}\``,
    `- **Entrada de contexto prioritária:** \`${contextPack.markdown}\` e \`${contextPack.json}\``,
    `- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.`,
    `- **Inspeção estruturada:** \`${contextPack.inspectCommand}\``,
    ...guidance.map((line) => `- ${line}`),
  ];
  if (outputSections.length) {
    lines.push(`- **Seções esperadas:** ${outputSections.join(' · ')}`);
  }
  if (blocking.length) {
    lines.push(`- **Bloqueios formais:** ${blocking.join(' · ')}`);
  }
  if (includeReference && MODE_REFERENCES[mode]) {
    lines.push(`- **Referência canónica:** \`${MODE_REFERENCES[mode]}\``);
  }
  lines.push('', '<!-- oxe-reasoning-contract:end -->');
  return lines.join('\n');
}

function splitFrontmatter(raw) {
  const normalized = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
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

function parseFrontmatterMap(raw) {
  const { frontmatter } = splitFrontmatter(raw);
  const out = {};
  if (!frontmatter) return out;
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function auditWrapperText(slug, raw) {
  const frontmatter = parseFrontmatterMap(raw);
  const expected = getRuntimeMetadataForSlug(slug);
  const expectedPack = buildContextPackPaths(slug);
  const issues = [];
  for (const key of RUNTIME_METADATA_KEYS) {
    if ((frontmatter[key] || '') !== (expected[key] || '')) {
      issues.push({ key, expected: expected[key] || '', actual: frontmatter[key] || '' });
    }
  }
  if (!String(raw || '').includes('<!-- oxe-reasoning-contract:start -->')) {
    issues.push({ key: 'oxe-reasoning-contract', expected: 'present', actual: 'missing' });
  }
  if (!String(raw || '').includes(`Checksum semântico:** \`${expected.oxe_semantics_hash}\``)) {
    issues.push({ key: 'oxe_semantics_hash_block', expected: expected.oxe_semantics_hash, actual: 'mismatch' });
  }
  if (!String(raw || '').includes(expectedPack.markdown) || !String(raw || '').includes(expectedPack.json)) {
    issues.push({ key: 'oxe_context_pack_entry', expected: `${expectedPack.markdown} + ${expectedPack.json}`, actual: 'missing' });
  }
  if (!String(raw || '').includes('Regra pack-first')) {
    issues.push({ key: 'oxe_pack_first_rule', expected: 'present', actual: 'missing' });
  }
  return {
    slug,
    frontmatter,
    expected,
    issues,
    ok: issues.length === 0,
  };
}

function auditRuntimeTargets(projectRoot) {
  const targets = [
    {
      name: 'copilot-prompts',
      dir: path.join(projectRoot, '.github', 'prompts'),
      filter: (name) => (name === 'oxe.prompt.md' || name.startsWith('oxe-')) && name.endsWith('.prompt.md'),
      slug: slugFromPromptFilename,
    },
    {
      name: 'commands',
      dir: path.join(projectRoot, 'commands', 'oxe'),
      filter: (name) => name.endsWith('.md'),
      slug: slugFromCommandFilename,
    },
    {
      name: 'cursor',
      dir: path.join(projectRoot, '.cursor', 'commands'),
      filter: (name) => (name === 'oxe.md' || name.startsWith('oxe-')) && name.endsWith('.md'),
      slug: slugFromCommandFilename,
    },
  ];
  const result = {
    ok: true,
    contractVersion: CONTRACT_VERSION,
    registryPath: CONTRACTS_PATH,
    registryIssues: validateWorkflowContractsRegistry(),
    warnings: [],
    mismatches: [],
    targets: {},
  };
  for (const target of targets) {
    const info = { path: target.dir, files: [], checked: 0, missing: false };
    if (!fs.existsSync(target.dir)) {
      info.missing = true;
      result.targets[target.name] = info;
      continue;
    }
    let names;
    try {
      names = fs.readdirSync(target.dir);
    } catch (err) {
      info.missing = true;
      result.warnings.push(`${target.name}: falha ao listar diretório — ${err instanceof Error ? err.message : String(err)}`);
      result.targets[target.name] = info;
      continue;
    }
    for (const name of names) {
      if (!target.filter(name)) continue;
      const filePath = path.join(target.dir, name);
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        result.warnings.push(`${target.name}/${name}: falha ao ler arquivo — ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const audit = auditWrapperText(target.slug(name), raw);
      info.checked += 1;
      info.files.push({ file: filePath, slug: audit.slug, ok: audit.ok, issues: audit.issues });
      if (!audit.ok) {
        result.ok = false;
        result.mismatches.push({ target: target.name, file: filePath, slug: audit.slug, issues: audit.issues });
      }
    }
    result.targets[target.name] = info;
  }
  if (result.registryIssues.length) {
    result.ok = false;
    result.warnings.push(...result.registryIssues);
  }
  if (result.mismatches.length) {
    result.warnings.push(`${result.mismatches.length} wrapper(s) com drift semântico detectado`);
  }
  return result;
}

module.exports = {
  CONTRACT_VERSION,
  CONTRACTS_PATH,
  CONTRACTS_REGISTRY,
  MODE_DEFAULTS,
  MODE_GUIDANCE,
  MODE_REFERENCES,
  REQUIRED_CONTRACT_FIELDS,
  RUNTIME_METADATA_KEYS,
  auditRuntimeTargets,
  auditWrapperText,
  buildContextPackPaths,
  buildContextTiers,
  buildReasoningContractBlock,
  computeSemanticsHash,
  getAllWorkflowContracts,
  getRuntimeMetadataForSlug,
  getWorkflowContract,
  parseFrontmatterMap,
  pickRuntimeMetadata,
  renderRuntimeMetadataLines,
  slugFromCommandFilename,
  slugFromPromptFilename,
  splitFrontmatter,
  validateWorkflowContractsRegistry,
};
