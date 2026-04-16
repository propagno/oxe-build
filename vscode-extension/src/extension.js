'use strict';

const vscode = require('vscode');
const stateReader = require('./shared/stateReader');
const contextLoader = require('./shared/contextLoader');
const contractBuilder = require('./shared/contractBuilder');

// ---------------------------------------------------------------------------
// Output channel para diagnóstico
// ---------------------------------------------------------------------------

/** @type {vscode.OutputChannel | null} */
let outputChannel = null;

function log(message) {
  if (outputChannel) outputChannel.appendLine(`[OXE Agents] ${message}`);
}

// ---------------------------------------------------------------------------
// Configuração dos 13 agentes
// ---------------------------------------------------------------------------

/** @type {Array<{ id: string, workflow: string, description: string, isSticky: boolean }>} */
const AGENTS = [
  { id: 'oxe.router',       workflow: 'oxe',          isSticky: false },
  { id: 'oxe.ask',          workflow: 'ask',           isSticky: false },
  { id: 'oxe.scan',         workflow: 'scan',          isSticky: false },
  { id: 'oxe.spec',         workflow: 'spec',          isSticky: true  },
  { id: 'oxe.plan',         workflow: 'plan',          isSticky: true  },
  { id: 'oxe.quick',        workflow: 'quick',         isSticky: true  },
  { id: 'oxe.execute',      workflow: 'execute',       isSticky: true  },
  { id: 'oxe.debug',        workflow: 'debug',         isSticky: false },
  { id: 'oxe.verify',       workflow: 'verify',        isSticky: true  },
  { id: 'oxe.review',       workflow: 'review-pr',     isSticky: false },
  { id: 'oxe.capabilities', workflow: 'capabilities',  isSticky: false },
  { id: 'oxe.skill',        workflow: 'skill',         isSticky: false },
  { id: 'oxe.dashboard',    workflow: 'dashboard',     isSticky: false },
];

// ---------------------------------------------------------------------------
// Seleção de modelo
// ---------------------------------------------------------------------------

/**
 * Seleciona o melhor modelo disponível — GPT-4o via Copilot com fallbacks.
 * @returns {Promise<import('vscode').LanguageModelChat | null>}
 */
async function selectModel() {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
    log('vscode.lm.selectChatModels não disponível nesta versão do VS Code.');
    return null;
  }

  const selectors = [
    { vendor: 'copilot', family: 'gpt-4o' },
    { vendor: 'copilot', family: 'claude-sonnet' },
    { vendor: 'copilot' },
    {},
  ];

  for (const selector of selectors) {
    try {
      const models = await vscode.lm.selectChatModels(selector);
      if (models && models.length > 0) {
        log(`Modelo selecionado: ${models[0].name || models[0].id || JSON.stringify(selector)}`);
        return models[0];
      }
    } catch (err) {
      log(`selectChatModels(${JSON.stringify(selector)}) falhou: ${err.message}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Conversão de histórico — duck typing para evitar quebra em versões antigas
// ---------------------------------------------------------------------------

/**
 * Converte as últimas N trocas do histórico em mensagens para o LM.
 * Usa duck typing em vez de instanceof para compatibilidade.
 * @param {readonly unknown[]} history
 * @param {number} maxTurns
 * @returns {import('vscode').LanguageModelChatMessage[]}
 */
function buildHistoryMessages(history, maxTurns = 3) {
  if (!history || !history.length) return [];
  if (!vscode.LanguageModelChatMessage) return [];

  const messages = [];
  const recent = history.slice(-maxTurns * 2);

  for (const turn of recent) {
    if (!turn || typeof turn !== 'object') continue;

    // ChatRequestTurn: tem propriedade `prompt` (string)
    if (typeof turn.prompt === 'string' && turn.prompt.trim()) {
      try {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } catch { /* API incompatível */ }
      continue;
    }

    // ChatResponseTurn: tem propriedade `response` (array de parts)
    if (Array.isArray(turn.response)) {
      const text = turn.response
        .filter((part) => part && typeof part === 'object' && part.value && typeof part.value.value === 'string')
        .map((part) => part.value.value)
        .join('');
      if (text.trim()) {
        try {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        } catch { /* API incompatível */ }
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Verificar se o projeto tem OXE inicializado
// ---------------------------------------------------------------------------

/**
 * Garante que o workspace tem OXE. Retorna o root ou null com mensagem de erro.
 * @param {import('vscode').ChatResponseStream} stream
 * @returns {string | null}
 */
function requireOxeProject(stream) {
  const root = stateReader.getProjectRoot(vscode.workspace.workspaceFolders);

  if (!root) {
    stream.markdown(
      '⚠️ **Nenhum workspace aberto.**\n\nAbra uma pasta de projeto para usar os agentes OXE.\n\n' +
      '```\nFile → Open Folder → selecione a pasta do seu projeto\n```'
    );
    return null;
  }

  if (!stateReader.hasOxe(root)) {
    stream.markdown(
      `⚠️ **Projeto OXE não inicializado** em \`${root}\`.\n\n` +
      'Execute no terminal para instalar o OXE:\n\n' +
      '```bash\nnpx oxe-cc@latest\n```'
    );
    return null;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Handler genérico
// ---------------------------------------------------------------------------

/**
 * Cria o handler de um agente OXE.
 * @param {{ id: string, workflow: string }} agentDef
 * @returns {import('vscode').ChatRequestHandler}
 */
function makeHandler(agentDef) {
  const { workflow } = agentDef;

  return async (request, context, stream, token) => {
    log(`Handler invocado: ${agentDef.id} | prompt: "${(request.prompt || '').slice(0, 60)}"${request.command ? ' | cmd: /' + request.command : ''}`);

    // 1. Verificar projeto
    const projectRoot = requireOxeProject(stream);
    if (!projectRoot) return;

    // 2. Mostrar progresso
    stream.progress(`Carregando contexto OXE — workflow: ${workflow}…`);

    // 3. Ler state
    const stateInfo = stateReader.getProjectContext(projectRoot);
    log(`Estado: fase=${stateInfo.phase}, sessão=${stateInfo.session}`);

    // 4. Carregar context pack
    const pack = contextLoader.loadContextPack(projectRoot, workflow);
    log(`Context pack: ${pack ? `carregado (quality=${pack.context_quality?.score})` : 'não encontrado — usando fallback'}`);

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
    log(`System prompt: ${systemPrompt.length} chars`);

    // 7. Selecionar modelo
    const model = await selectModel();
    if (!model) {
      stream.markdown(
        '⚠️ **Nenhum modelo de linguagem disponível.**\n\n' +
        'Verifique se o **GitHub Copilot Chat** está instalado, habilitado e autenticado no VS Code.\n\n' +
        '> Extensão necessária: `GitHub.copilot-chat`'
      );
      return;
    }

    // 8. Construir mensagens
    const historyMessages = buildHistoryMessages(context.history);
    const userMessage = request.command
      ? `[/${request.command}] ${request.prompt}`
      : request.prompt;

    const messages = [];
    try {
      messages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
    } catch (err) {
      log(`Erro ao criar LanguageModelChatMessage: ${err.message}`);
      stream.markdown('⚠️ API de mensagens não disponível nesta versão do VS Code. Requer VS Code 1.95+.');
      return;
    }
    messages.push(...historyMessages);
    messages.push(vscode.LanguageModelChatMessage.User(userMessage));

    // 9. Enviar e fazer stream
    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        if (token.isCancellationRequested) break;
        stream.markdown(chunk);
      }
      log(`Resposta concluída para ${agentDef.id}`);
    } catch (err) {
      if (err.name === 'CancellationError' || err.code === 'Cancelled') return;

      // Tratar erros conhecidos do LM de forma segura (sem depender de statics que podem não existir)
      const errMsg = err.message || String(err);
      if (/blocked/i.test(errMsg)) {
        stream.markdown('⚠️ **Solicitação bloqueada** pelo modelo. Reformule a pergunta e tente novamente.');
      } else if (/not found/i.test(errMsg) || /unavailable/i.test(errMsg)) {
        stream.markdown('⚠️ **Modelo indisponível.** Verifique as configurações do GitHub Copilot.');
      } else if (/permission|quota/i.test(errMsg)) {
        stream.markdown('⚠️ **Sem permissão ou cota esgotada.** Verifique a assinatura do Copilot.');
      } else {
        stream.markdown(`⚠️ **Erro:** ${errMsg}`);
      }
      log(`Erro no handler ${agentDef.id}: ${errMsg}`);
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
  // Criar output channel para diagnóstico
  outputChannel = vscode.window.createOutputChannel('OXE Agents');
  context.subscriptions.push(outputChannel);
  log(`Extensão ativando — VS Code ${vscode.version}`);

  // Guard: verificar se a API de chat está disponível
  if (!vscode.chat || typeof vscode.chat.createChatParticipant !== 'function') {
    const msg = 'OXE Agents requer GitHub Copilot Chat (GitHub.copilot-chat) instalado e habilitado no VS Code.';
    log(`AVISO: ${msg}`);
    vscode.window.showWarningMessage(msg);
    return;
  }

  // Registrar todos os agentes
  let registered = 0;
  for (const agentDef of AGENTS) {
    try {
      const participant = vscode.chat.createChatParticipant(agentDef.id, makeHandler(agentDef));
      participant.iconPath = new vscode.ThemeIcon('sparkle');
      context.subscriptions.push(participant);
      registered++;
      log(`Agente registrado: ${agentDef.id}`);
    } catch (err) {
      log(`Falha ao registrar ${agentDef.id}: ${err.message}`);
    }
  }

  log(`${registered}/${AGENTS.length} agentes registrados com sucesso.`);

  // Notificar na primeira ativação
  const key = 'oxe.agents.v2.activated';
  if (!context.globalState.get(key)) {
    context.globalState.update(key, true);
    vscode.window.showInformationMessage(
      `OXE Agents: ${registered} agentes ativos. Use @oxe, @oxe-plan, @oxe-execute e outros no chat do Copilot.`,
      'Ver log'
    ).then((choice) => {
      if (choice === 'Ver log') outputChannel?.show();
    });
  }
}

function deactivate() {
  log('Extensão desativada.');
}

module.exports = { activate, deactivate };
