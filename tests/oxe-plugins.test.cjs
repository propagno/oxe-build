'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const plugins = require('../bin/lib/oxe-plugins.cjs');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-plg-'));
}

function writePlugin(dir, filename, content) {
  const pluginsDir = path.join(dir, '.oxe', 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, filename), content, 'utf8');
  return pluginsDir;
}

describe('oxe-plugins — loadPlugins', () => {
  test('returns empty arrays when plugins dir does not exist', () => {
    const dir = makeTmp();
    const result = plugins.loadPlugins(dir);
    assert.deepStrictEqual(result.plugins, []);
    assert.deepStrictEqual(result.errors, []);
  });

  test('loads a valid plugin', () => {
    const dir = makeTmp();
    writePlugin(dir, 'my-plugin.cjs', `'use strict';
module.exports = { name: 'my-plugin', version: '1.0.0', hooks: { async onAfterVerify() {} } };`);
    const result = plugins.loadPlugins(dir);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.plugins.length, 1);
    assert.strictEqual(result.plugins[0].name, 'my-plugin');
  });

  test('reports error for plugin without name', () => {
    const dir = makeTmp();
    writePlugin(dir, 'no-name.cjs', `'use strict'; module.exports = { hooks: {} };`);
    const result = plugins.loadPlugins(dir);
    assert.strictEqual(result.plugins.length, 0);
    assert.ok(result.errors.some((e) => /name/.test(e.error)));
  });

  test('reports error for plugin without hooks', () => {
    const dir = makeTmp();
    writePlugin(dir, 'no-hooks.cjs', `'use strict'; module.exports = { name: 'nohooks' };`);
    const result = plugins.loadPlugins(dir);
    assert.ok(result.errors.some((e) => /hooks/.test(e.error)));
  });

  test('reports error for plugin exporting non-object', () => {
    const dir = makeTmp();
    writePlugin(dir, 'invalid.cjs', `'use strict'; module.exports = 42;`);
    const result = plugins.loadPlugins(dir);
    assert.ok(result.errors.some((e) => /objeto/.test(e.error)));
  });

  test('reports error for plugin that throws on require', () => {
    const dir = makeTmp();
    writePlugin(dir, 'throws.cjs', `throw new Error('boom');`);
    const result = plugins.loadPlugins(dir);
    assert.ok(result.errors.some((e) => /boom/.test(e.error)));
  });

  test('loads plugins from config.json external sources', () => {
    const dir = makeTmp();
    const pluginFile = path.join(dir, 'external-plugin.cjs');
    fs.writeFileSync(pluginFile, `'use strict'; module.exports = { name: 'ext', hooks: { async onAfterScan() {} } };`, 'utf8');
    // .oxe/plugins deve existir para loadPlugins não retornar cedo
    fs.mkdirSync(path.join(dir, '.oxe', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      plugins: [{ source: `path:${pluginFile}` }],
    }), 'utf8');
    const result = plugins.loadPlugins(dir);
    assert.ok(result.plugins.some((p) => p.name === 'ext'));
  });

  test('deduplicates plugins by name from external sources', () => {
    const dir = makeTmp();
    const pluginFile = path.join(dir, 'dup-external.cjs');
    fs.writeFileSync(pluginFile, `'use strict'; module.exports = { name: 'dup', hooks: {} };`, 'utf8');
    // Cria o mesmo plugin em .oxe/plugins/ e também via config.json para testar deduplicação
    writePlugin(dir, 'dup.cjs', `'use strict'; module.exports = { name: 'dup', hooks: {} };`);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      plugins: [{ source: `path:${pluginFile}` }],
    }), 'utf8');
    const result = plugins.loadPlugins(dir);
    const dupPlugins = result.plugins.filter((p) => p.name === 'dup');
    assert.strictEqual(dupPlugins.length, 1, 'deve deduplicar pelo nome');
  });
});

describe('oxe-plugins — runHook', () => {
  test('calls matching hook on all plugins', async () => {
    const called = [];
    const pluginList = [
      { name: 'a', hooks: { async onAfterScan(ctx) { called.push(`a:${ctx.x}`); } } },
      { name: 'b', hooks: { async onAfterScan(ctx) { called.push(`b:${ctx.x}`); } } },
    ];
    await plugins.runHook(pluginList, 'onAfterScan', { x: 'ok' });
    assert.deepStrictEqual(called, ['a:ok', 'b:ok']);
  });

  test('skips plugins without the requested hook', async () => {
    const pluginList = [
      { name: 'a', hooks: {} },
    ];
    const errors = await plugins.runHook(pluginList, 'onAfterScan', {});
    assert.deepStrictEqual(errors, []);
  });

  test('captures hook errors without propagating', async () => {
    const pluginList = [
      { name: 'bad', hooks: { async onAfterScan() { throw new Error('hook failure'); } } },
    ];
    const errors = await plugins.runHook(pluginList, 'onAfterScan', {});
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].plugin, 'bad');
    assert.ok(errors[0].error.includes('hook failure'));
  });
});

describe('oxe-plugins — validatePlugins', () => {
  test('returns valid:true when no plugins dir exists', () => {
    const dir = makeTmp();
    const result = plugins.validatePlugins(dir);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.issues, []);
  });

  test('warns about non-cjs files', () => {
    const dir = makeTmp();
    const pluginsDir = path.join(dir, '.oxe', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, 'plugin.js'), '', 'utf8');
    const result = plugins.validatePlugins(dir);
    assert.ok(result.issues.some((i) => /\.cjs/.test(i.issue)));
  });

  test('aggregates load errors as issues', () => {
    const dir = makeTmp();
    writePlugin(dir, 'broken.cjs', `throw new Error('load error');`);
    const result = plugins.validatePlugins(dir);
    assert.ok(!result.valid);
    assert.ok(result.issues.length > 0);
  });
});

describe('oxe-plugins — initPluginsDir', () => {
  test('creates plugins dir and README when not present', () => {
    const dir = makeTmp();
    plugins.initPluginsDir(dir);
    const pluginsDir = path.join(dir, '.oxe', 'plugins');
    assert.ok(fs.existsSync(pluginsDir), 'deve criar o diretório de plugins');
    const readme = path.join(pluginsDir, 'README.md');
    assert.ok(fs.existsSync(readme), 'deve criar o README.md');
    const content = fs.readFileSync(readme, 'utf8');
    assert.ok(content.includes('.oxe/plugins/'), 'README deve ter documentação');
  });

  test('is idempotent — does not overwrite existing README', () => {
    const dir = makeTmp();
    plugins.initPluginsDir(dir);
    const readme = path.join(dir, '.oxe', 'plugins', 'README.md');
    fs.writeFileSync(readme, 'custom content', 'utf8');
    plugins.initPluginsDir(dir);
    assert.strictEqual(fs.readFileSync(readme, 'utf8'), 'custom content', 'não deve sobrescrever');
  });
});

describe('oxe-plugins — resolvePluginSources', () => {
  test('resolves string entry (legacy format) when file exists', () => {
    const dir = makeTmp();
    const pluginsDir = path.join(dir, '.oxe', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, 'my.cjs'), '', 'utf8');
    const result = plugins.resolvePluginSources(dir, ['my.cjs']);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.resolved.length, 1);
  });

  test('reports error for string entry when file not found', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, ['missing.cjs']);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].error.includes('não encontrado'));
  });

  test('resolves path: prefix when file exists', () => {
    const dir = makeTmp();
    const file = path.join(dir, 'plugin.cjs');
    fs.writeFileSync(file, '', 'utf8');
    const result = plugins.resolvePluginSources(dir, [{ source: `path:${file}` }]);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.resolved.length, 1);
  });

  test('reports error for path: when file not found', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, [{ source: 'path:/nonexistent/file.cjs' }]);
    assert.ok(result.errors.length > 0);
  });

  test('resolves ./ relative path when file exists', () => {
    const dir = makeTmp();
    const file = path.join(dir, 'rel.cjs');
    fs.writeFileSync(file, '', 'utf8');
    const result = plugins.resolvePluginSources(dir, [{ source: './rel.cjs' }]);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.resolved.length, 1);
  });

  test('reports error for npm: source not installed', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, [{ source: 'npm:some-uninstalled-pkg' }]);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].error.includes('não instalado'));
  });

  test('reports error for unknown prefix', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, [{ source: 'ftp://something' }]);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].error.includes('prefixo desconhecido'));
  });

  test('reports error for invalid entry (missing source)', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, [{ notASource: true }]);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].error.includes('inválida'));
  });

  test('returns empty resolved for empty array', () => {
    const dir = makeTmp();
    const result = plugins.resolvePluginSources(dir, []);
    assert.deepStrictEqual(result.resolved, []);
    assert.deepStrictEqual(result.errors, []);
  });
});
