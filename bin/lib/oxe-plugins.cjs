'use strict';

/**
 * OXE Plugin System — carrega e executa plugins de `.oxe/plugins/`.
 *
 * Plugins são módulos CJS em `.oxe/plugins/*.cjs` que exportam hooks do ciclo de vida OXE.
 * Cada hook é uma função assíncrona que recebe o contexto do evento.
 *
 * Hooks disponíveis:
 *   - onBeforeScan(ctx)       — antes do workflow scan iniciar
 *   - onAfterScan(ctx)        — após o scan produzir os 7 mapas
 *   - onBeforeSpec(ctx)       — antes do workflow spec
 *   - onAfterSpec(ctx)        — após SPEC.md ser gerado
 *   - onBeforePlan(ctx)       — antes do workflow plan
 *   - onAfterPlan(ctx)        — após PLAN.md ser gerado
 *   - onPlanGenerated(ctx)    — alias de onAfterPlan
 *   - onBeforeExecute(ctx)    — antes de iniciar uma onda
 *   - onAfterExecute(ctx)     — após onda concluída
 *   - onBeforeVerify(ctx)     — antes do workflow verify
 *   - onAfterVerify(ctx)      — após VERIFY.md ser gerado
 *   - onVerifyComplete(ctx)   — quando verify_complete
 *   - onVerifyFailed(ctx)     — quando verify_failed
 *   - onMilestoneNew(ctx)     — novo milestone criado
 *   - onMilestoneComplete(ctx)— milestone encerrado
 *   - onWorkstreamNew(ctx)    — novo workstream criado
 *
 * Exemplo de plugin (`.oxe/plugins/notify.cjs`):
 * ```js
 * module.exports = {
 *   name: 'notify',
 *   version: '1.0.0',
 *   hooks: {
 *     async onAfterVerify({ projectRoot, result }) {
 *       if (result === 'verify_complete') {
 *         console.log('[notify] Verificação concluída! 🎉');
 *       }
 *     },
 *   },
 * };
 * ```
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{
 *   name: string,
 *   version?: string,
 *   hooks: Record<string, (ctx: Record<string, unknown>) => Promise<void> | void>,
 * }} OxePlugin
 */

/**
 * Carrega todos os plugins de `.oxe/plugins/`.
 *
 * @param {string} projectRoot
 * @returns {{ plugins: OxePlugin[], errors: Array<{ file: string, error: string }> }}
 */
function loadPlugins(projectRoot) {
  const pluginsDir = path.join(projectRoot, '.oxe', 'plugins');
  /** @type {OxePlugin[]} */
  const plugins = [];
  /** @type {Array<{ file: string, error: string }>} */
  const errors = [];

  if (!fs.existsSync(pluginsDir)) {
    return { plugins, errors };
  }

  let files;
  try {
    files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.cjs')).sort();
  } catch (e) {
    errors.push({ file: pluginsDir, error: String(e) });
    return { plugins, errors };
  }

  for (const file of files) {
    const fullPath = path.join(pluginsDir, file);
    try {
      // eslint-disable-next-line no-undef
      const mod = require(fullPath);
      if (!mod || typeof mod !== 'object') {
        errors.push({ file, error: 'Plugin deve exportar um objeto' });
        continue;
      }
      if (typeof mod.name !== 'string') {
        errors.push({ file, error: 'Plugin deve exportar `name` (string)' });
        continue;
      }
      if (!mod.hooks || typeof mod.hooks !== 'object') {
        errors.push({ file, error: 'Plugin deve exportar `hooks` (objeto com funções)' });
        continue;
      }
      plugins.push(mod);
    } catch (e) {
      errors.push({ file, error: String(e) });
    }
  }

  // Carregar plugins de sources externas (config.json → plugins[])
  const configPath = path.join(projectRoot, '.oxe', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(cfg.plugins)) {
        const { resolved, errors: srcErrors } = resolvePluginSources(projectRoot, cfg.plugins);
        for (const se of srcErrors) {
          errors.push({ file: se.source, error: se.error });
        }
        for (const absPath of resolved) {
          try {
            // eslint-disable-next-line no-undef
            const mod = require(absPath);
            if (mod && typeof mod === 'object' && typeof mod.name === 'string' && mod.hooks && typeof mod.hooks === 'object') {
              if (!plugins.some((existing) => existing.name === mod.name)) {
                plugins.push(mod);
              }
            } else {
              errors.push({ file: absPath, error: 'Plugin externo não tem name (string) ou hooks (objeto) válidos' });
            }
          } catch (e) {
            errors.push({ file: absPath, error: String(e) });
          }
        }
      }
    } catch { /* ignore config parse errors — validados em outro lugar */ }
  }

  return { plugins, errors };
}

/**
 * Executa um hook específico em todos os plugins carregados.
 * Erros em hooks individuais são capturados e não propagam.
 *
 * @param {OxePlugin[]} plugins
 * @param {string} hookName
 * @param {Record<string, unknown>} ctx
 * @returns {Promise<Array<{ plugin: string, error: string }>>} erros de execução (não fatais)
 */
async function runHook(plugins, hookName, ctx) {
  /** @type {Array<{ plugin: string, error: string }>} */
  const hookErrors = [];
  for (const plugin of plugins) {
    const hook = plugin.hooks[hookName];
    if (typeof hook !== 'function') continue;
    try {
      await hook(ctx);
    } catch (e) {
      hookErrors.push({ plugin: plugin.name, error: String(e) });
    }
  }
  return hookErrors;
}

/**
 * Valida a estrutura de todos os plugins em `.oxe/plugins/`.
 *
 * @param {string} projectRoot
 * @returns {{ valid: boolean, issues: Array<{ file: string, issue: string }> }}
 */
function validatePlugins(projectRoot) {
  const pluginsDir = path.join(projectRoot, '.oxe', 'plugins');
  /** @type {Array<{ file: string, issue: string }>} */
  const issues = [];

  if (!fs.existsSync(pluginsDir)) {
    return { valid: true, issues };
  }

  let files;
  try {
    files = fs.readdirSync(pluginsDir);
  } catch {
    return { valid: false, issues: [{ file: pluginsDir, issue: 'Não foi possível ler o diretório de plugins' }] };
  }

  const cjsFiles = files.filter((f) => f.endsWith('.cjs'));
  const nonCjs = files.filter((f) => !f.endsWith('.cjs') && !f.startsWith('.') && f !== 'README.md');

  for (const f of nonCjs) {
    issues.push({ file: f, issue: 'Plugins devem ter extensão .cjs' });
  }

  const { errors } = loadPlugins(projectRoot);
  for (const e of errors) {
    issues.push({ file: e.file, issue: e.error });
  }

  if (cjsFiles.length > 20) {
    issues.push({ file: pluginsDir, issue: `Muitos plugins (${cjsFiles.length}) — considere consolidar` });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Cria o diretório de plugins com um README se não existir.
 *
 * @param {string} projectRoot
 */
function initPluginsDir(projectRoot) {
  const pluginsDir = path.join(projectRoot, '.oxe', 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }
  const readme = path.join(pluginsDir, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# .oxe/plugins/

Coloque aqui plugins OXE em formato \`.cjs\`.

## Estrutura mínima

\`\`\`js
// .oxe/plugins/meu-plugin.cjs
module.exports = {
  name: 'meu-plugin',
  version: '1.0.0',
  hooks: {
    async onAfterVerify({ projectRoot, result }) {
      // result: 'verify_complete' | 'verify_failed'
      console.log('[meu-plugin] verify:', result);
    },
  },
};
\`\`\`

## Hooks disponíveis

- onBeforeScan, onAfterScan
- onBeforeSpec, onAfterSpec
- onBeforePlan, onAfterPlan, onPlanGenerated
- onBeforeExecute, onAfterExecute
- onBeforeVerify, onAfterVerify, onVerifyComplete, onVerifyFailed
- onMilestoneNew, onMilestoneComplete
- onWorkstreamNew

Ver documentação completa: \`oxe/templates/PLUGINS.md\` (no pacote npm).
`,
      'utf8'
    );
  }
}

/**
 * Resolve sources de plugins definidas no config.json.
 * Suporta: "path:./file.cjs", "./relative.cjs" (atalho), "npm:<pkg>".
 * @param {string} projectRoot
 * @param {Array<string | { source: string, version?: string }>} pluginsSources
 * @returns {{ resolved: string[], errors: Array<{ source: string, error: string }> }}
 */
function resolvePluginSources(projectRoot, pluginsSources) {
  const resolved = [];
  const errors = [];
  if (!Array.isArray(pluginsSources)) return { resolved, errors };

  for (const entry of pluginsSources) {
    // Legado: string simples (nome de arquivo local)
    if (typeof entry === 'string') {
      const abs = path.resolve(projectRoot, '.oxe', 'plugins', entry);
      if (fs.existsSync(abs)) {
        resolved.push(abs);
      } else {
        errors.push({ source: entry, error: `arquivo não encontrado: ${abs}` });
      }
      continue;
    }
    if (!entry || typeof entry !== 'object' || !entry.source) {
      errors.push({ source: String(entry), error: 'entrada inválida — esperado { source: string }' });
      continue;
    }
    const src = String(entry.source);

    if (src.startsWith('path:') || src.startsWith('./') || src.startsWith('../')) {
      const rel = src.startsWith('path:') ? src.slice(5) : src;
      const abs = path.resolve(projectRoot, rel);
      if (!fs.existsSync(abs)) {
        errors.push({ source: src, error: `arquivo não encontrado: ${abs}` });
      } else {
        resolved.push(abs);
      }
    } else if (src.startsWith('npm:')) {
      const pkg = src.slice(4);
      const npmDir = path.join(projectRoot, '.oxe', 'plugins', '_npm', 'node_modules', pkg);
      if (!fs.existsSync(npmDir)) {
        errors.push({
          source: src,
          error: `pacote não instalado. Execute: npx oxe-cc plugins install ${src}`,
        });
      } else {
        try {
          const pkgJsonPath = path.join(npmDir, 'package.json');
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          const main = pkgJson.main || 'index.js';
          resolved.push(path.join(npmDir, main));
        } catch (e) {
          errors.push({ source: src, error: `falha ao resolver main do pacote: ${e.message}` });
        }
      }
    } else {
      errors.push({ source: src, error: 'prefixo desconhecido — use "path:" ou "npm:"' });
    }
  }
  return { resolved, errors };
}

/**
 * Instala um plugin npm em .oxe/plugins/_npm/.
 * @param {string} projectRoot
 * @param {string} pkgName
 * @param {string} [version]
 * @returns {{ ok: boolean, path: string, error: string }}
 */
function installNpmPlugin(projectRoot, pkgName, version) {
  const npmDir = path.join(projectRoot, '.oxe', 'plugins', '_npm');
  try {
    if (!fs.existsSync(npmDir)) {
      fs.mkdirSync(npmDir, { recursive: true });
    }
    const spec = version ? `${pkgName}@${version}` : pkgName;
    const { execSync } = require('child_process');
    execSync(`npm install --prefix "${npmDir}" ${spec}`, { stdio: 'pipe', timeout: 60000 });
    return { ok: true, path: path.join(npmDir, 'node_modules', pkgName), error: '' };
  } catch (e) {
    return { ok: false, path: '', error: e.message || String(e) };
  }
}

module.exports = {
  loadPlugins,
  runHook,
  validatePlugins,
  initPluginsDir,
  resolvePluginSources,
  installNpmPlugin,
};
