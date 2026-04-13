'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const azure = require('../bin/lib/oxe-azure.cjs');
const dashboard = require('../bin/lib/oxe-dashboard.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');
const sdk = require('../lib/sdk/index.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createFakeAzureCli(stateOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-cli-'));
  const statePath = path.join(dir, 'state.json');
  const recordFile = path.join(dir, 'record.log');
  const defaultState = {
    version: '2.61.0',
    loggedIn: true,
    cloud: 'AzureCloud',
    tenantId: 'tenant-bradesco-001',
    userName: 'dev@corp.com',
    userType: 'user',
    subscriptions: [{ id: 'sub-001', name: 'Bradesco DEV' }],
    selectedSubscription: 'sub-001',
    resourceGraphInstalled: true,
    resources: [
      {
        id: '/subscriptions/sub-001/resourceGroups/rg-app/providers/Microsoft.ServiceBus/namespaces/sb-core',
        name: 'sb-core',
        type: 'Microsoft.ServiceBus/namespaces',
        resourceGroup: 'rg-app',
        location: 'brazilsouth',
        subscriptionId: 'sub-001',
        tags: { env: 'dev' },
        sku: 'Standard',
      },
      {
        id: '/subscriptions/sub-001/resourceGroups/rg-app/providers/Microsoft.EventGrid/topics/eg-core',
        name: 'eg-core',
        type: 'Microsoft.EventGrid/topics',
        resourceGroup: 'rg-app',
        location: 'brazilsouth',
        subscriptionId: 'sub-001',
        tags: { env: 'dev' },
        sku: 'Basic',
      },
      {
        id: '/subscriptions/sub-001/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-core',
        name: 'sql-core',
        type: 'Microsoft.Sql/servers',
        resourceGroup: 'rg-data',
        location: 'brazilsouth',
        subscriptionId: 'sub-001',
        tags: { env: 'dev' },
        sku: 'GP_Gen5',
      },
    ],
    applied: [],
  };
  writeJson(statePath, { ...defaultState, ...stateOverrides });
  fs.writeFileSync(
    path.join(dir, 'fake-az.js'),
    `
const fs = require('fs');
const statePath = process.env.FAKE_AZURE_STATE;
const args = process.argv.slice(2);
if (process.env.FAKE_AZ_RECORD) { try { fs.appendFileSync(process.env.FAKE_AZ_RECORD, args.join(' ') + '\\n', 'utf8'); } catch (_) {} }
const raw = fs.readFileSync(statePath, 'utf8');
const state = JSON.parse(raw);
function save() { fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8'); }
function cleanArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--output') { i += 1; continue; }
    if (item === '--only-show-errors') continue;
    out.push(item);
  }
  return out;
}
function flag(argv, name) {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : '';
}
function currentSubscription() {
  return (state.subscriptions || []).find((item) => item.id === state.selectedSubscription || item.name === state.selectedSubscription) || (state.subscriptions || [])[0] || { id: '', name: '' };
}
function out(value) { process.stdout.write(JSON.stringify(value)); process.exit(0); }
function fail(message, code = 1) { process.stderr.write(String(message || 'error')); process.exit(code); }
function buildResource(type, name, resourceGroup, location, extra = {}) {
  const sub = currentSubscription();
  return {
    id: '/subscriptions/' + sub.id + '/resourceGroups/' + resourceGroup + '/providers/' + type + '/' + name,
    name,
    type,
    resourceGroup,
    location: location || 'brazilsouth',
    subscriptionId: sub.id,
    tags: extra.tags || {},
    sku: extra.sku || '',
    ...extra,
  };
}
function findResource(typePrefix, name) {
  return (state.resources || []).find((resource) => String(resource.type || '').toLowerCase().startsWith(String(typePrefix || '').toLowerCase()) && (!name || resource.name === name));
}
const a = cleanArgs(args);
if (a[0] === 'version') out({ 'azure-cli': state.version || '2.61.0' });
if (a[0] === 'login') {
  state.loggedIn = true;
  save();
  out([{ user: { name: state.userName, type: state.userType } }]);
}
if (a[0] === 'cloud' && a[1] === 'show') out({ name: state.cloud || 'AzureCloud' });
if (a[0] === 'account' && a[1] === 'show') {
  if (!state.loggedIn) fail('Please run az login.');
  const sub = currentSubscription();
  out({
    id: sub.id,
    name: sub.name,
    tenantId: state.tenantId,
    user: { name: state.userName, type: state.userType },
  });
}
if (a[0] === 'account' && a[1] === 'set') {
  const wanted = flag(a, '--subscription');
  const found = (state.subscriptions || []).find((item) => item.id === wanted || item.name === wanted);
  if (!found) fail('Subscription not found.');
  state.selectedSubscription = found.id;
  save();
  out({});
}
if (a[0] === 'extension' && a[1] === 'show') {
  if (!state.resourceGraphInstalled) fail('Extension not installed.');
  out({ name: 'resource-graph' });
}
if (a[0] === 'extension' && a[1] === 'add') {
  state.resourceGraphInstalled = true;
  save();
  out({ name: 'resource-graph' });
}
if (a[0] === 'graph' && a[1] === 'query') {
  out({ data: state.resources || [] });
}
if (a[0] === 'servicebus') {
  if (a[1] === 'namespace' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.ServiceBus/namespaces'));
  if (a[1] === 'namespace' && a[2] === 'show') out(findResource('Microsoft.ServiceBus/namespaces', flag(a, '--name')) || {});
  if (a[1] === 'namespace' && a[2] === 'create') {
    const resource = buildResource('Microsoft.ServiceBus/namespaces', flag(a, '--name'), flag(a, '--resource-group'), flag(a, '--location'), { sku: 'Standard' });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'queue' && a[2] === 'create') {
    const resource = buildResource('Microsoft.ServiceBus/namespaces/queues', flag(a, '--name'), flag(a, '--resource-group'), 'brazilsouth', { namespace: flag(a, '--namespace-name') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'topic' && a[2] === 'create') {
    const resource = buildResource('Microsoft.ServiceBus/namespaces/topics', flag(a, '--name'), flag(a, '--resource-group'), 'brazilsouth', { namespace: flag(a, '--namespace-name') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'topic' && a[2] === 'subscription' && a[3] === 'create') {
    const resource = buildResource('Microsoft.ServiceBus/namespaces/topics/subscriptions', flag(a, '--name'), flag(a, '--resource-group'), 'brazilsouth', { namespace: flag(a, '--namespace-name'), topicName: flag(a, '--topic-name') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
}
if (a[0] === 'eventgrid') {
  if (a[1] === 'topic' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.EventGrid/topics'));
  if (a[1] === 'topic' && a[2] === 'show') out(findResource('Microsoft.EventGrid/topics', flag(a, '--name')) || {});
  if (a[1] === 'system-topic' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.EventGrid/systemTopics'));
  if (a[1] === 'event-subscription' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.EventGrid/eventSubscriptions'));
  if (a[1] === 'topic' && a[2] === 'create') {
    const resource = buildResource('Microsoft.EventGrid/topics', flag(a, '--name'), flag(a, '--resource-group'), flag(a, '--location'), { sku: 'Basic' });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'event-subscription' && a[2] === 'create') {
    const resource = buildResource('Microsoft.EventGrid/eventSubscriptions', flag(a, '--name'), 'eventgrid-derived', 'brazilsouth', { sourceResourceId: flag(a, '--source-resource-id'), endpoint: flag(a, '--endpoint') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
}
if (a[0] === 'sql') {
  if (a[1] === 'server' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.Sql/servers'));
  if (a[1] === 'server' && a[2] === 'show') out(findResource('Microsoft.Sql/servers', flag(a, '--name')) || {});
  if (a[1] === 'db' && a[2] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.Sql/servers/databases'));
  if (a[1] === 'db' && a[2] === 'show') out(findResource('Microsoft.Sql/servers/databases', flag(a, '--name')) || {});
  if (a[1] === 'server' && a[2] === 'firewall-rule' && a[3] === 'list') out((state.resources || []).filter((item) => item.type === 'Microsoft.Sql/servers/firewallRules'));
  if (a[1] === 'server' && a[2] === 'firewall-rule' && a[3] === 'show') out(findResource('Microsoft.Sql/servers/firewallRules', flag(a, '--name')) || {});
  if (a[1] === 'server' && a[2] === 'create') {
    const resource = buildResource('Microsoft.Sql/servers', flag(a, '--name'), flag(a, '--resource-group'), flag(a, '--location'), { adminUser: flag(a, '--admin-user') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'db' && a[2] === 'create') {
    const resource = buildResource('Microsoft.Sql/servers/databases', flag(a, '--name'), flag(a, '--resource-group'), 'brazilsouth', { server: flag(a, '--server') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
  if (a[1] === 'server' && a[2] === 'firewall-rule' && a[3] === 'create') {
    const resource = buildResource('Microsoft.Sql/servers/firewallRules', flag(a, '--name'), flag(a, '--resource-group'), 'brazilsouth', { server: flag(a, '--server'), startIpAddress: flag(a, '--start-ip-address'), endIpAddress: flag(a, '--end-ip-address') });
    state.resources.push(resource);
    state.applied.push({ command: a.join(' '), resource });
    save();
    out(resource);
  }
}
fail('Command not implemented: ' + a.join(' '));
`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'az.cmd'), '@echo off\r\nnode "%~dp0fake-az.js" %*\r\n', 'utf8');
  return {
    dir,
    statePath,
    recordFile,
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`,
      FAKE_AZURE_STATE: statePath,
      FAKE_AZ_RECORD: recordFile,
      OXE_NO_BANNER: '1',
    },
  };
}

function extractJsonFromCli(stdout) {
  // ANSI escape sequences contain '[' — find the first line that starts with '[' or '{'
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => /^\s*[\[{]/.test(l));
  if (start !== -1) return JSON.parse(lines.slice(start).join('\n'));
  return JSON.parse(stdout);
}

function withFakeAzureCli(fake, fn) {
  const prevPath = process.env.PATH;
  const prevState = process.env.FAKE_AZURE_STATE;
  process.env.PATH = fake.env.PATH;
  process.env.FAKE_AZURE_STATE = fake.statePath;
  try {
    return fn();
  } finally {
    process.env.PATH = prevPath;
    if (prevState == null) delete process.env.FAKE_AZURE_STATE;
    else process.env.FAKE_AZURE_STATE = prevState;
  }
}

describe('oxe-azure', () => {
  test('azure doctor fails deterministically when az is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-doctor-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ azure: { enabled: true } }), 'utf8');
    const barePath = path.dirname(process.execPath);
    const result = spawnSync(process.execPath, [CLI, 'azure', 'doctor', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: barePath, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stdout + result.stderr, /Azure CLI não instalada/i);
  });

  test('azure auth whoami via CLI writes profile and auth-status artifacts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-auth-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'auth', 'whoami', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const profile = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'cloud', 'azure', 'profile.json'), 'utf8'));
    const auth = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'cloud', 'azure', 'auth-status.json'), 'utf8'));
    assert.strictEqual(profile.subscription_id, 'sub-001');
    assert.strictEqual(auth.login_active, true);
    assert.match(result.stdout, /Bradesco DEV/);
  });

  test('azure sync materializes inventory and derived markdowns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sync-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'sync', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const inventory = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json'), 'utf8'));
    assert.strictEqual(inventory.summary.servicebus, 1);
    assert.strictEqual(inventory.summary.eventgrid, 1);
    assert.strictEqual(inventory.summary.sql, 1);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'cloud', 'azure', 'INVENTORY.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'cloud', 'azure', 'SERVICEBUS.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'cloud', 'azure', 'EVENTGRID.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'cloud', 'azure', 'SQL.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'capabilities', 'azure-auth', 'CAPABILITY.md')));
  });

  test('apply without approve opens checkpoint and apply with approve emits trace and provider context', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-apply-'));
    const fake = createFakeAzureCli();
    withFakeAzureCli(fake, () => {
      const pending = azure.applyAzureOperation(
        dir,
        null,
        'servicebus',
        { kind: 'namespace', name: 'sb-new', resourceGroup: 'rg-app', location: 'brazilsouth' },
        { approve: false }
      );
      assert.strictEqual(pending.approved, false);
      assert.strictEqual(pending.operation.phase, 'waiting_approval');
      const checkpointsPath = path.join(dir, '.oxe', 'CHECKPOINTS.md');
      assert.ok(fs.existsSync(checkpointsPath));
      const checkpointsText = fs.readFileSync(checkpointsPath, 'utf8');
      assert.match(checkpointsText, /pending_approval/i);

      const applied = azure.applyAzureOperation(
        dir,
        null,
        'servicebus',
        { kind: 'namespace', name: 'sb-new', resourceGroup: 'rg-app', location: 'brazilsouth' },
        { approve: true }
      );
      assert.strictEqual(applied.approved, true);
      const runState = sdk.operational.readRunState(dir, null);
      assert.ok(runState.provider_context.azure);
      assert.strictEqual(runState.provider_context.azure.last_operation.phase, 'applied');
      const events = sdk.operational.readEvents(dir, null);
      assert.ok(events.some((event) => event.type === 'azure_operation_applied'));
      const opFiles = fs.readdirSync(path.join(dir, '.oxe', 'cloud', 'azure', 'operations')).filter((name) => name.endsWith('.json'));
      assert.ok(opFiles.length >= 2);
    });
  });

  test('health report and dashboard expose azure summary when context is enabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-health-'));
    const oxe = path.join(dir, '.oxe');
    fs.mkdirSync(path.join(oxe, 'codebase'), { recursive: true });
    for (const file of health.EXPECTED_CODEBASE_MAPS) {
      fs.writeFileSync(path.join(oxe, 'codebase', file), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`plan_ready`\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'SPEC.md'), '# Spec\n\n## Objetivo\n\nAzure\n\n## Critérios de aceite\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | usar azure | sync |\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'PLAN.md'), '## Autoavaliação do Plano\n- **Melhor plano atual:** sim\n- **Confiança:** 80%\n- **Base da confiança:**\n  - Completude dos requisitos: 20/25\n  - Dependências conhecidas: 12/15\n  - Risco técnico: 12/20\n  - Impacto no código existente: 10/15\n  - Clareza da validação / testes: 10/15\n  - Lacunas externas / decisões pendentes: 8/10\n- **Principais incertezas:** nenhuma\n- **Alternativas descartadas:** nenhuma\n- **Condição para replanejar:** falha em A1\n\n### T1 — Azure\n- **Onda:** 1\n- **Aceite vinculado:** A1\n', 'utf8');
    fs.writeFileSync(path.join(oxe, 'config.json'), JSON.stringify({ azure: { enabled: true, inventory_max_age_hours: 24 } }), 'utf8');

    const fake = createFakeAzureCli();
    withFakeAzureCli(fake, () => {
      azure.syncAzureInventory(dir);
      const report = health.buildHealthReport(dir);
      assert.strictEqual(report.azureActive, true);
      assert.strictEqual(report.azure.inventorySummary.total, 3);
      const ctx = dashboard.loadDashboardContext(dir);
      assert.ok(ctx.azure);
      assert.ok(ctx.repositoryContext.azure.summary.includes('subscription=Bradesco DEV'));
      assert.ok(ctx.visual.artifactGraph.some((node) => node.id === 'azure-inventory'));
    });
  });

  test('sdk exports azure namespace', () => {
    assert.ok(sdk.azure);
    assert.strictEqual(typeof sdk.azure.azureDoctor, 'function');
    assert.strictEqual(typeof sdk.azure.syncAzureInventory, 'function');
  });

  // W-A1: Pure function unit tests

  test('summarizeInventory array vazio retorna zeros', () => {
    const s = azure.summarizeInventory([]);
    assert.deepStrictEqual(s, { total: 0, servicebus: 0, eventgrid: 0, sql: 0, other: 0 });
  });

  test('summarizeInventory conta ServiceBus, EventGrid, SQL e other corretamente', () => {
    const items = [
      { type: 'Microsoft.ServiceBus/namespaces' },
      { type: 'Microsoft.EventGrid/topics' },
      { type: 'Microsoft.Sql/servers' },
      { type: 'Microsoft.Storage/storageAccounts' },
    ];
    const s = azure.summarizeInventory(items);
    assert.strictEqual(s.total, 4);
    assert.strictEqual(s.servicebus, 1);
    assert.strictEqual(s.eventgrid, 1);
    assert.strictEqual(s.sql, 1);
    assert.strictEqual(s.other, 1);
  });

  test('summarizeInventory aceita null sem quebrar', () => {
    assert.doesNotThrow(() => azure.summarizeInventory(null));
    const s = azure.summarizeInventory(null);
    assert.strictEqual(s.total, 0);
  });

  test('summarizeInventory multiplos itens do mesmo tipo acumulam', () => {
    const items = [
      { type: 'Microsoft.ServiceBus/namespaces' },
      { type: 'Microsoft.ServiceBus/namespaces' },
      { type: 'Microsoft.Sql/servers' },
    ];
    const s = azure.summarizeInventory(items);
    assert.strictEqual(s.servicebus, 2);
    assert.strictEqual(s.sql, 1);
    assert.strictEqual(s.total, 3);
  });

  test('normalizeInventoryItem item completo preenche todos os campos', () => {
    const item = {
      id: '/subscriptions/sub-001/resourceGroups/rg-app/providers/Microsoft.ServiceBus/namespaces/sb-core',
      name: 'sb-core',
      type: 'Microsoft.ServiceBus/namespaces',
      resourceGroup: 'rg-app',
      location: 'brazilsouth',
      subscriptionId: 'sub-001',
      tags: { env: 'dev' },
      sku: 'Standard',
    };
    const n = azure.normalizeInventoryItem(item);
    assert.strictEqual(n.name, 'sb-core');
    assert.strictEqual(n.service_family, 'servicebus');
    assert.strictEqual(n.resourceGroup, 'rg-app');
    assert.deepStrictEqual(n.tags, { env: 'dev' });
    assert.strictEqual(n.sku, 'Standard');
  });

  test('normalizeInventoryItem item vazio usa fallbacks', () => {
    const n = azure.normalizeInventoryItem({});
    assert.strictEqual(n.id, '');
    assert.strictEqual(n.name, '');
    assert.strictEqual(n.type, '');
    assert.deepStrictEqual(n.tags, {});
    assert.strictEqual(n.service_family, 'other');
  });

  test('normalizeInventoryItem resource_group alias aceito', () => {
    const n = azure.normalizeInventoryItem({ resource_group: 'rg-alt' });
    assert.strictEqual(n.resourceGroup, 'rg-alt');
  });

  test('normalizeInventoryItem tags null vira objeto vazio', () => {
    const n = azure.normalizeInventoryItem({ tags: null });
    assert.deepStrictEqual(n.tags, {});
  });

  test('redactObject redacta password', () => {
    const o = azure.redactObject({ name: 'sb-core', password: 'secret123' });
    assert.strictEqual(o.name, 'sb-core');
    assert.strictEqual(o.password, '[redacted]');
  });

  test('redactObject redacta connection_string', () => {
    const o = azure.redactObject({ connection_string: 'Endpoint=sb://test' });
    assert.strictEqual(o.connection_string, '[redacted]');
  });

  test('redactObject redacta primary_key', () => {
    const o = azure.redactObject({ primary_key: 'abc123' });
    assert.strictEqual(o.primary_key, '[redacted]');
  });

  test('redactObject recursivo em sub-objetos', () => {
    const o = azure.redactObject({ nested: { token: 'tok123', name: 'x' } });
    assert.strictEqual(o.nested.token, '[redacted]');
    assert.strictEqual(o.nested.name, 'x');
  });

  test('redactObject percorre array de objetos', () => {
    const arr = azure.redactObject([{ password: 'p1' }, { name: 'ok' }]);
    assert.strictEqual(arr[0].password, '[redacted]');
    assert.strictEqual(arr[1].name, 'ok');
  });

  test('redactObject campos nao-sensiveis mantidos', () => {
    const o = azure.redactObject({ name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces' });
    assert.strictEqual(o.name, 'sb-core');
    assert.strictEqual(o.type, 'Microsoft.ServiceBus/namespaces');
  });

  test('searchAzureInventory sem inventory retorna vazio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-srch-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const results = azure.searchAzureInventory(dir, 'anything');
    assert.deepStrictEqual(results, []);
  });

  test('searchAzureInventory encontra por nome exato', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-srch-'));
    const inventoryPath = path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    const items = [
      { name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'servicebus' },
      { name: 'eg-core', type: 'Microsoft.EventGrid/topics', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'eventgrid' },
    ];
    fs.writeFileSync(inventoryPath, JSON.stringify({ items, summary: { total: 2 }, synced_at: new Date().toISOString() }), 'utf8');
    const results = azure.searchAzureInventory(dir, 'sb-core');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'sb-core');
  });

  test('searchAzureInventory case-insensitive no type', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-srch-'));
    const inventoryPath = path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    const items = [{ name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'servicebus' }];
    fs.writeFileSync(inventoryPath, JSON.stringify({ items, synced_at: new Date().toISOString() }), 'utf8');
    const results = azure.searchAzureInventory(dir, 'SERVICEBUS');
    assert.strictEqual(results.length, 1);
  });

  test('searchAzureInventory query sem match retorna vazio', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-srch-'));
    const inventoryPath = path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    const items = [{ name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'servicebus' }];
    fs.writeFileSync(inventoryPath, JSON.stringify({ items, synced_at: new Date().toISOString() }), 'utf8');
    const results = azure.searchAzureInventory(dir, 'naoexisteeventosdoazure');
    assert.deepStrictEqual(results, []);
  });

  test('isAzureContextEnabled false quando dir sem azure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ctx-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    assert.strictEqual(azure.isAzureContextEnabled(dir, {}), false);
  });

  test('isAzureContextEnabled true quando config.azure.enabled = true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ctx-'));
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    assert.strictEqual(azure.isAzureContextEnabled(dir, { azure: { enabled: true } }), true);
  });

  test('isAzureContextEnabled true quando profile.json existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ctx-'));
    const profilePath = path.join(dir, '.oxe', 'cloud', 'azure', 'profile.json');
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, '{}', 'utf8');
    assert.strictEqual(azure.isAzureContextEnabled(dir, {}), true);
  });

  test('isAzureContextEnabled true quando capability azure-auth existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ctx-'));
    const capPath = path.join(dir, '.oxe', 'capabilities', 'azure-auth', 'CAPABILITY.md');
    fs.mkdirSync(path.dirname(capPath), { recursive: true });
    fs.writeFileSync(capPath, '# cap\n', 'utf8');
    assert.strictEqual(azure.isAzureContextEnabled(dir, {}), true);
  });

  // W-A2: CLI subcommand tests

  test('azure find retorna recurso quando query bate com inventario', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-find-'));
    const fake = createFakeAzureCli();
    spawnSync(process.execPath, [CLI, 'azure', 'sync', '--dir', dir], { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env });
    const result = spawnSync(process.execPath, [CLI, 'azure', 'find', 'sb-core', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /sb-core/);
  });

  test('azure find sem match exibe mensagem adequada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-find-'));
    const fake = createFakeAzureCli();
    spawnSync(process.execPath, [CLI, 'azure', 'sync', '--dir', dir], { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env });
    const result = spawnSync(process.execPath, [CLI, 'azure', 'find', 'recursoinexistente999', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout + result.stderr, /nenhum recurso/i);
  });

  test('azure auth set-subscription seleciona subscription pelo ID', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sub-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'auth', 'set-subscription', '--subscription', 'sub-001', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Subscription selecionada/i);
  });

  test('azure servicebus list retorna JSON com namespaces', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sblist-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'servicebus', 'list', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const json = extractJsonFromCli(result.stdout);
    assert.ok(Array.isArray(json));
    assert.ok(json.some((item) => item.type === 'Microsoft.ServiceBus/namespaces'));
  });

  test('azure servicebus show retorna JSON do namespace pelo nome', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sbshow-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'servicebus', 'show', '--name', 'sb-core', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const json = extractJsonFromCli(result.stdout);
    assert.ok(typeof json === 'object' && json !== null);
  });

  test('azure servicebus plan cria operacao planejada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sbplan-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'servicebus', 'plan', '--kind', 'namespace', '--name', 'sb-new', '--resource-group', 'rg-app', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Operation ID/i);
    assert.match(result.stdout, /Checkpoint/i);
  });

  test('azure eventgrid list retorna JSON com topics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-eglist-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'eventgrid', 'list', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const json = extractJsonFromCli(result.stdout);
    assert.ok(Array.isArray(json));
    assert.ok(json.some((item) => item.type === 'Microsoft.EventGrid/topics'));
  });

  test('azure sql list retorna JSON com servidores SQL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sqllist-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'sql', 'list', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const json = extractJsonFromCli(result.stdout);
    assert.ok(Array.isArray(json));
    assert.ok(json.some((item) => item.type === 'Microsoft.Sql/servers'));
  });

  test('azure sql plan cria operacao planejada para servidor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sqlplan-'));
    const fake = createFakeAzureCli();
    const env = { ...fake.env, AZURE_SQL_ADMIN_PASSWORD: 'Test1234!' };
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'sql', 'plan', '--kind', 'server', '--name', 'sql-new', '--resource-group', 'rg-data', '--location', 'brazilsouth', '--admin-user', 'sqladmin', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Operation ID/i);
  });

  // W-A3: New features

  test('searchAzureInventory filtra por --type', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-filt-'));
    const inventoryPath = path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    const items = [
      { name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'servicebus' },
      { name: 'sql-core', type: 'Microsoft.Sql/servers', resourceGroup: 'rg-data', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'sql' },
    ];
    fs.writeFileSync(inventoryPath, JSON.stringify({ items, synced_at: new Date().toISOString() }), 'utf8');
    const results = azure.searchAzureInventory(dir, '', { type: 'servicebus' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'sb-core');
  });

  test('searchAzureInventory filtra por --filter-rg', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-filt-'));
    const inventoryPath = path.join(dir, '.oxe', 'cloud', 'azure', 'inventory.json');
    fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
    const items = [
      { name: 'sb-core', type: 'Microsoft.ServiceBus/namespaces', resourceGroup: 'rg-app', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'servicebus' },
      { name: 'sql-core', type: 'Microsoft.Sql/servers', resourceGroup: 'rg-data', location: 'brazilsouth', subscriptionId: 'sub-001', tags: {}, sku: '', service_family: 'sql' },
    ];
    fs.writeFileSync(inventoryPath, JSON.stringify({ items, synced_at: new Date().toISOString() }), 'utf8');
    const results = azure.searchAzureInventory(dir, '', { resourceGroup: 'rg-data' });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'sql-core');
  });

  test('diffInventory detecta adicionados e removidos', () => {
    const prev = [
      { id: '/sub/rg/sb/old', name: 'sb-old', type: 'Microsoft.ServiceBus/namespaces' },
    ];
    const curr = [
      { id: '/sub/rg/sb/new', name: 'sb-new', type: 'Microsoft.ServiceBus/namespaces' },
    ];
    const diff = azure.diffInventory(prev, curr);
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.removed.length, 1);
    assert.strictEqual(diff.unchanged, 0);
    assert.strictEqual(diff.added[0].name, 'sb-new');
    assert.strictEqual(diff.removed[0].name, 'sb-old');
  });

  test('diffInventory sem mudancas retorna unchanged correto', () => {
    const items = [{ id: '/sub/rg/sb/x', name: 'sb-x', type: 'Microsoft.ServiceBus/namespaces' }];
    const diff = azure.diffInventory(items, items);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.removed.length, 0);
    assert.strictEqual(diff.unchanged, 1);
  });

  test('statusAzure retorna estrutura completa', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-st-'));
    const fake = createFakeAzureCli();
    withFakeAzureCli(fake, () => {
      azure.syncAzureInventory(dir);
      const st = azure.statusAzure(dir, { azure: { inventory_max_age_hours: 24 } });
      assert.strictEqual(st.cliInstalled, true);
      assert.strictEqual(st.loginActive, true);
      assert.ok(st.subscription);
      assert.strictEqual(st.inventoryPresent, true);
      assert.strictEqual(st.inventoryStale, false);
      assert.ok(st.inventorySummary);
      assert.strictEqual(typeof st.pendingOperations, 'number');
    });
  });

  test('applyAzureOperation com dryRun retorna preview sem criar artefatos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-dry-'));
    const fake = createFakeAzureCli();
    withFakeAzureCli(fake, () => {
      const result = azure.applyAzureOperation(
        dir, null, 'servicebus',
        { kind: 'namespace', name: 'sb-dryrun', resourceGroup: 'rg-app', location: 'brazilsouth' },
        { dryRun: true }
      );
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.operation.phase, 'dry_run');
      assert.ok(result.commandPreview.includes('servicebus'));
      // No files should be created in operations dir
      const opsDir = path.join(dir, '.oxe', 'cloud', 'azure', 'operations');
      const files = fs.existsSync(opsDir) ? fs.readdirSync(opsDir).filter((n) => n.endsWith('.json')) : [];
      assert.strictEqual(files.length, 0);
    });
  });

  test('applyAzureOperation lanca erro quando vpn_required e nao confirmada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-vpn-'));
    const fake = createFakeAzureCli();
    withFakeAzureCli(fake, () => {
      assert.throws(
        () => azure.applyAzureOperation(
          dir, null, 'servicebus',
          { kind: 'namespace', name: 'sb-vpn', resourceGroup: 'rg-app', location: 'brazilsouth' },
          { vpnRequired: true, vpnConfirmed: false }
        ),
        /VPN/i
      );
    });
  });

  test('azure sync --diff mostra recursos adicionados via CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-diff-'));
    const fake = createFakeAzureCli();
    // First sync (empty → 3 resources)
    spawnSync(process.execPath, [CLI, 'azure', 'sync', '--dir', dir], { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env });
    // Second sync with --diff (same state → 0 changes)
    const result = spawnSync(process.execPath, [CLI, 'azure', 'sync', '--diff', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Diff:/i);
  });

  test('azure status exibe estado compacto via CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-status-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(process.execPath, [CLI, 'azure', 'status', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /CLI:/i);
    assert.match(result.stdout, /Login:/i);
    assert.match(result.stdout, /Sub:/i);
  });

  test('azure operations list exibe historico de operacoes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ops-'));
    const fake = createFakeAzureCli();
    // Create an operation first
    spawnSync(
      process.execPath,
      [CLI, 'azure', 'servicebus', 'apply', '--kind', 'namespace', '--name', 'sb-hist', '--resource-group', 'rg-app', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    const result = spawnSync(process.execPath, [CLI, 'azure', 'operations', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /waiting_approval|planned|applied/i);
  });

  test('azure find --type filtra por tipo de servico', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-ftype-'));
    const fake = createFakeAzureCli();
    spawnSync(process.execPath, [CLI, 'azure', 'sync', '--dir', dir], { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env });
    const result = spawnSync(process.execPath, [CLI, 'azure', 'find', '--type', 'servicebus', '--dir', dir], {
      cwd: REPO_ROOT, encoding: 'utf8', env: fake.env,
    });
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /ServiceBus/i);
    assert.ok(!result.stdout.toLowerCase().includes('sql'));
  });

  test('azure apply --dry-run mostra preview sem aplicar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-dryruncli-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'servicebus', 'apply', '--kind', 'namespace', '--name', 'sb-preview', '--resource-group', 'rg-app', '--dry-run', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /dry-run/i);
    assert.match(result.stdout, /Comando:/i);
    const opsDir = path.join(dir, '.oxe', 'cloud', 'azure', 'operations');
    const files = fs.existsSync(opsDir) ? fs.readdirSync(opsDir).filter((n) => n.endsWith('.json')) : [];
    assert.strictEqual(files.length, 0);
  });

  // W-A4: --tenant support
  test('azure auth login sem --tenant nao passa --tenant ao az login', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-notenant-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'auth', 'login', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const recorded = fs.existsSync(fake.recordFile) ? fs.readFileSync(fake.recordFile, 'utf8') : '';
    assert.ok(!recorded.includes('--tenant'), '--tenant nao deve aparecer sem a opcao');
  });

  test('azure auth login --tenant via CLI passa --tenant ao az login', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-tenant-cli-'));
    const fake = createFakeAzureCli();
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'auth', 'login', '--tenant', 'entra-tenant-123', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: fake.env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    const recorded = fs.existsSync(fake.recordFile) ? fs.readFileSync(fake.recordFile, 'utf8') : '';
    assert.match(recorded, /--tenant entra-tenant-123/);
  });

  test('azure sql apply com approve executa operacao e cria artefato em operations/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-az-sqlapply-'));
    const fake = createFakeAzureCli();
    const env = { ...fake.env, AZURE_SQL_ADMIN_PASSWORD: 'Test1234!' };
    const result = spawnSync(
      process.execPath,
      [CLI, 'azure', 'sql', 'apply', '--kind', 'server', '--name', 'sql-applied', '--resource-group', 'rg-data', '--location', 'brazilsouth', '--admin-user', 'sqladmin', '--approve', '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env }
    );
    assert.strictEqual(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Operação Azure aplicada/i);
    const opsFiles = fs.readdirSync(path.join(dir, '.oxe', 'cloud', 'azure', 'operations')).filter((n) => n.endsWith('.json'));
    assert.ok(opsFiles.length >= 1);
  });
});
