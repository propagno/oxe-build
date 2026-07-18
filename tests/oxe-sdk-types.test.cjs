'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const sdkTypeGenerator = require('../scripts/generate-sdk-types.cjs');

const ROOT = path.resolve(__dirname, '..');
const DECLARATIONS_PATH = path.join(ROOT, 'lib', 'sdk', 'index.d.ts');
const SDK_PATH = path.join(ROOT, 'lib', 'sdk', 'index.cjs');
const RUNTIME_PATH = path.join(ROOT, 'lib', 'runtime', 'index.js');

function extractBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `bloco de tipos ausente: ${marker}`);
  const openIndex = source.indexOf('{', markerIndex + marker.length - 1);
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new Error(`bloco de tipos não terminado: ${marker}`);
}

function immediateProperties(block) {
  const properties = [];
  let depth = 0;
  let parentheses = 0;
  for (const line of block.split('\n')) {
    if (depth === 0 && parentheses === 0) {
      const match = line.match(/^\s+([A-Za-z_$][\w$]*)(?:\?)?:/);
      if (match) properties.push(match[1]);
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '(') parentheses += 1;
      else if (char === ')') parentheses -= 1;
    }
  }
  return new Set(properties);
}

function assertSameKeys(label, actualObject, declaredKeys) {
  const actual = Object.keys(actualObject).sort();
  const declared = [...declaredKeys].sort();
  assert.deepEqual(declared, actual, `${label}: exports e index.d.ts divergiram`);
}

test('index.d.ts acompanha a ABI JavaScript pública do SDK', () => {
  const declarations = fs.readFileSync(DECLARATIONS_PATH, 'utf8');
  const sdk = require(SDK_PATH);
  const runtime = fs.existsSync(RUNTIME_PATH) ? require(RUNTIME_PATH) : {};
  const runtimeKeys = new Set(Object.keys(runtime));

  assert.match(declarations, /OxeSdk\s*&\s*typeof import\(['"]\.\.\/runtime\/index['"]\)/);

  const sdkDeclarationKeys = immediateProperties(extractBlock(declarations, 'interface OxeSdk {'));
  const baseRuntime = Object.fromEntries(
    Object.entries(sdk).filter(([key]) => !runtimeKeys.has(key))
  );
  const baseDeclarations = new Set([...sdkDeclarationKeys].filter((key) => !runtimeKeys.has(key)));
  assertSameKeys('OxeSdk', baseRuntime, baseDeclarations);

  const namedInterfaces = {
    manifest: 'interface ManifestAPI {',
    agents: 'interface AgentsAPI {',
    context: 'interface ContextAPI {',
    runtimeSemantics: 'interface RuntimeSemanticsAPI {',
  };
  const namespaces = [
    'health',
    'workflows',
    'install',
    'security',
    'plugins',
    'dashboard',
    'release',
    'operational',
    'azure',
    'artifacts',
  ];

  for (const [name, marker] of Object.entries(namedInterfaces)) {
    assertSameKeys(`OxeSdk.${name}`, sdk[name], immediateProperties(extractBlock(declarations, marker)));
  }
  for (const name of namespaces) {
    const block = extractBlock(extractBlock(declarations, 'interface OxeSdk {'), `  ${name}: {`);
    assertSameKeys(`OxeSdk.${name}`, sdk[name], immediateProperties(block));
  }
});

test('entrypoint de tipos declarado pelo pacote existe e aponta para o SDK', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.types, 'lib/sdk/index.d.ts');
  assert.ok(fs.existsSync(path.join(ROOT, pkg.types)));
  assert.equal(pkg.main, 'lib/sdk/index.cjs');
});

test('TypeScript compila um consumidor CommonJS do SDK e do runtime', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-types-'));
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const fixtureModules = path.join(fixture, 'node_modules');
  fs.mkdirSync(fixtureModules, { recursive: true });
  fs.symlinkSync(ROOT, path.join(fixtureModules, 'oxe-cc'), 'junction');
  fs.symlinkSync(path.join(ROOT, 'node_modules', '@types'), path.join(fixtureModules, '@types'), 'junction');
  fs.writeFileSync(
    path.join(fixture, 'consumer.ts'),
    [
      "import oxe = require('oxe-cc');",
      'const version: string = oxe.version;',
      "const parsed = oxe.parsePlan('# PLAN\\n');",
      'const runtimeState = oxe.createEmptyRunState();',
      'const runtimeFactory: typeof oxe.createEmptyRunState = oxe.createEmptyRunState;',
      'void [version, parsed, runtimeState, runtimeFactory];',
      '',
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'CommonJS',
        moduleResolution: 'Node',
        skipLibCheck: false,
      },
      files: ['consumer.ts'],
    }, null, 2),
    'utf8'
  );

  const result = spawnSync(process.execPath, [tsc, '--project', path.join(fixture, 'tsconfig.json')], {
    cwd: fixture,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('tipos Node exigidos pela ABI runtime são dependência de produção', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies['@types/node'], /^\^?18\./);
  assert.equal(pkg.devDependencies['@types/node'], undefined);
});

test('workspace único instala runtime e extensão a partir do lock raiz', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepEqual(pkg.workspaces, ['packages/runtime', 'vscode-extension']);
  assert.ok(lock.packages['packages/runtime']);
  assert.ok(lock.packages['vscode-extension']);
  assert.match(pkg.scripts['build:runtime'], /--workspace @oxe\/runtime/);
  assert.match(pkg.scripts['test:runtime'], /--workspace @oxe\/runtime/);
  assert.equal(fs.existsSync(path.join(ROOT, 'packages', 'runtime', 'package-lock.json')), false);
});

test('declarações SDK são emissão determinística do compilador TypeScript e detectam drift', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sdk-generator-'));
  const sourcePath = path.join(fixture, 'source.ts');
  const outputPath = path.join(fixture, 'output.d.ts');
  try {
    fs.writeFileSync(sourcePath, [
      'interface PublicApi { version: string; }',
      'declare const api: PublicApi;',
      'export = api;',
      '',
    ].join('\n'));
    assert.equal(sdkTypeGenerator.generate({ sourcePath, outputPath }), true);
    const first = fs.readFileSync(outputPath, 'utf8');
    assert.match(first, /interface PublicApi/);
    assert.equal(sdkTypeGenerator.generate({ sourcePath, outputPath, check: true }), false);

    fs.writeFileSync(sourcePath, [
      'interface PublicApi { version: string; status: boolean; }',
      'declare const api: PublicApi;',
      'export = api;',
      '',
    ].join('\n'));
    assert.throws(
      () => sdkTypeGenerator.generate({ sourcePath, outputPath, check: true }),
      /divergiu/
    );
    assert.equal(sdkTypeGenerator.generate({ sourcePath, outputPath }), true);
    const second = fs.readFileSync(outputPath, 'utf8');
    assert.notEqual(second, first);
    assert.match(second, /status: boolean/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
