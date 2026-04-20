'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sdk = require('../lib/sdk/index.cjs');
const security = require('../bin/lib/oxe-security.cjs');

describe('globToRegex', () => {
  test('*.env matches .env and prefixed variants', () => {
    const re = sdk.security.globToRegex('*.env');
    assert.ok(re.test('.env'));
    assert.ok(re.test('production.env'));
  });

  test('*.env does not match .env.local', () => {
    const re = sdk.security.globToRegex('*.env');
    assert.ok(!re.test('.env.local'));
  });

  test('**/.env* matches nested .env files', () => {
    const re = sdk.security.globToRegex('**/.env*');
    assert.ok(re.test('.env'));
    assert.ok(re.test('.env.local'));
    assert.ok(re.test('config/.env.prod'));
  });

  test('scripts/deploy.sh matches exact path', () => {
    const re = sdk.security.globToRegex('scripts/deploy.sh');
    assert.ok(re.test('scripts/deploy.sh'));
    assert.ok(!re.test('other/deploy.sh'));
  });

  test('? matches single non-separator char', () => {
    const re = sdk.security.globToRegex('src/?.ts');
    assert.ok(re.test('src/a.ts'));
    assert.ok(!re.test('src/ab.ts'));
  });

  test('** matches deep nesting', () => {
    const re = sdk.security.globToRegex('src/**/*.ts');
    assert.ok(re.test('src/a/b/c/file.ts'));
    assert.ok(!re.test('lib/a/b/file.ts'));
  });
});

describe('checkFilePermission', () => {
  const rules = [
    { pattern: '*.env', action: 'deny', scope: 'all' },
    { pattern: 'scripts/**', action: 'ask', scope: 'execute' },
    { pattern: 'src/**', action: 'allow' },
  ];

  test('first-match wins — .env denied', () => {
    const r = sdk.security.checkFilePermission('.env', rules, 'execute');
    assert.strictEqual(r.action, 'deny');
    assert.ok(r.rule !== null);
  });

  test('production.env denied', () => {
    const r = sdk.security.checkFilePermission('production.env', rules, 'execute');
    assert.strictEqual(r.action, 'deny');
  });

  test('scripts/deploy.sh needs approval in execute scope', () => {
    const r = sdk.security.checkFilePermission('scripts/deploy.sh', rules, 'execute');
    assert.strictEqual(r.action, 'ask');
  });

  test('scripts/deploy.sh allowed in apply scope (scope mismatch)', () => {
    const r = sdk.security.checkFilePermission('scripts/deploy.sh', rules, 'apply');
    assert.strictEqual(r.action, 'allow');
  });

  test('src/app.ts allowed', () => {
    const r = sdk.security.checkFilePermission('src/app.ts', rules);
    assert.strictEqual(r.action, 'allow');
  });

  test('sem regras → allow', () => {
    const r = sdk.security.checkFilePermission('anything.js', []);
    assert.strictEqual(r.action, 'allow');
    assert.strictEqual(r.rule, null);
  });

  test('sem match → allow por default', () => {
    const r = sdk.security.checkFilePermission('unmatched/file.js', rules);
    assert.strictEqual(r.action, 'allow');
    assert.strictEqual(r.rule, null);
  });

  test('backslash Windows normalizado', () => {
    const r = sdk.security.checkFilePermission('scripts\\deploy.sh', rules, 'execute');
    assert.strictEqual(r.action, 'ask');
  });
});

describe('checkPermissions', () => {
  test('classifica denied, needsApproval e allowed', () => {
    const rules = [
      { pattern: '*.env', action: 'deny' },
      { pattern: 'scripts/**', action: 'ask' },
    ];
    const result = sdk.security.checkPermissions(
      ['.env', 'scripts/run.sh', 'src/index.ts'],
      rules,
      'execute'
    );
    assert.deepStrictEqual(result.denied, ['.env']);
    assert.deepStrictEqual(result.needsApproval, ['scripts/run.sh']);
    assert.deepStrictEqual(result.allowed, ['src/index.ts']);
  });

  test('lista vazia retorna tudo vazio', () => {
    const result = sdk.security.checkPermissions([], [{ pattern: '*.env', action: 'deny' }], 'execute');
    assert.deepStrictEqual(result.denied, []);
    assert.deepStrictEqual(result.needsApproval, []);
    assert.deepStrictEqual(result.allowed, []);
  });

  test('sem regras → tudo allowed', () => {
    const result = sdk.security.checkPermissions(['.env', 'secrets.json'], [], 'execute');
    assert.deepStrictEqual(result.denied, []);
    assert.deepStrictEqual(result.allowed, ['.env', 'secrets.json']);
  });
});

describe('checkPathSafety', () => {
  test('path dentro do projeto é seguro', () => {
    const root = os.tmpdir();
    const result = security.checkPathSafety(path.join(root, 'src', 'app.ts'), root);
    assert.strictEqual(result.safe, true);
    assert.strictEqual(result.reason, null);
  });

  test('path traversal é bloqueado', () => {
    const root = path.join(os.tmpdir(), 'project');
    const result = security.checkPathSafety(path.join(root, '..', '..', 'etc', 'passwd'), root);
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason && result.reason.includes('traversal'));
  });

  test('caminho em node_modules é negado', () => {
    const root = os.tmpdir();
    const result = security.checkPathSafety(path.join(root, 'node_modules', 'pkg'), root);
    assert.strictEqual(result.safe, false);
  });

  test('arquivo .env é negado por padrão de segredo', () => {
    const root = os.tmpdir();
    const result = security.checkPathSafety(path.join(root, '.env'), root);
    assert.strictEqual(result.safe, false);
    assert.ok(result.reason && result.reason.includes('segredo'));
  });

  test('arquivo relativo dentro do projeto é seguro', () => {
    const root = os.tmpdir();
    const result = security.checkPathSafety('src/index.ts', root);
    assert.strictEqual(result.safe, true);
  });
});

describe('scanFileForSecrets', () => {
  test('retorna vazio para arquivo inexistente', () => {
    const result = security.scanFileForSecrets('/nonexistent-file-xyz.txt');
    assert.deepStrictEqual(result, { hasSecrets: false, matches: [] });
  });

  test('detecta JWT em arquivo', () => {
    const file = path.join(os.tmpdir(), `oxe-jwt-${Date.now()}.txt`);
    fs.writeFileSync(file, 'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'utf8');
    try {
      const result = security.scanFileForSecrets(file);
      assert.strictEqual(result.hasSecrets, true);
      assert.ok(result.matches.length > 0);
    } finally {
      fs.unlinkSync(file);
    }
  });

  test('retorna vazio para arquivo limpo', () => {
    const file = path.join(os.tmpdir(), `oxe-clean-${Date.now()}.txt`);
    fs.writeFileSync(file, 'just some normal text without any secrets', 'utf8');
    try {
      const result = security.scanFileForSecrets(file);
      assert.strictEqual(result.hasSecrets, false);
    } finally {
      fs.unlinkSync(file);
    }
  });
});

describe('scanDirForSecretFiles', () => {
  test('encontra arquivos com nomes sensíveis', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sec-'));
    fs.writeFileSync(path.join(dir, '.env'), 'KEY=secret', 'utf8');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'normal', 'utf8');
    const found = security.scanDirForSecretFiles(dir);
    assert.ok(found.some((f) => f.includes('.env')));
    assert.ok(!found.some((f) => f.includes('app.ts')));
  });

  test('varre recursivamente e encontra segredos aninhados', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sec-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'secrets.json'), '{}', 'utf8');
    const found = security.scanDirForSecretFiles(dir);
    assert.ok(found.some((f) => f.includes('secrets.json')));
  });

  test('retorna vazio para diretório sem arquivos sensíveis', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sec-'));
    fs.writeFileSync(path.join(dir, 'readme.md'), 'hello', 'utf8');
    const found = security.scanDirForSecretFiles(dir);
    assert.deepStrictEqual(found, []);
  });

  test('trata graciosamente diretório inacessível', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sec-'));
    const found = security.scanDirForSecretFiles(path.join(dir, 'nonexistent-subdir'));
    assert.deepStrictEqual(found, []);
  });
});

describe('validatePlanPaths', () => {
  test('retorna ok:true para caminhos seguros', () => {
    const root = os.tmpdir();
    const result = security.validatePlanPaths(
      [path.join(root, 'src', 'index.ts'), path.join(root, 'lib', 'util.ts')],
      root
    );
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.issues, []);
  });

  test('retorna ok:false para caminhos inseguros', () => {
    const root = path.join(os.tmpdir(), 'project');
    const result = security.validatePlanPaths(
      [path.join(root, '..', '..', 'etc', 'passwd')],
      root
    );
    assert.strictEqual(result.ok, false);
    assert.ok(result.issues.length > 0);
  });

  test('lista vazia retorna ok:true', () => {
    const result = security.validatePlanPaths([], os.tmpdir());
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.issues, []);
  });
});
