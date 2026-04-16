'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Retorna o caminho raiz do primeiro workspace folder, ou null.
 * @param {readonly import('vscode').WorkspaceFolder[] | undefined} folders
 * @returns {string | null}
 */
function getProjectRoot(folders) {
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

/**
 * Verifica se o projeto tem estrutura OXE inicializada.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function hasOxe(projectRoot) {
  try {
    return fs.existsSync(path.join(projectRoot, '.oxe', 'STATE.md'));
  } catch {
    return false;
  }
}

/**
 * Lê o conteúdo de STATE.md, retorna string vazia se ausente.
 * @param {string} projectRoot
 * @returns {string}
 */
function readState(projectRoot) {
  try {
    const statePath = path.join(projectRoot, '.oxe', 'STATE.md');
    return fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * Extrai a fase atual do STATE.md (padrão: backtick ou campo `fase_atual:`).
 * @param {string} stateText
 * @returns {string | null}
 */
function parsePhase(stateText) {
  // Padrão OXE: ## Fase atual \n\n `scan_complete`
  const backtickMatch = stateText.match(/##\s*Fase\s*atual[\s\S]*?`([^`]+)`/im);
  if (backtickMatch) return backtickMatch[1].trim();
  // Fallback: fase_atual: valor
  const fieldMatch = stateText.match(/fase_atual:\s*([^\n]+)/i);
  return fieldMatch ? fieldMatch[1].trim() : null;
}

/**
 * Extrai a sessão ativa do STATE.md.
 * @param {string} stateText
 * @returns {string | null}
 */
function parseActiveSession(stateText) {
  const m = stateText.match(/active_session:\s*([^\n]+)/i);
  if (!m) return null;
  const val = m[1].trim().replace(/["'`]/g, '');
  return val === 'null' || val === '' ? null : val;
}

/**
 * Extrai próximo passo recomendado do STATE.md.
 * @param {string} stateText
 * @returns {string | null}
 */
function parseNextStep(stateText) {
  const m = stateText.match(/próximo[_\s]passo:\s*([^\n]+)/i)
    || stateText.match(/next[_\s]step:\s*([^\n]+)/i);
  return m ? m[1].trim().replace(/["'`]/g, '') : null;
}

/**
 * Retorna um resumo compacto do estado do projeto para o system prompt.
 * @param {string} projectRoot
 * @returns {{ text: string, phase: string | null, session: string | null, nextStep: string | null }}
 */
function getProjectContext(projectRoot) {
  const text = readState(projectRoot);
  const phase = parsePhase(text);
  const session = parseActiveSession(text);
  const nextStep = parseNextStep(text);
  return { text: text.slice(0, 800), phase, session, nextStep };
}

module.exports = {
  getProjectRoot,
  hasOxe,
  readState,
  parsePhase,
  parseActiveSession,
  parseNextStep,
  getProjectContext,
};
