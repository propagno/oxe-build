'use strict';

/** Instruções específicas por reasoning_mode */
const MODE_INSTRUCTIONS = {
  discovery: [
    'Explore o repositório e os artefatos antes de perguntar.',
    'Separe fatos confirmados, inferências e lacunas.',
    'Pergunte apenas ambiguidades que mudem a decisão ou o artefato final.',
  ],
  planning: [
    'Produza plano decision-complete — feche interfaces, validação, riscos, rollback e assumptions.',
    'Não deixe decisões importantes abertas para quem implementar depois.',
    'Explicite confiança e condição objetiva para replanejar.',
  ],
  execution: [
    'Faça reconhecimento curto antes de editar ou executar mutações.',
    'Trabalhe no menor write set viável e valide após cada fatia relevante.',
    'Pare e explicite o bloqueio quando houver hipótese crítica não verificada.',
  ],
  review: [
    'Apresente findings primeiro, ordenados por severidade e evidência.',
    'Separe bug, risco, regressão e lacuna de teste.',
    'Se não houver findings, declare isso explicitamente e liste riscos residuais.',
  ],
  status: [
    'Responda com leitura curta e orientada a decisão.',
    'Dê uma recomendação única e justifique o motivo.',
    'Explicite a confiança quando o estado estiver incompleto ou ambíguo.',
  ],
};

/** Instruções por sub-comando */
const COMMAND_INSTRUCTIONS = {
  replan: 'Sub-comando **replan**: leia LESSONS.md e lessons-metrics.json antes de replanejar. Registre o motivo do replanejamento e as lições aplicadas.',
  agents: 'Sub-comando **agents**: identifique 2–4 domínios distintos no PLAN.md e gere um blueprint multi-agente em formato plan-agents.json.',
  discuss: 'Sub-comando **discuss**: abra uma discussão estruturada. Pergunte sobre contexto, alternativas e trade-offs antes de gerar a spec.',
  wave: 'Sub-comando **wave**: o usuário indicou uma onda específica. Concentre o reconhecimento e a execução nessa onda apenas.',
  task: 'Sub-comando **task**: o usuário indicou uma tarefa específica (ex: T3). Execute apenas essa tarefa com reconhecimento mínimo.',
  audit: 'Sub-comando **audit**: modo auditor adversarial. Avalie SPEC.md + VERIFY.md sem consultar PLAN.md nem EXECUTION-RUNTIME.md. Objetivo: falsificar, não confirmar.',
};

/**
 * Formata o vetor de confiança do pack para o system prompt.
 * @param {object | null} pack
 * @returns {string}
 */
function formatConfidenceVector(pack) {
  const artifacts = pack?.selected_artifacts || [];
  const planArtifact = artifacts.find((a) => a.alias === 'plan' && a.exists);
  if (!planArtifact || !planArtifact.semantic_summary) return '';

  // Verificar se o semantic_summary contém dados de confiança
  if (!planArtifact.semantic_summary.includes('Confiança') &&
      !planArtifact.semantic_summary.includes('confidence')) return '';

  return '';  // O semantic_summary já inclui isso via extraction_intent=planning_input
}

/**
 * Constrói o system prompt completo para um agente OXE.
 *
 * @param {string} workflow - slug do workflow (ex: 'plan', 'execute')
 * @param {object | null} pack - context pack carregado
 * @param {string} stateText - conteúdo do STATE.md (truncado)
 * @param {string | undefined} command - sub-comando invocado (ex: 'replan')
 * @param {{ phase: string | null, session: string | null, nextStep: string | null }} stateInfo
 * @param {string} artifactsText - artefatos formatados pelo contextLoader
 * @param {string} hypothesesText - hipóteses formatadas
 * @param {string} gapsText - gaps formatados
 * @returns {string}
 */
function build(workflow, pack, stateText, command, stateInfo, artifactsText, hypothesesText, gapsText) {
  const contract = pack?.contract || {};
  const mode = contract.reasoning_mode || 'status';
  const guidance = Array.isArray(contract.guidance) && contract.guidance.length > 0
    ? contract.guidance
    : (MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.status);

  const modeInstructions = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.status;
  const commandInstruction = command && COMMAND_INSTRUCTIONS[command]
    ? `\n\n**${COMMAND_INSTRUCTIONS[command]}**`
    : '';

  // Resumo do estado do projeto
  const stateSection = stateText
    ? `## Estado atual do projeto\n\n${stateText}`
    : '';

  // Info de contexto rápido
  const contextInfo = [
    stateInfo.phase ? `- **Fase:** ${stateInfo.phase}` : '',
    stateInfo.session ? `- **Sessão ativa:** ${stateInfo.session}` : '',
    stateInfo.nextStep ? `- **Próximo passo sugerido:** ${stateInfo.nextStep}` : '',
  ].filter(Boolean).join('\n');

  // Qualidade do contexto
  let qualityNote = '';
  if (pack) {
    const quality = pack.context_quality;
    if (quality && quality.status === 'critical') {
      qualityNote = `\n> ⚠️ **Contexto crítico** (score: ${quality.score}/100) — artefatos obrigatórios ausentes. Declare fallback para leitura direta se necessário.`;
    } else if (pack.fallback_required) {
      qualityNote = '\n> ℹ️ **Contexto com fallback** — alguns artefatos foram resolvidos por caminhos alternativos.';
    }
    if (pack.freshness && pack.freshness.stale) {
      qualityNote += `\n> 🕐 **Pack desatualizado** (${pack.freshness.reason}) — considere regenerar com \`oxe-cc context build --workflow ${workflow}\`.`;
    }
  }

  const parts = [
    `Você é o agente **OXE ${workflow}**, especializado na fase de ${mode} do framework OXE (Orchestrated eXperience Engineering).`,
    '',
    '## Contrato de raciocínio',
    `- **Modo:** ${mode}`,
    `- **Política de perguntas:** ${contract.question_policy || 'none'}`,
    `- **Saída esperada:** ${contract.output_contract || 'routing'}`,
    `- **Perfil de ferramentas:** ${contract.tool_profile || 'read_heavy'}`,
    `- **Política de confiança:** ${contract.confidence_policy || 'explicit'}`,
    '',
    '## Diretrizes de raciocínio',
    ...guidance.map((g) => `- ${g}`),
    '',
  ];

  if (contextInfo) {
    parts.push('## Contexto rápido', contextInfo, '');
  }

  if (stateSection) {
    parts.push(stateSection, '');
  }

  if (artifactsText) {
    parts.push('## Artefatos do projeto', artifactsText, '');
  }

  if (hypothesesText) {
    parts.push(hypothesesText, '');
  }

  if (gapsText) {
    parts.push(gapsText, '');
  }

  if (qualityNote) {
    parts.push(qualityNote.trim(), '');
  }

  parts.push(
    '## Instrução geral',
    'Responda **em português**. Use evidência explícita dos artefatos acima — não invente estado. ' +
    modeInstructions.join(' ') +
    commandInstruction
  );

  return parts.join('\n').trim();
}

module.exports = { build };
