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

module.exports = {
  loadPlugins,
  runHook,
  validatePlugins,
  initPluginsDir,
};
