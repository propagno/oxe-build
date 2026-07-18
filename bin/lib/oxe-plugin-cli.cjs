'use strict';

const path = require('path');
const oxePlugins = require('./oxe-plugins.cjs');

const DEFAULT_COLORS = Object.freeze({
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
});

function defaultUseAnsiColors() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  return process.stdout.isTTY === true;
}

/**
 * Executa o subcomando `plugins` sem acoplar parsing e rendering ao CLI principal.
 * @param {string[]} argv
 * @param {{
 *   plugins?: typeof oxePlugins,
 *   cwd?: string,
 *   colors?: typeof DEFAULT_COLORS,
 *   useAnsiColors?: () => boolean,
 *   log?: (...args: unknown[]) => void,
 *   error?: (...args: unknown[]) => void,
 * }} [options]
 * @returns {number} exit code
 */
function runPluginCommand(argv, options = {}) {
  const plugins = options.plugins || oxePlugins;
  const colors = options.colors || DEFAULT_COLORS;
  const useAnsiColors = options.useAnsiColors || defaultUseAnsiColors;
  const log = options.log || console.log;
  const error = options.error || console.error;

  let pluginsDir = options.cwd || process.cwd();
  const pluginsArgv = argv.slice();
  for (let i = 0; i < pluginsArgv.length; i++) {
    if (pluginsArgv[i] === '--dir' && pluginsArgv[i + 1]) {
      pluginsDir = path.resolve(pluginsArgv[i + 1]);
      pluginsArgv.splice(i, 2);
      i--;
    }
  }

  const c = useAnsiColors();
  const subCmd = pluginsArgv[0] || 'list';
  const pluginTarget = pluginsArgv[1] || '';

  if (subCmd === 'list') {
    const result = plugins.loadPlugins(pluginsDir);
    log(`\n  ${c ? colors.green : ''}Plugins carregados:${c ? colors.reset : ''} ${result.plugins.length}`);
    for (const plugin of result.plugins) {
      log(`    • ${plugin.name}${plugin.version ? ` (${plugin.version})` : ''} — hooks: ${Object.keys(plugin.hooks).join(', ')}`);
    }
    if (result.errors.length) {
      log(`\n  ${c ? colors.yellow : ''}Erros:${c ? colors.reset : ''}`);
      for (const pluginError of result.errors) {
        log(`    ✗ ${pluginError.file}: ${pluginError.error}`);
      }
    }
    return 0;
  }

  if (subCmd === 'install' && pluginTarget) {
    const src = pluginTarget.startsWith('npm:') ? pluginTarget.slice(4) : pluginTarget;
    const version = pluginsArgv[2] || '';
    log(`  Instalando plugin: ${src}${version ? `@${version}` : ''}...`);
    const result = plugins.installNpmPlugin(pluginsDir, src, version || undefined);
    if (result.ok) {
      log(`  ${c ? colors.green : ''}✓${c ? colors.reset : ''} Instalado em: ${result.path}`);
      log(`  ${c ? colors.dim : ''}Adicione ao .oxe/config.json: "plugins": [{ "source": "npm:${src}" }]${c ? colors.reset : ''}`);
      return 0;
    }
    error(`  ${c ? colors.red : ''}✗ Falha:${c ? colors.reset : ''} ${result.error}`);
    return 1;
  }

  if (subCmd === 'remove' && pluginTarget) {
    log(`  ${c ? colors.yellow : ''}Remove "${pluginTarget}" de .oxe/config.json → plugins[] manualmente.${c ? colors.reset : ''}`);
    log(`  ${c ? colors.dim : ''}Arquivos npm: rm -rf .oxe/plugins/_npm/node_modules/${pluginTarget}${c ? colors.reset : ''}`);
    return 0;
  }

  log(`  ${c ? colors.yellow : ''}Uso: oxe-cc plugins list | install <npm-package> [version] | remove <id>${c ? colors.reset : ''}`);
  return 0;
}

module.exports = {
  runPluginCommand,
};
