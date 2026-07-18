'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { runPluginCommand } = require('../bin/lib/oxe-plugin-cli.cjs');

function makeOutput() {
  const lines = [];
  const errors = [];
  return {
    lines,
    errors,
    log(message) { lines.push(String(message)); },
    error(message) { errors.push(String(message)); },
  };
}

describe('oxe-plugin-cli — runPluginCommand', () => {
  test('lists plugins using the requested project directory', () => {
    const output = makeOutput();
    let loadedFrom = '';
    const exitCode = runPluginCommand(['list', '--dir', '.'], {
      plugins: {
        loadPlugins(projectRoot) {
          loadedFrom = projectRoot;
          return { plugins: [{ name: 'demo', version: '1.0.0', hooks: { onAfterPlan() {} } }], errors: [] };
        },
      },
      useAnsiColors: () => false,
      ...output,
    });

    assert.strictEqual(exitCode, 0);
    assert.strictEqual(loadedFrom, path.resolve('.'));
    assert.ok(output.lines.some((line) => line.includes('demo (1.0.0)')));
  });

  test('normalizes npm: target and forwards the version to installer', () => {
    const output = makeOutput();
    let installArgs;
    const exitCode = runPluginCommand(['install', 'npm:@oxe/demo', 'next'], {
      cwd: 'C:\\project',
      plugins: {
        installNpmPlugin(...args) {
          installArgs = args;
          return { ok: true, path: 'installed', error: '' };
        },
      },
      useAnsiColors: () => false,
      ...output,
    });

    assert.strictEqual(exitCode, 0);
    assert.deepStrictEqual(installArgs, ['C:\\project', '@oxe/demo', 'next']);
    assert.ok(output.lines.some((line) => line.includes('Instalando plugin: @oxe/demo@next')));
    assert.ok(output.lines.some((line) => line.includes('"source": "npm:@oxe/demo"')));
  });

  test('returns exit code 1 when installation fails', () => {
    const output = makeOutput();
    const exitCode = runPluginCommand(['install', 'unsafe;whoami'], {
      plugins: {
        installNpmPlugin() {
          return { ok: false, path: '', error: 'Nome do pacote npm inválido' };
        },
      },
      useAnsiColors: () => false,
      ...output,
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(output.errors.some((line) => line.includes('Nome do pacote npm inválido')));
  });

  test('rejects a local path passed to install', () => {
    const output = makeOutput();
    const exitCode = runPluginCommand(['install', 'path:./local-plugin.cjs'], {
      cwd: 'C:\\project',
      useAnsiColors: () => false,
      ...output,
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(output.errors.some((line) => line.includes('Nome do pacote npm inválido')));
  });

  test('preserves usage output for an unknown subcommand', () => {
    const output = makeOutput();
    const exitCode = runPluginCommand(['wat'], {
      plugins: {},
      useAnsiColors: () => false,
      ...output,
    });

    assert.strictEqual(exitCode, 0);
    const usage = output.lines.find((line) => line.includes('Uso: oxe-cc plugins')) || '';
    assert.ok(usage.includes('install <npm-package> [version]'));
    assert.ok(!usage.includes('|path'));
  });
});
