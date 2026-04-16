'use strict';

const vscode = require('vscode');
const stateReader = require('./shared/stateReader');
const contextLoader = require('./shared/contextLoader');
const contractBuilder = require('./shared/contractBuilder');

// ---------------------------------------------------------------------------
// Configuração dos 10 agentes
// ---------------------------------------------------------------------------

/** @type {Array<{ id: string, workflow: string, description: string, isSticky: boolean }>} */
const AGENTS = [
  {
    id: 'oxe.router',
    workflow: 'oxe',
    description: 'Router universal OXE',
    isSticky: false,
  },
  {
    id: 'oxe.ask',
    workflow: 'ask',
    description: 'Situational awareness OXE',
    isSticky: false,
  },
  {
    id: 'oxe.scan',
    workflow: 'scan',
    description: 'Mapeamento do codebase OXE',
    isSticky: false,
  },
  {
    id: 'oxe.spec',
    workflow: 'spec',
    description: 'Especificação OXE',
    isSticky: true,
  },
  {
    id: 'oxe.plan',
    workflow: 'plan',
    description: 'Planejamento OXE',
    isSticky: true,
  },
  {
    id: 'oxe.quick',
    workflow: 'quick',
    description: 'Plano rápido OXE',
    isSticky: true,
  },
  {
    id: 'oxe.execute',
    workflow: 'execute',
    description: 'Execução OXE',
    isSticky: true,
  },
  {
    id: 'oxe.debug',
    workflow: 'debug',
    description: 'Debug OXE',
    isSticky: false,
  },
  {
    id: 'oxe.verify',
    workflow: 'verify',
    description: 'Verificação OXE',
    isSticky: true,
  },
  {
    id: 'oxe.review',
    workflow: 'review-pr',
    description: 'Revisão de código OXE',
    isSticky: false,
  },
];

// ---------------------------------------------------------------------------
// Seleção de modelo
// ---------------------------------------------------------------------------

/**
 * Seleciona o melhor modelo disponível via vscode.lm API.
 * Tenta GPT-4o via Copilot, depois qualquer modelo Copilot, depois qualquer modelo.
 * @returns {Promise<import('vscode').LanguageModelChat | null>}
 */
async function selectModel() {
  const selectors = [
    { vendor: 'copilot', family: 'gpt-4o' },
    { vendor: 'copilot', family: 'claude-sonnet' },
    { vendor: 'copilot' },
    {},
  ];

  for (const selector of selectors) {
    try {
      const models = await vscode.lm.selectChatModels(selector);
      if (models.length > 0) return models[0];
    } catch {
      // tenta próximo seletor
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Conversão de histórico
// ---------------------------------------------------------------------------

/**
 * Converte até N trocas do histórico de conversa em LanguageModelChatMessages.
 * @param {readonly (import('vscode').ChatRequestTurn | import('vscode').ChatResponseTurn)[]} history
 * @param {number} maxTurns
 * @returns {import('vscode').LanguageModelChatMessage[]}
 */
function buildHistoryMessages(history, maxTurns = 3) {
  const recent = history.slice(-maxTurns * 2);
  const messages = [];

  for (const turn of recent) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((part) => part instanceof vscode.ChatResponseMarkdownPart)
        .map((part) => part.value.value)
        .join('');
      if (text.trim()) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Handler genérico
// ---------------------------------------------------------------------------

/**
 * Cria o handler para um agente OXE.
 * @param {{ id: string, workflow: string }} agentDef
 * @returns {import('vscode').ChatRequestHandler}
 */
function makeHandler(agentDef) {
  return async (request, context, stream, token) => {
    const { workflow } = agentDef;

    // 1. Resolver workspace root
    const projectRoot = stateReader.getProjectRoot(vscode.workspace.workspaceFolders);
    if (!projectRoot) {
      stream.markdown(
        '⚠️ Nenhum workspace aberto. Abra uma pasta de projeto para usar os agentes OXE.'
      );
      return;
    }

    // 2. Verificar presença do OXE
    if (!stateReader.hasOxe(projectRoot)) {
      stream.markdown(
        `⚠️ Projeto OXE não inicializado em \`${projectRoot}\`.\n\n` +
        'Execute `npx oxe-cc` no terminal para instalar e inicializar o OXE neste projeto.'
      );
      return;
    }

    // 3. Progresso inicial
    stream.progress(`Carregando contexto OXE para o agente **${workflow}**…`);

    // 4. Ler state e carregar context pack em paralelo
    const stateInfo = stateReader.getProjectContext(projectRoot);

    // Para o modo auditor (/audit), usar context restrito
    const packMode = request.command === 'audit' ? 'auditor' : 'standard';
    const pack = contextLoader.loadContextPack(projectRoot, workflow);

    // 5. Formatar artefatos
    const artifactsText = contextLoader.formatArtifacts(pack);
    const hypothesesText = contextLoader.formatHypotheses(pack);
    const gapsText = contextLoader.formatGaps(pack);

    // 6. Construir system prompt
    const systemPrompt = contractBuilder.build(
      workflow,
      pack,
      stateInfo.text,
      request.command,
      stateInfo,
      artifactsText,
      hypothesesText,
      gapsText
    );

    // 7. Selecionar modelo
    const model = await selectModel();
    if (!model) {
      stream.markdown(
        '⚠️ Nenhum modelo de linguagem disponível.\n\n' +
        'Verifique se o GitHub Copilot está instalado e autenticado no VS Code.'
      );
      return;
    }

    // 8. Construir mensagens (system + histórico + pergunta atual)
    const historyMessages = buildHistoryMessages(context.history);
    const messages = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      ...historyMessages,
      vscode.LanguageModelChatMessage.User(
        request.command
          ? `[sub-comando: /${request.command}] ${request.prompt}`
          : request.prompt
      ),
    ];

    // 9. Enviar request e fazer stream da resposta
    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        if (token.isCancellationRequested) break;
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err.code === vscode.LanguageModelError.Blocked().code) {
        stream.markdown('⚠️ Solicitação bloqueada pelo modelo. Reformule a pergunta.');
      } else if (err.code === vscode.LanguageModelError.NotFound().code) {
        stream.markdown('⚠️ Modelo não encontrado. Verifique as configurações do GitHub Copilot.');
      } else if (err.code === vscode.LanguageModelError.NoPermissions().code) {
        stream.markdown('⚠️ Sem permissão para usar o modelo de linguagem. Verifique a assinatura do Copilot.');
      } else if (err.name !== 'CancellationError' && err.code !== 'Cancelled') {
        stream.markdown(`⚠️ Erro inesperado: ${err.message || String(err)}`);
      }
      // CancellationError é silenciosa
    }
  };
}

// ---------------------------------------------------------------------------
// Activate / Deactivate
// ---------------------------------------------------------------------------

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  for (const agentDef of AGENTS) {
    const participant = vscode.chat.createChatParticipant(agentDef.id, makeHandler(agentDef));
    participant.iconPath = new vscode.ThemeIcon('sparkle');
    context.subscriptions.push(participant);
  }

  // Notificação na primeira ativação
  context.globalState.get('oxe.agents.activated')
    ? undefined
    : context.globalState.update('oxe.agents.activated', true).then(() => {
        vscode.window.showInformationMessage(
          'OXE Agents ativados! Use @oxe, @oxe-plan, @oxe-execute e outros no chat do Copilot.'
        );
      });
}

function deactivate() {}

module.exports = { activate, deactivate };
