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

  if (!opts.explicitIdeScope && !opts.oxeOnly && typeof inst.ide_scope === 'string') {
    if (inst.ide_scope === 'local') {
      opts.ideLocal = true;
      opts.explicitIdeScope = true;
    } else if (inst.ide_scope === 'global') {
      opts.ideLocal = false;
      opts.explicitIdeScope = true;
    }
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

/**
 * VSIX matching the package version, else the highest semver one. A plain `.sort()` compared
 * strings and installed 1.9.1 over 1.16.0.
 * @param {string[]} files
 * @param {string} pkgVersion
 * @returns {string | null}
 */
function pickVsixFile(files, pkgVersion) {
  const semver = require('semver');
  const candidates = files
    .map((name) => ({ name, version: (String(name).match(/^oxe-agents-(.+)\.vsix$/) || [])[1] }))
    .filter((entry) => entry.version && semver.valid(entry.version));
  const exact = candidates.find((entry) => entry.version === pkgVersion);
  if (exact) return exact.name;
  candidates.sort((a, b) => semver.rcompare(a.version, b.version));
  return candidates.length ? candidates[0].name : null;
}

/**
 * The extension only adds Copilot Chat participants: install it when VS Code/Copilot is being set up.
 * @param {{ copilot?: boolean, vscode?: boolean, allAgents?: boolean }} opts
 */
function shouldInstallVscodeExtension(opts) {
  return Boolean(opts && (opts.copilot || opts.vscode || opts.allAgents));
}

module.exports = {
  resolveInstallOptionsFromConfig,
  pickVsixFile,
  shouldInstallVscodeExtension,
};
