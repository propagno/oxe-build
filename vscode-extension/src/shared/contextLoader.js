'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Tenta parsear JSON do stdout do oxe-cc (pula linhas de banner antes do `{`).
 * @param {string} stdout
 * @returns {object | null}
 */
function parseJsonFromOutput(stdout) {
  if (!stdout) return null;
  const text = String(stdout).trim();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(text.slice(jsonStart));
  } catch {
    return null;
  }
}

/**
 * Tenta resolver o context pack via oxe-cc CLI.
 * Primeiro tenta o binário local em node_modules, depois npx global.
 * @param {string} projectRoot
 * @param {string} workflow
 * @returns {object | null}
 */
function resolveViaOxeCc(projectRoot, workflow) {
  const localBin = path.join(projectRoot, 'node_modules', 'oxe-cc', 'bin', 'oxe-cc.js');
  const args = ['context', 'inspect', '--workflow', workflow, '--json', '--dir', projectRoot];
  const env = { ...process.env, OXE_NO_BANNER: '1' };
  const opts = { cwd: projectRoot, encoding: 'utf8', timeout: 12000, env };

  // Tentativa 1 — binário local
  if (fs.existsSync(localBin)) {
    const r = spawnSync(process.execPath, [localBin, ...args], opts);
    if (r.status === 0) {
      const pack = parseJsonFromOutput(r.stdout);
      if (pack) return pack;
    }
  }

  // Tentativa 2 — npx (global ou cache)
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(npxCmd, ['oxe-cc', ...args], opts);
  if (r.status === 0) {
    return parseJsonFromOutput(r.stdout);
  }

  return null;
}

/**
 * Carrega o context pack para um workflow. Tenta disco primeiro, depois CLI.
 * @param {string} projectRoot
 * @param {string} workflow
 * @returns {object | null}
 */
function loadContextPack(projectRoot, workflow) {
  // Tentativa 1 — ler pack já materializado em disco
  const packPath = path.join(projectRoot, '.oxe', 'context', 'packs', `${workflow}.json`);
  if (fs.existsSync(packPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(packPath, 'utf8'));
      if (data && data.workflow) return data;
    } catch {
      // arquivo corrompido → tenta CLI
    }
  }

  // Tentativa 2 — resolver on-demand via oxe-cc
  return resolveViaOxeCc(projectRoot, workflow);
}

/**
 * Formata os artefatos selecionados do pack em markdown legível.
 * Usa semantic_summary quando disponível, cai para summary.
 * @param {object | null} pack
 * @returns {string}
 */
function formatArtifacts(pack) {
  if (!pack || !Array.isArray(pack.selected_artifacts)) return '';

  const artifacts = pack.selected_artifacts
    .filter((a) => a.exists && (a.semantic_summary || a.summary))
    .map((a) => {
      const content = (a.semantic_summary || a.summary || '').trim();
      if (!content) return null;
      const label = a.alias.replace(/_/g, ' ');
      const flags = [
        a.using_fallback ? '[fallback]' : '',
        a.required ? '[obrigatório]' : '',
      ].filter(Boolean).join(' ');
      return `### ${label}${flags ? ' ' + flags : ''}\n${content}`;
    })
    .filter(Boolean);

  return artifacts.length > 0 ? artifacts.join('\n\n') : '';
}

/**
 * Formata hipóteses pendentes do pack para o system prompt.
 * @param {object | null} pack
 * @returns {string}
 */
function formatHypotheses(pack) {
  if (!pack || !Array.isArray(pack.hypotheses)) return '';
  const pending = pack.hypotheses.filter((h) => h.status === 'pending');
  if (pending.length === 0) return '';
  const lines = pending.map((h) =>
    `- **[${h.id}]** ${h.condition}${h.checkpoint ? ` *(checkpoint: ${h.checkpoint})*` : ''}`
  );
  return `## Hipóteses críticas pendentes\n\n${lines.join('\n')}`;
}

/**
 * Formata gaps críticos do pack.
 * @param {object | null} pack
 * @returns {string}
 */
function formatGaps(pack) {
  if (!pack || !Array.isArray(pack.gaps)) return '';
  const critical = pack.gaps.filter((g) => g.severity === 'critical');
  if (critical.length === 0) return '';
  const lines = critical.map((g) => `- \`${g.alias}\`: ${g.reason}`);
  return `## Artefatos críticos ausentes\n\n${lines.join('\n')}`;
}

module.exports = {
  loadContextPack,
  formatArtifacts,
  formatHypotheses,
  formatGaps,
};
