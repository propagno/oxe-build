'use strict';

/**
 * OXE Security — validação de caminhos e detecção de padrões sensíveis.
 * Usado pelo SDK e opcionalmente pelos workflows via `oxe-cc doctor`.
 */

const fs = require('fs');
const path = require('path');

/**
 * Padrões de arquivos sensíveis que não devem aparecer em commits ou outputs.
 * @type {RegExp[]}
 */
const DEFAULT_SECRET_PATTERNS = [
  /\.env(\.\w+)?$/i,
  /secrets?\.(json|yaml|yml|toml|ini)$/i,
  /credentials?\.(json|yaml|yml)$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_(rsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /serviceAccountKey\.json$/i,
  /firebase-adminsdk.*\.json$/i,
  /aws-credentials/i,
  /\.npmrc$/i,
  /\.netrc$/i,
  /htpasswd/i,
  /vault[_-]token/i,
];

/**
 * Padrões de conteúdo que indicam segredos inline.
 * @type {RegExp[]}
 */
const DEFAULT_SECRET_CONTENT_PATTERNS = [
  /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i,
  /(?:BEGIN\s+(?:RSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY)/i,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,  // AWS access key
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,  // JWT
  /ghp_[a-zA-Z0-9]{36}/,  // GitHub Personal Access Token
  /ghs_[a-zA-Z0-9]{36}/,  // GitHub App Token
  /glpat-[a-zA-Z0-9\-_]{20}/,  // GitLab PAT
];

/**
 * Caminhos sempre negados (nunca devem ser lidos/escritos por workflows).
 * @type {RegExp[]}
 */
const DEFAULT_DENIED_PATH_PATTERNS = [
  /node_modules[/\\]/,
  /\.git[/\\]/,
  /dist[/\\]/,
  /build[/\\]/,
  /coverage[/\\]/,
  /\.cache[/\\]/,
];

/**
 * Verifica se um caminho é seguro para uso em workflows.
 *
 * @param {string} filePath - Caminho a verificar (absoluto ou relativo ao projeto).
 * @param {string} projectRoot - Raiz do projeto.
 * @param {{
 *   allowedRoots?: string[],
 *   deniedPatterns?: RegExp[],
 *   secretPatterns?: RegExp[],
 * }} [options]
 * @returns {{ safe: boolean, reason: string | null }}
 */
function checkPathSafety(filePath, projectRoot, options = {}) {
  const deniedPatterns = options.deniedPatterns || DEFAULT_DENIED_PATH_PATTERNS;
  const secretPatterns = options.secretPatterns || DEFAULT_SECRET_PATTERNS;

  const resolved = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.normalize(path.join(projectRoot, filePath));

  // Verifica path traversal
  const normalizedRoot = path.normalize(projectRoot);
  if (!resolved.startsWith(normalizedRoot)) {
    return {
      safe: false,
      reason: `Path traversal detectado: "${filePath}" sai da raiz do projeto`,
    };
  }

  // Verifica padrões negados
  const relative = path.relative(normalizedRoot, resolved);
  for (const pattern of deniedPatterns) {
    if (pattern.test(relative)) {
      return {
        safe: false,
        reason: `Caminho em área negada (${pattern}): "${relative}"`,
      };
    }
  }

  // Verifica padrões de segredos por nome de arquivo
  const basename = path.basename(resolved);
  for (const pattern of secretPatterns) {
    if (pattern.test(basename)) {
      return {
        safe: false,
        reason: `Nome de arquivo indica segredo (${pattern}): "${basename}"`,
      };
    }
  }

  return { safe: true, reason: null };
}

/**
 * Escaneia um arquivo em busca de padrões de segredos inline.
 *
 * @param {string} filePath - Caminho absoluto ao arquivo.
 * @param {{ contentPatterns?: RegExp[] }} [options]
 * @returns {{ hasSecrets: boolean, matches: Array<{ line: number, pattern: string, preview: string }> }}
 */
function scanFileForSecrets(filePath, options = {}) {
  const contentPatterns = options.contentPatterns || DEFAULT_SECRET_CONTENT_PATTERNS;

  if (!fs.existsSync(filePath)) {
    return { hasSecrets: false, matches: [] };
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { hasSecrets: false, matches: [] };
  }

  /** @type {Array<{ line: number, pattern: string, preview: string }>} */
  const matches = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of contentPatterns) {
      if (pattern.test(line)) {
        matches.push({
          line: i + 1,
          pattern: pattern.toString(),
          preview: line.trim().slice(0, 80) + (line.trim().length > 80 ? '…' : ''),
        });
        break; // Um match por linha é suficiente
      }
    }
  }

  return { hasSecrets: matches.length > 0, matches };
}

/**
 * Escaneia um diretório em busca de arquivos com nomes de segredos.
 *
 * @param {string} dir - Diretório a escanear.
 * @param {{ secretPatterns?: RegExp[], maxDepth?: number }} [options]
 * @returns {string[]} Lista de caminhos relativos com problemas.
 */
function scanDirForSecretFiles(dir, options = {}) {
  const secretPatterns = options.secretPatterns || DEFAULT_SECRET_PATTERNS;
  const maxDepth = options.maxDepth ?? 4;
  /** @type {string[]} */
  const found = [];

  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && depth > 0) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        for (const pattern of secretPatterns) {
          if (pattern.test(entry.name)) {
            found.push(path.relative(dir, full));
            break;
          }
        }
      }
    }
  }

  walk(dir, 0);
  return found;
}

/**
 * Valida que um conjunto de caminhos (do PLAN.md) são seguros.
 *
 * @param {string[]} filePaths
 * @param {string} projectRoot
 * @returns {{ ok: boolean, issues: Array<{ path: string, reason: string }> }}
 */
function validatePlanPaths(filePaths, projectRoot) {
  /** @type {Array<{ path: string, reason: string }>} */
  const issues = [];
  for (const fp of filePaths) {
    const check = checkPathSafety(fp, projectRoot);
    if (!check.safe) {
      issues.push({ path: fp, reason: check.reason || 'caminho inseguro' });
    }
  }
  return { ok: issues.length === 0, issues };
}

module.exports = {
  checkPathSafety,
  scanFileForSecrets,
  scanDirForSecretFiles,
  validatePlanPaths,
  DEFAULT_SECRET_PATTERNS,
  DEFAULT_SECRET_CONTENT_PATTERNS,
  DEFAULT_DENIED_PATH_PATTERNS,
};
