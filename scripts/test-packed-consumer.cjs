#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runPackageManagerSync } = require('../bin/lib/oxe-process.cjs');

const ROOT = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} falhou (${result.status})`,
      result.error && result.error.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function runNpm(args, options = {}) {
  const result = runPackageManagerSync('npm', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `npm ${args.join(' ')} falhou (${result.status})`,
      result.error && result.error.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function testPackedConsumer(options = {}) {
  const root = options.root || ROOT;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-packed-consumer-'));
  const packDir = path.join(temporary, 'pack');
  const consumerDir = path.join(temporary, 'consumer');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumerDir, { recursive: true });

  try {
    const packed = runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], {
      cwd: root,
    });
    const packResult = JSON.parse(packed.stdout)[0];
    if (!packResult || !packResult.filename) throw new Error('npm pack não retornou o tarball criado');
    const tarball = path.join(packDir, packResult.filename);

    fs.writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({
      name: 'oxe-packed-consumer-fixture',
      version: '1.0.0',
      private: true,
    }, null, 2) + '\n');
    runNpm([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
    ], { cwd: consumerDir });

    fs.writeFileSync(path.join(consumerDir, 'consumer.ts'), [
      "import oxe = require('oxe-cc');",
      'const version: string = oxe.version;',
      'const state = oxe.createEmptyRunState();',
      'void [version, state];',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(consumerDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'CommonJS',
        moduleResolution: 'Node',
        skipLibCheck: false,
      },
      files: ['consumer.ts'],
    }, null, 2) + '\n');
    run(process.execPath, [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project',
      path.join(consumerDir, 'tsconfig.json'),
    ], { cwd: consumerDir });

    const installed = path.join(consumerDir, 'node_modules', 'oxe-cc');
    const versionResult = run(process.execPath, [path.join(installed, 'bin', 'oxe-cc.js'), '--version'], {
      cwd: consumerDir,
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    const cliVersion = versionResult.stdout.trim();
    if (cliVersion !== pkg.version && cliVersion !== `oxe-cc v${pkg.version}`) {
      throw new Error(`CLI retornou ${cliVersion} em vez de ${pkg.version}`);
    }
    const smoke = run(process.execPath, ['-e', [
      "const oxe = require('oxe-cc');",
      "if (oxe.version !== require('oxe-cc/package.json').version) throw new Error('SDK version drift');",
      "if (typeof oxe.createEmptyRunState !== 'function') throw new Error('runtime export missing');",
      "if (!oxe.createEmptyRunState()) throw new Error('runtime invocation failed');",
    ].join('')], { cwd: consumerDir });
    void smoke;
    return { tarball, consumerDir, version: pkg.version, fileCount: packResult.files.length };
  } finally {
    if (!options.keep) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  try {
    const result = testPackedConsumer();
    console.log(`packed-consumer: OK (oxe-cc ${result.version}, ${result.fileCount} arquivos)`);
    return 0;
  } catch (error) {
    console.error(`packed-consumer: BLOCKED\n${error.stack || error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { run, runNpm, testPackedConsumer, main };
