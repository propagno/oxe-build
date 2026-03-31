'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve o diretório de workflows OXE no projeto (`.oxe/workflows` tem precedência sobre `oxe/workflows`).
 * @param {string} targetProject raiz do repositório alvo
 * @returns {string | null} caminho absoluto ou null
 */
function resolveWorkflowsDir(targetProject) {
  const nested = path.join(targetProject, '.oxe', 'workflows');
  const root = path.join(targetProject, 'oxe', 'workflows');
  if (fs.existsSync(nested)) return nested;
  if (fs.existsSync(root)) return root;
  return null;
}

/**
 * Lista ficheiros `*.md` num diretório de workflows (sem recursão).
 * @param {string} workflowsDir
 * @returns {string[]} nomes ordenados
 */
function listWorkflowMdFiles(workflowsDir) {
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Compara dois conjuntos de workflows (ex.: pacote npm vs projeto).
 * @param {string} expectedDir diretório canónico (ex. `…/oxe/workflows` do pacote)
 * @param {string} actualDir diretório no projeto
 * @returns {{ expected: string[], actual: string[], missing: string[], extra: string[], ok: boolean }}
 */
function diffWorkflows(expectedDir, actualDir) {
  const expected = listWorkflowMdFiles(expectedDir);
  const actual = listWorkflowMdFiles(actualDir);
  const actSet = new Set(actual);
  const expSet = new Set(expected);
  const missing = expected.filter((f) => !actSet.has(f));
  const extra = actual.filter((f) => !expSet.has(f));
  return { expected, actual, missing, extra, ok: missing.length === 0 };
}

/** Ficheiros onde não exigimos `<success_criteria>` / `<success>` (critérios noutro bloco ou passo minimalista). */
const SUCCESS_CRITERIA_EXCEPTIONS = new Set(['help.md']);

const DEFAULT_MAX_BYTES_SOFT = 45000;

/**
 * Validação flexível da estrutura dos workflows (avisos, não bloqueante).
 * @param {string} workflowsDir diretório absoluto com `*.md` (sem recursão)
 * @param {{ maxBytesSoft?: number }} [options]
 * @returns {{
 *   fileResults: Array<{ file: string, warnings: string[] }>,
 *   warnings: Array<{ code: 'WORKFLOW_SHAPE', message: string, detail?: { file: string } }>,
 * }}
 */
function validateWorkflowShapes(workflowsDir, options = {}) {
  /** @type {Array<{ file: string, warnings: string[] }>} */
  const fileResults = [];
  /** @type {Array<{ code: 'WORKFLOW_SHAPE', message: string, detail?: { file: string } }>} */
  const warnings = [];
  if (!workflowsDir || !fs.existsSync(workflowsDir)) {
    return { fileResults, warnings };
  }
  const maxBytesSoft = options.maxBytesSoft ?? DEFAULT_MAX_BYTES_SOFT;
  const files = listWorkflowMdFiles(workflowsDir);

  for (const file of files) {
    const full = path.join(workflowsDir, file);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      warnings.push({
        code: 'WORKFLOW_SHAPE',
        message: `${file}: não foi possível ler o ficheiro`,
        detail: { file },
      });
      continue;
    }

    const fileWarnings = [];

    const iObj = content.indexOf('<objective>');
    const iObjEnd = content.indexOf('</objective>');
    if (iObj === -1 && iObjEnd === -1) {
      fileWarnings.push('falta bloco <objective>…</objective>');
    } else {
      if (iObj === -1) fileWarnings.push('falta tag de abertura <objective>');
      if (iObjEnd === -1) fileWarnings.push('falta tag de fecho </objective>');
      if (iObj !== -1 && iObjEnd !== -1 && iObjEnd < iObj) {
        fileWarnings.push('</objective> aparece antes de <objective>');
      }
    }

    if (file === 'help.md') {
      if (content.indexOf('<output>') === -1 || content.indexOf('</output>') === -1) {
        fileWarnings.push('help.md deveria incluir <output>…</output>');
      }
    } else if (!SUCCESS_CRITERIA_EXCEPTIONS.has(file)) {
      const hasSC =
        content.includes('<success_criteria>') && content.includes('</success_criteria>');
      const hasSuccess = content.includes('<success>') && content.includes('</success>');
      if (!hasSC && !hasSuccess) {
        fileWarnings.push(
          'sem <success_criteria> nem <success>; veja oxe/templates/WORKFLOW_AUTHORING.md'
        );
      }
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytesSoft) {
      fileWarnings.push(
        `ficheiro grande (${bytes} bytes); considere extrair para oxe/workflows/references/ (limite suave ${maxBytesSoft})`
      );
    }

    if (fileWarnings.length) {
      fileResults.push({ file, warnings: fileWarnings });
      for (const msg of fileWarnings) {
        warnings.push({
          code: 'WORKFLOW_SHAPE',
          message: `${file}: ${msg}`,
          detail: { file },
        });
      }
    }
  }

  return { fileResults, warnings };
}

module.exports = {
  resolveWorkflowsDir,
  listWorkflowMdFiles,
  diffWorkflows,
  validateWorkflowShapes,
  DEFAULT_MAX_BYTES_SOFT,
  SUCCESS_CRITERIA_EXCEPTIONS,
};
