'use strict';

const fs = require('fs');
const health = require('./oxe-project-health.cjs');

/**
 * Aplica o bloco `install` de `.oxe/config.json` a uma cópia das opções de instalação.
 * Flags da CLI devem estar já refletidas em `optsIn` (este módulo não lê argv).
 *
 * @param {string} projectRoot raiz do projeto
 * @param {Record<string, unknown>} optsIn opções parciais (ex.: resultado de parse)
 * @returns {{ options: Record<string, unknown>, warnings: string[] }}
 */
function resolveInstallOptionsFromConfig(projectRoot, optsIn) {
  /** @type {string[]} */
  const warnings = [];
  const opts = { ...optsIn };

  if (opts.ignoreInstallConfig) return { options: opts, warnings };
  if (!fs.existsSync(projectRoot)) return { options: opts, warnings };

  const { config, parseError } = health.loadOxeConfigMerged(projectRoot);
  if (parseError) {
    warnings.push(`config.json ignorado (parse error): ${parseError}`);
    return { options: opts, warnings };
  }

  const inst = config.install;
  if (!inst || typeof inst !== 'object' || Array.isArray(inst)) return { options: opts, warnings };

  const profileSet = new Set(health.INSTALL_PROFILES);
  const layoutSet = new Set(health.INSTALL_REPO_LAYOUTS);

  if (!opts.explicitScope && !opts.oxeOnly && typeof inst.repo_layout === 'string' && layoutSet.has(inst.repo_layout)) {
    opts.installAssetsGlobal = inst.repo_layout === 'classic';
    opts.explicitScope = true;
  }

  if (!opts.oxeOnly && inst.vscode === true) {
    opts.vscode = true;
  }

  if (!opts.integrationsUnset || opts.oxeOnly) return { options: opts, warnings };
  if (inst.profile == null) return { options: opts, warnings };

  if (typeof inst.profile !== 'string' || !profileSet.has(inst.profile)) {
    const shown = typeof inst.profile === 'string' ? `"${inst.profile}"` : '(tipo inválido)';
    warnings.push(`install.profile ${shown} ignorado — use um de: ${health.INSTALL_PROFILES.join(', ')}`);
    return { options: opts, warnings };
  }

  const p = inst.profile;
  opts.cursor = false;
  opts.copilot = false;
  opts.copilotCli = false;
  opts.allAgents = false;

  if (p === 'recommended') {
    opts.cursor = true;
    opts.copilot = true;
  } else if (p === 'cursor') {
    opts.cursor = true;
  } else if (p === 'copilot') {
    opts.copilot = true;
  } else if (p === 'core') {
    opts.commands = false;
    opts.agents = false;
  } else if (p === 'cli') {
    opts.cursor = true;
    opts.copilot = true;
    opts.copilotCli = true;
  } else if (p === 'all_agents') {
    opts.cursor = true;
    opts.copilot = true;
    opts.copilotCli = true;
    opts.allAgents = true;
  }

  if (p !== 'core') {
    opts.commands = true;
    opts.agents = true;
  }
  if (typeof inst.include_commands_dir === 'boolean') {
    opts.commands = inst.include_commands_dir;
  }
  if (typeof inst.include_agents_md === 'boolean') {
    opts.agents = inst.include_agents_md;
  }

  opts.integrationsUnset = false;
  return { options: opts, warnings };
}

module.exports = {
  resolveInstallOptionsFromConfig,
};
