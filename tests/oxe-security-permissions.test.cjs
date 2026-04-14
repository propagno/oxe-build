'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../lib/sdk/index.cjs');

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
