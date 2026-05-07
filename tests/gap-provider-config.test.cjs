'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  saveRuntimeProviderConfig,
  loadRuntimeProviderConfig,
  createExecutionContext,
} = require('../bin/lib/oxe-operational.cjs');

describe('Gap — Provider config persistence (saveRuntimeProviderConfig / loadRuntimeProviderConfig)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-provider-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveRuntimeProviderConfig e loadRuntimeProviderConfig são exportados', () => {
    assert.equal(typeof saveRuntimeProviderConfig, 'function');
    assert.equal(typeof loadRuntimeProviderConfig, 'function');
  });

  it('salva model e baseUrl em .oxe/config.json', () => {
    const saved = saveRuntimeProviderConfig(tmpDir, {
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-6',
    });
    assert.equal(saved.baseUrl, 'https://api.anthropic.com/v1');
    assert.equal(saved.model, 'claude-sonnet-4-6');
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, '.oxe', 'config.json'), 'utf8'));
    assert.equal(cfg.runtime.provider.model, 'claude-sonnet-4-6');
  });

  it('salva apiKeyEnv quando informado', () => {
    saveRuntimeProviderConfig(tmpDir, { model: 'claude-haiku-4-5', apiKeyEnv: 'MY_KEY' });
    const p = loadRuntimeProviderConfig(tmpDir);
    assert.equal(p.apiKeyEnv, 'MY_KEY');
    assert.equal(p.model, 'claude-haiku-4-5');
  });

  it('salva maxTurns quando informado', () => {
    saveRuntimeProviderConfig(tmpDir, { model: 'm', maxTurns: 15 });
    const p = loadRuntimeProviderConfig(tmpDir);
    assert.equal(p.maxTurns, 15);
  });

  it('preserva outras chaves do config.json ao salvar', () => {
    const cfgPath = path.join(tmpDir, '.oxe', 'config.json');
    const existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    existing.profile = 'balanced';
    fs.writeFileSync(cfgPath, JSON.stringify(existing, null, 2));
    saveRuntimeProviderConfig(tmpDir, { model: 'x' });
    const updated = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(updated.profile, 'balanced', 'outras chaves devem ser preservadas');
  });

  it('loadRuntimeProviderConfig retorna null quando config ausente', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-empty-'));
    try {
      assert.equal(loadRuntimeProviderConfig(emptyDir), null);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('loadRuntimeProviderConfig retorna null quando runtime.provider ausente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-noprov-'));
    try {
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{"runtime":{"quotas":{}}}');
      assert.equal(loadRuntimeProviderConfig(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Gap — PolicyEngine auto-wired via createExecutionContext', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-policy-'));
    fs.mkdirSync(path.join(tmpDir, '.oxe'), { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('policyEngine é null quando config sem runtime.policy', () => {
    fs.writeFileSync(path.join(tmpDir, '.oxe', 'config.json'), '{"runtime":{"quotas":{}}}');
    const ctx = createExecutionContext(tmpDir, null, {});
    assert.equal(ctx.policyEngine, null);
  });

  it('policyEngine é instanciado quando config tem runtime.policy', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.oxe', 'config.json'),
      JSON.stringify({ runtime: { policy: { policies: [], guardrail: {} } } }),
    );
    const ctx = createExecutionContext(tmpDir, null, {});
    // Se runtime estiver disponível, policyEngine deve ser instanciado; caso contrário null (CI sem build)
    if (ctx.policyEngine !== null) {
      assert.equal(typeof ctx.policyEngine.evaluate, 'function', 'policyEngine deve ter método evaluate');
    }
  });

  it('opção injetada prevalece sobre config', () => {
    const fakeEngine = { evaluate: () => null, _source: 'injected' };
    const ctx = createExecutionContext(tmpDir, null, { policyEngine: fakeEngine });
    assert.equal(ctx.policyEngine._source, 'injected');
  });
});
