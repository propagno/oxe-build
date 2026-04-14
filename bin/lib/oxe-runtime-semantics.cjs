'use strict';

const RUNTIME_METADATA_KEYS = [
  'oxe_reasoning_mode',
  'oxe_question_policy',
  'oxe_output_contract',
  'oxe_tool_profile',
  'oxe_confidence_policy',
];

const MODE_REFERENCES = {
  discovery: 'oxe/workflows/references/reasoning-discovery.md',
  planning: 'oxe/workflows/references/reasoning-planning.md',
  execution: 'oxe/workflows/references/reasoning-execution.md',
  review: 'oxe/workflows/references/reasoning-review.md',
  status: 'oxe/workflows/references/reasoning-status.md',
};

const MODE_GUIDANCE = {
  discovery: [
    'Explorar o repositório e os artefatos antes de perguntar.',
    'Separar fatos confirmados, inferências e lacunas.',
    'Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.',
  ],
  planning: [
    'Fechar interfaces, validação, riscos, rollback e assumptions relevantes.',
    'Não deixar decisões importantes para quem implementar depois.',
    'Explicitar confiança e condição objetiva para replanejar.',
  ],
  execution: [
    'Fazer reconhecimento curto antes de editar ou executar mutações.',
    'Trabalhar no menor write set viável e validar após cada fatia relevante.',
    'Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.',
  ],
  review: [
    'Apresentar findings primeiro, ordenados por severidade e evidência.',
    'Separar bug, risco, regressão e lacuna de teste.',
    'Se não houver findings, declarar isso explicitamente e listar riscos residuais.',
  ],
  status: [
    'Responder com leitura curta e orientada a decisão.',
    'Dar uma recomendação única e justificar o motivo.',
    'Explicitar a confiança quando o estado estiver incompleto ou ambíguo.',
  ],
};

const MODE_DEFAULTS = {
  discovery: {
    oxe_reasoning_mode: 'discovery',
    oxe_question_policy: 'explore_first',
    oxe_output_contract: 'situational',
    oxe_tool_profile: 'read_heavy',
    oxe_confidence_policy: 'explicit',
  },
  planning: {
    oxe_reasoning_mode: 'planning',
    oxe_question_policy: 'ask_high_impact_only',
    oxe_output_contract: 'plan',
    oxe_tool_profile: 'mixed',
    oxe_confidence_policy: 'rubric',
  },
  execution: {
    oxe_reasoning_mode: 'execution',
    oxe_question_policy: 'ask_high_impact_only',
    oxe_output_contract: 'execution',
    oxe_tool_profile: 'write_bounded',
    oxe_confidence_policy: 'explicit',
  },
  review: {
    oxe_reasoning_mode: 'review',
    oxe_question_policy: 'none',
    oxe_output_contract: 'findings',
    oxe_tool_profile: 'review_heavy',
    oxe_confidence_policy: 'explicit',
  },
  status: {
    oxe_reasoning_mode: 'status',
    oxe_question_policy: 'none',
    oxe_output_contract: 'routing',
    oxe_tool_profile: 'read_heavy',
    oxe_confidence_policy: 'explicit',
  },
};

const WORKFLOW_RUNTIME_METADATA = {
  ask: MODE_DEFAULTS.discovery,
  capabilities: {
    ...MODE_DEFAULTS.execution,
    oxe_tool_profile: 'mixed',
  },
  checkpoint: MODE_DEFAULTS.execution,
  compact: {
    ...MODE_DEFAULTS.discovery,
    oxe_output_contract: 'execution',
    oxe_tool_profile: 'mixed',
  },
  dashboard: {
    ...MODE_DEFAULTS.status,
    oxe_output_contract: 'situational',
  },
  debug: MODE_DEFAULTS.execution,
  discuss: MODE_DEFAULTS.discovery,
  execute: MODE_DEFAULTS.execution,
  forensics: MODE_DEFAULTS.execution,
  help: MODE_DEFAULTS.status,
  loop: MODE_DEFAULTS.execution,
  milestone: {
    ...MODE_DEFAULTS.planning,
    oxe_output_contract: 'execution',
  },
  next: MODE_DEFAULTS.status,
  obs: MODE_DEFAULTS.execution,
  oxe: MODE_DEFAULTS.status,
  'plan-agent': MODE_DEFAULTS.planning,
  plan: MODE_DEFAULTS.planning,
  project: {
    ...MODE_DEFAULTS.planning,
    oxe_output_contract: 'routing',
  },
  quick: MODE_DEFAULTS.planning,
  research: MODE_DEFAULTS.discovery,
  retro: MODE_DEFAULTS.review,
  'review-pr': MODE_DEFAULTS.review,
  route: MODE_DEFAULTS.status,
  scan: MODE_DEFAULTS.discovery,
  security: MODE_DEFAULTS.review,
  session: MODE_DEFAULTS.execution,
  skill: MODE_DEFAULTS.execution,
  spec: MODE_DEFAULTS.discovery,
  'ui-review': MODE_DEFAULTS.review,
  'ui-spec': MODE_DEFAULTS.planning,
  update: MODE_DEFAULTS.execution,
  'validate-gaps': MODE_DEFAULTS.review,
  verify: MODE_DEFAULTS.review,
  workstream: MODE_DEFAULTS.execution,
};

function slugFromPromptFilename(name) {
  return name.replace(/^oxe-/, '').replace(/\.prompt\.md$/i, '');
}

function slugFromCommandFilename(name) {
  return name.replace(/\.md$/i, '');
}

function getRuntimeMetadataForSlug(slug) {
  return WORKFLOW_RUNTIME_METADATA[slug] || MODE_DEFAULTS.status;
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
    read_heavy: 'leitura intensa',
    write_bounded: 'mutação limitada',
    review_heavy: 'revisão intensa',
    mixed: 'misto',
    explicit: 'explícita',
    rubric: 'rubrica',
    optional: 'opcional',
  };
  return labels[key] || key.replace(/_/g, ' ');
}

function buildReasoningContractBlock(meta, options = {}) {
  const includeReference = options.includeReference !== false;
  const mode = meta.oxe_reasoning_mode || 'status';
  const guidance = MODE_GUIDANCE[mode] || MODE_GUIDANCE.status;
  const lines = [
    '<!-- oxe-reasoning-contract:start -->',
    '',
    '**Contrato de raciocínio OXE deste comando**',
    `- **Modo:** ${humanizeValue(meta.oxe_reasoning_mode)}`,
    `- **Perguntas:** ${humanizeValue(meta.oxe_question_policy)}`,
    `- **Saída esperada:** ${humanizeValue(meta.oxe_output_contract)}`,
    `- **Perfil de ferramentas:** ${humanizeValue(meta.oxe_tool_profile)}`,
    `- **Política de confiança:** ${humanizeValue(meta.oxe_confidence_policy)}`,
    ...guidance.map((line) => `- ${line}`),
  ];
  if (includeReference && MODE_REFERENCES[mode]) {
    lines.push(`- **Referência canónica:** \`${MODE_REFERENCES[mode]}\``);
  }
  lines.push('', '<!-- oxe-reasoning-contract:end -->');
  return lines.join('\n');
}

module.exports = {
  MODE_DEFAULTS,
  MODE_REFERENCES,
  RUNTIME_METADATA_KEYS,
  WORKFLOW_RUNTIME_METADATA,
  buildReasoningContractBlock,
  getRuntimeMetadataForSlug,
  pickRuntimeMetadata,
  renderRuntimeMetadataLines,
  slugFromCommandFilename,
  slugFromPromptFilename,
};
