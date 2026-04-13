'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const operational = require('./oxe-operational.cjs');

const MIN_AZURE_CLI_MAJOR = 2;
const AZURE_CAPABILITY_IDS = [
  'azure-auth',
  'azure-resource-graph',
  'azure-servicebus',
  'azure-eventgrid',
  'azure-sql-admin',
];

const DEFAULT_AZURE_PROFILE = {
  cloud: 'AzureCloud',
  tenant_id: null,
  subscription_id: null,
  subscription_name: null,
  auth_mode: 'unknown',
  default_resource_group: '',
  preferred_locations: [],
  last_auth_check: null,
  resource_graph_enabled: false,
};

const RESOURCE_GRAPH_QUERY = [
  'Resources',
  '| project',
  'id,',
  'name,',
  'type,',
  'resourceGroup,',
  'location,',
  'subscriptionId,',
  'tags,',
  'sku=tostring(sku.name)',
].join(' ');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDirForFile(filePath) {
  ensureDir(path.dirname(filePath));
}

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath, fallback = null) {
  const raw = readTextIfExists(filePath);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeText(filePath, value) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, value, 'utf8');
}

function azurePaths(projectRoot) {
  const root = path.join(projectRoot, '.oxe', 'cloud', 'azure');
  return {
    root,
    profile: path.join(root, 'profile.json'),
    authStatus: path.join(root, 'auth-status.json'),
    inventory: path.join(root, 'inventory.json'),
    inventoryMd: path.join(root, 'INVENTORY.md'),
    serviceBusMd: path.join(root, 'SERVICEBUS.md'),
    eventGridMd: path.join(root, 'EVENTGRID.md'),
    sqlMd: path.join(root, 'SQL.md'),
    operationsDir: path.join(root, 'operations'),
  };
}

function ensureAzureArtifacts(projectRoot) {
  const p = azurePaths(projectRoot);
  ensureDir(p.root);
  ensureDir(p.operationsDir);
  return p;
}

function isAzureContextEnabled(projectRoot, config = {}) {
  const p = azurePaths(projectRoot);
  const capsRoot = path.join(projectRoot, '.oxe', 'capabilities');
  const azureConfig = config && typeof config.azure === 'object' ? config.azure : null;
  return Boolean(
    (azureConfig && azureConfig.enabled) ||
      fs.existsSync(p.root) ||
      fs.existsSync(p.profile) ||
      fs.existsSync(p.inventory) ||
      AZURE_CAPABILITY_IDS.some((id) => fs.existsSync(path.join(capsRoot, id, 'CAPABILITY.md')))
  );
}

function redactString(value, fallback = '[redacted]') {
  if (value == null || value === '') return null;
  return fallback;
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map((item) => redactObject(item));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(token|secret|password|connection.?string|access.?key|primary.?key|secondary.?key)/i.test(key)) {
      out[key] = redactString(item);
    } else {
      out[key] = redactObject(item);
    }
  }
  return out;
}

function runAz(args, options = {}) {
  if (typeof options.runner === 'function') {
    return options.runner(args, options);
  }
  const spawnOptions = {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs || 30000,
    stdio: options.inherit ? 'inherit' : 'pipe',
  };
  let result;
  if (process.platform === 'win32') {
    const quoteForCmd = (value) => {
      const raw = String(value == null ? '' : value);
      if (!raw.length) return '""';
      if (!/[ \t"&|<>^]/.test(raw)) return raw;
      return `"${raw.replace(/"/g, '""')}"`;
    };
    const commandLine = ['az', ...args].map((item) => quoteForCmd(item)).join(' ');
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], spawnOptions);
  } else {
    result = spawnSync('az', args, spawnOptions);
  }
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error: result.error || null,
  };
}

function parseJsonOutput(raw, fallback = null) {
  try {
    return JSON.parse(String(raw || '').trim() || 'null');
  } catch {
    return fallback;
  }
}

function detectAzureCli(projectRoot, options = {}) {
  const result = runAz(['version', '--output', 'json'], { cwd: projectRoot, ...options });
  if (result.error) {
    return {
      installed: false,
      version: null,
      major: null,
      okVersion: false,
      message: result.error.message || 'Azure CLI não encontrada.',
      raw: null,
    };
  }
  if (result.status !== 0) {
    return {
      installed: false,
      version: null,
      major: null,
      okVersion: false,
      message: (result.stderr || result.stdout || 'Azure CLI não encontrada.').trim(),
      raw: null,
    };
  }
  const parsed = parseJsonOutput(result.stdout, {});
  const version = String((parsed && parsed['azure-cli']) || '').trim() || null;
  const major = version ? parseInt(version.split('.')[0], 10) : null;
  return {
    installed: true,
    version,
    major,
    okVersion: Number.isInteger(major) && major >= MIN_AZURE_CLI_MAJOR,
    message: null,
    raw: parsed,
  };
}

function normalizeAuthMode(account) {
  const userType = String(account && account.user && account.user.type || '').toLowerCase();
  if (userType === 'serviceprincipal') return 'service_principal';
  if (userType === 'user') return 'user_mfa';
  if (userType === 'managedidentity') return 'managed_identity';
  return 'unknown';
}

function normalizeAzureProfile(account, cloud, existingProfile = {}) {
  const profile = {
    ...DEFAULT_AZURE_PROFILE,
    ...(existingProfile && typeof existingProfile === 'object' ? existingProfile : {}),
  };
  if (!account || typeof account !== 'object') return profile;
  return {
    ...profile,
    cloud: String((cloud && cloud.name) || profile.cloud || 'AzureCloud'),
    tenant_id: account.tenantId || profile.tenant_id || null,
    subscription_id: account.id || profile.subscription_id || null,
    subscription_name: account.name || profile.subscription_name || null,
    auth_mode: normalizeAuthMode(account),
    last_auth_check: new Date().toISOString(),
  };
}

function loadAzureProfile(projectRoot) {
  return {
    ...DEFAULT_AZURE_PROFILE,
    ...(readJsonIfExists(azurePaths(projectRoot).profile, {}) || {}),
  };
}

function loadAzureAuthStatus(projectRoot) {
  return readJsonIfExists(azurePaths(projectRoot).authStatus, null);
}

function loadAzureInventory(projectRoot) {
  return readJsonIfExists(azurePaths(projectRoot).inventory, null);
}

function deriveServiceFamily(type) {
  const value = String(type || '').toLowerCase();
  if (value.startsWith('microsoft.servicebus/')) return 'servicebus';
  if (value.startsWith('microsoft.eventgrid/')) return 'eventgrid';
  if (value.startsWith('microsoft.sql/')) return 'sql';
  return 'other';
}

function summarizeInventory(items) {
  const summary = {
    total: 0,
    servicebus: 0,
    eventgrid: 0,
    sql: 0,
    other: 0,
  };
  for (const item of items || []) {
    const family = deriveServiceFamily(item.type || item.service_family);
    summary.total += 1;
    summary[family] = (summary[family] || 0) + 1;
  }
  return summary;
}

function normalizeInventoryItem(item = {}) {
  const normalized = {
    id: item.id || '',
    name: item.name || '',
    type: item.type || '',
    resourceGroup: item.resourceGroup || item.resource_group || '',
    location: item.location || '',
    subscriptionId: item.subscriptionId || item.subscription_id || '',
    tags: item.tags && typeof item.tags === 'object' ? item.tags : {},
    sku: item.sku || '',
  };
  normalized.service_family = deriveServiceFamily(normalized.type);
  return normalized;
}

function renderInventoryMarkdown(title, profile, authStatus, items, syncedAt) {
  const summary = summarizeInventory(items);
  const lines = [
    `# OXE — ${title}`,
    '',
    '> Inventário Azure materializado pelo provider nativo do OXE via Azure CLI.',
    '',
    `- **Cloud:** ${profile.cloud || '—'}`,
    `- **Tenant:** ${profile.tenant_id || '—'}`,
    `- **Subscription:** ${profile.subscription_name || profile.subscription_id || '—'}`,
    `- **Auth mode:** ${profile.auth_mode || 'unknown'}`,
    `- **Último check de auth:** ${profile.last_auth_check || authStatus && authStatus.checked_at || '—'}`,
    `- **Último sync:** ${syncedAt || '—'}`,
    '',
    '## Resumo',
    '',
    `- **Total:** ${summary.total}`,
    `- **Service Bus:** ${summary.servicebus}`,
    `- **Event Grid:** ${summary.eventgrid}`,
    `- **Azure SQL:** ${summary.sql}`,
    `- **Outros:** ${summary.other}`,
    '',
    '| Nome | Tipo | Família | Resource Group | Location | SKU |',
    '|------|------|---------|----------------|----------|-----|',
  ];
  if (!items.length) {
    lines.push('| (vazio) | — | — | — | — | — |');
  } else {
    for (const item of items) {
      lines.push(
        `| ${item.name || '—'} | ${item.type || '—'} | ${item.service_family || 'other'} | ${item.resourceGroup || '—'} | ${item.location || '—'} | ${item.sku || '—'} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function listAzureOperations(projectRoot) {
  const p = azurePaths(projectRoot);
  if (!fs.existsSync(p.operationsDir)) return [];
  return fs
    .readdirSync(p.operationsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonIfExists(path.join(p.operationsDir, name), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function writeAzureAuthArtifacts(projectRoot, payload) {
  const p = ensureAzureArtifacts(projectRoot);
  if (payload.profile) writeJson(p.profile, payload.profile);
  if (payload.authStatus) writeJson(p.authStatus, redactObject(payload.authStatus));
  return p;
}

function getAzureContext(projectRoot, options = {}) {
  const cli = detectAzureCli(projectRoot, options);
  const existingProfile = loadAzureProfile(projectRoot);
  if (!cli.installed) {
    const authStatus = {
      checked_at: new Date().toISOString(),
      installed: false,
      version: null,
      login_active: false,
      subscription_selected: false,
      tenant_id: null,
      subscription_id: existingProfile.subscription_id || null,
      subscription_name: existingProfile.subscription_name || null,
      cloud: existingProfile.cloud || 'AzureCloud',
      auth_mode: existingProfile.auth_mode || 'unknown',
      user: null,
      user_type: null,
      resource_graph_enabled: false,
      warnings: [cli.message || 'Azure CLI não instalada.'],
    };
    if (options.write !== false) {
      writeAzureAuthArtifacts(projectRoot, { profile: existingProfile, authStatus });
    }
    return { cli, profile: existingProfile, authStatus, account: null, cloud: null, extension: null };
  }

  const accountResult = runAz(['account', 'show', '--output', 'json'], { cwd: projectRoot, ...options });
  if (accountResult.status !== 0) {
    const authStatus = {
      checked_at: new Date().toISOString(),
      installed: true,
      version: cli.version,
      login_active: false,
      subscription_selected: Boolean(existingProfile.subscription_id),
      tenant_id: existingProfile.tenant_id || null,
      subscription_id: existingProfile.subscription_id || null,
      subscription_name: existingProfile.subscription_name || null,
      cloud: existingProfile.cloud || 'AzureCloud',
      auth_mode: existingProfile.auth_mode || 'unknown',
      user: null,
      user_type: null,
      resource_graph_enabled: false,
      warnings: ['Azure CLI instalada, mas sem sessão ativa. Execute "oxe-cc azure auth login".'],
    };
    if (options.write !== false) {
      writeAzureAuthArtifacts(projectRoot, { profile: existingProfile, authStatus });
    }
    return { cli, profile: existingProfile, authStatus, account: null, cloud: null, extension: null };
  }

  const account = parseJsonOutput(accountResult.stdout, {});
  const cloud = parseJsonOutput(runAz(['cloud', 'show', '--output', 'json'], { cwd: projectRoot, ...options }).stdout, {});
  const extension = parseJsonOutput(
    runAz(['extension', 'show', '--name', 'resource-graph', '--output', 'json'], { cwd: projectRoot, ...options }).stdout,
    null
  );
  const profile = normalizeAzureProfile(account, cloud, existingProfile);
  profile.resource_graph_enabled = Boolean(extension);
  const authStatus = {
    checked_at: new Date().toISOString(),
    installed: true,
    version: cli.version,
    login_active: true,
    subscription_selected: Boolean(account.id),
    tenant_id: account.tenantId || null,
    subscription_id: account.id || null,
    subscription_name: account.name || null,
    cloud: (cloud && cloud.name) || profile.cloud || 'AzureCloud',
    auth_mode: normalizeAuthMode(account),
    user: account.user && account.user.name ? account.user.name : null,
    user_type: account.user && account.user.type ? account.user.type : null,
    resource_graph_enabled: Boolean(extension),
    warnings: [],
  };
  if (options.write !== false) {
    writeAzureAuthArtifacts(projectRoot, { profile, authStatus });
  }
  return { cli, profile, authStatus, account, cloud, extension };
}

function ensureResourceGraphExtension(projectRoot, options = {}) {
  const show = runAz(['extension', 'show', '--name', 'resource-graph', '--output', 'json'], { cwd: projectRoot, ...options });
  if (show.status === 0) {
    return {
      ok: true,
      installed: true,
      changed: false,
      extension: parseJsonOutput(show.stdout, {}),
    };
  }
  if (options.autoInstall === false) {
    return {
      ok: false,
      installed: false,
      changed: false,
      extension: null,
      message: 'Extensão resource-graph ausente.',
    };
  }
  const add = runAz(['extension', 'add', '--name', 'resource-graph', '--upgrade', '--only-show-errors'], {
    cwd: projectRoot,
    ...options,
  });
  if (add.status !== 0) {
    return {
      ok: false,
      installed: false,
      changed: false,
      extension: null,
      message: (add.stderr || add.stdout || 'Falha ao instalar resource-graph.').trim(),
    };
  }
  const installed = parseJsonOutput(
    runAz(['extension', 'show', '--name', 'resource-graph', '--output', 'json'], { cwd: projectRoot, ...options }).stdout,
    {}
  );
  return {
    ok: true,
    installed: true,
    changed: true,
    extension: installed,
  };
}

function syncAzureInventory(projectRoot, options = {}) {
  const p = ensureAzureArtifacts(projectRoot);
  const previousInventory = options.diff ? loadAzureInventory(projectRoot) : null;
  const context = getAzureContext(projectRoot, options);
  if (!context.cli.installed) {
    throw new Error('Azure CLI não instalada.');
  }
  if (!context.authStatus.login_active) {
    throw new Error('Sessão Azure ausente. Execute "oxe-cc azure auth login".');
  }
  const extension = ensureResourceGraphExtension(projectRoot, options);
  if (!extension.ok) {
    throw new Error(extension.message || 'Extensão resource-graph ausente.');
  }
  const args = ['graph', 'query', '-q', RESOURCE_GRAPH_QUERY, '--first', '1000', '--output', 'json'];
  if (context.profile.subscription_id) {
    args.push('--subscriptions', context.profile.subscription_id);
  }
  const result = runAz(args, { cwd: projectRoot, ...options });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Falha ao executar az graph query.').trim());
  }
  const parsed = parseJsonOutput(result.stdout, {});
  const items = Array.isArray(parsed.data) ? parsed.data.map(normalizeInventoryItem) : [];
  items.sort((a, b) => String(a.service_family).localeCompare(String(b.service_family)) || String(a.name).localeCompare(String(b.name)));
  const syncedAt = new Date().toISOString();
  const inventory = {
    oxeAzureInventorySchema: 1,
    synced_at: syncedAt,
    query: RESOURCE_GRAPH_QUERY,
    cloud: context.profile.cloud,
    tenant_id: context.profile.tenant_id,
    subscription_id: context.profile.subscription_id,
    subscription_name: context.profile.subscription_name,
    summary: summarizeInventory(items),
    items,
  };
  writeJson(p.inventory, inventory);
  writeText(p.inventoryMd, renderInventoryMarkdown('Azure Inventory', context.profile, context.authStatus, items, syncedAt));
  writeText(
    p.serviceBusMd,
    renderInventoryMarkdown(
      'Service Bus',
      context.profile,
      context.authStatus,
      items.filter((item) => item.service_family === 'servicebus'),
      syncedAt
    )
  );
  writeText(
    p.eventGridMd,
    renderInventoryMarkdown(
      'Event Grid',
      context.profile,
      context.authStatus,
      items.filter((item) => item.service_family === 'eventgrid'),
      syncedAt
    )
  );
  writeText(
    p.sqlMd,
    renderInventoryMarkdown(
      'Azure SQL',
      context.profile,
      context.authStatus,
      items.filter((item) => item.service_family === 'sql'),
      syncedAt
    )
  );
  const nextProfile = {
    ...context.profile,
    resource_graph_enabled: true,
    last_auth_check: context.authStatus.checked_at,
  };
  writeAzureAuthArtifacts(projectRoot, {
    profile: nextProfile,
    authStatus: {
      ...context.authStatus,
      checked_at: syncedAt,
      resource_graph_enabled: true,
      last_sync: syncedAt,
    },
  });
  const syncResult = { paths: p, profile: nextProfile, authStatus: context.authStatus, inventory };
  if (options.diff && previousInventory) {
    syncResult.diff = diffInventory(previousInventory.items || [], items);
  }
  return syncResult;
}

function searchAzureInventory(projectRoot, query, filters = {}) {
  const inventory = loadAzureInventory(projectRoot);
  if (!inventory || !Array.isArray(inventory.items)) return [];
  let items = inventory.items;
  if (filters.type) {
    const ft = String(filters.type).toLowerCase();
    items = items.filter((item) =>
      String(item.type || '').toLowerCase().includes(ft) ||
      String(item.service_family || '').toLowerCase().includes(ft)
    );
  }
  if (filters.resourceGroup) {
    const frg = String(filters.resourceGroup).toLowerCase();
    items = items.filter((item) => String(item.resourceGroup || '').toLowerCase() === frg);
  }
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = [
      item.name,
      item.type,
      item.resourceGroup,
      item.location,
      item.subscriptionId,
      item.service_family,
      ...Object.keys(item.tags || {}),
      ...Object.values(item.tags || {}),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function diffInventory(previousItems, currentItems) {
  const prevMap = new Map((previousItems || []).map((item) => [item.id, item]));
  const currMap = new Map((currentItems || []).map((item) => [item.id, item]));
  const added = (currentItems || []).filter((item) => !prevMap.has(item.id));
  const removed = (previousItems || []).filter((item) => !currMap.has(item.id));
  return { added, removed, unchanged: (currentItems || []).length - added.length };
}

function statusAzure(projectRoot, config = {}, options = {}) {
  const context = getAzureContext(projectRoot, { ...options, write: false });
  const inventory = loadAzureInventory(projectRoot);
  const azureCfg = config && typeof config.azure === 'object' ? config.azure : {};
  const maxAgeHours = azureCfg.inventory_max_age_hours != null ? Number(azureCfg.inventory_max_age_hours) : 24;
  const syncedAtMs = inventory ? Date.parse(String(inventory.synced_at || '')) : null;
  const ageHours = syncedAtMs && !Number.isNaN(syncedAtMs) ? Math.floor((Date.now() - syncedAtMs) / (1000 * 60 * 60)) : null;
  const stale = ageHours !== null && maxAgeHours > 0 && ageHours > maxAgeHours;
  const pendingOps = listAzureOperations(projectRoot).filter((op) => op.phase === 'waiting_approval');
  return {
    cliInstalled: context.cli.installed,
    cliVersion: context.cli.version || null,
    loginActive: context.authStatus.login_active,
    subscription: context.profile.subscription_name || context.profile.subscription_id || null,
    cloud: context.profile.cloud || 'AzureCloud',
    resourceGraphEnabled: Boolean(context.authStatus.resource_graph_enabled),
    inventoryPresent: Boolean(inventory),
    inventoryStale: stale,
    inventoryAgeHours: ageHours,
    inventorySummary: inventory && inventory.summary ? inventory.summary : null,
    pendingOperations: pendingOps.length,
    pendingOperationIds: pendingOps.map((op) => op.operation_id),
    vpnRequired: Boolean(azureCfg.vpn_required),
  };
}

function renderCapabilityManifest(manifest) {
  return [
    '---',
    'oxe_capability: true',
    `id: ${manifest.id}`,
    'version: 1',
    'type: script',
    'status: active',
    `scope: ${manifest.scope}`,
    `entrypoint: "${manifest.entrypoint}"`,
    `approval_policy: ${manifest.approval_policy}`,
    `side_effects: [${manifest.side_effects.map((item) => item).join(', ')}]`,
    `requires_env: [${manifest.requires_env.map((item) => item).join(', ')}]`,
    `evidence_outputs: [${manifest.evidence_outputs.map((item) => item).join(', ')}]`,
    'session_compatibility: [legacy, session]',
    '---',
    '',
    `# OXE — Capability ${manifest.id}`,
    '',
    '## Objetivo',
    '',
    `- ${manifest.summary}`,
    '',
    '## Escopo OXE',
    '',
    `- ${manifest.scope}`,
    '',
    '## Operações',
    '',
    ...manifest.operations.map((op) => `- ${op}`),
    '',
    '## Entradas e saídas',
    '',
    '- Entradas resolvidas pelo provider Azure e pelo runtime do OXE.',
    '- Saídas persistidas em `.oxe/cloud/azure/operations/` e no trace operacional.',
    '',
    '## Requisitos',
    '',
    '- Azure CLI instalada localmente.',
    '- Sessão Azure válida ou contexto autenticado compatível.',
    '',
    '## Evidência e segurança',
    '',
    '- Toda mutação gera plano, checkpoint e evidência redacted.',
    '- Segredos não são persistidos em `.oxe/`.',
    '',
  ].join('\n');
}

function ensureAzureCapabilities(projectRoot) {
  const capsDir = path.join(projectRoot, '.oxe', 'capabilities');
  ensureDir(capsDir);
  const manifests = [
    {
      id: 'azure-auth',
      scope: 'ask',
      entrypoint: 'oxe-cc azure auth <login|whoami|set-subscription>',
      approval_policy: 'always_allow',
      side_effects: [],
      requires_env: [],
      evidence_outputs: ['.oxe/cloud/azure/auth-status.json', '.oxe/cloud/azure/profile.json'],
      summary: 'Autenticação e contexto Azure corporativo via Azure CLI.',
      operations: ['auth login', 'auth whoami', 'auth set-subscription'],
    },
    {
      id: 'azure-resource-graph',
      scope: 'research',
      entrypoint: 'oxe-cc azure sync',
      approval_policy: 'always_allow',
      side_effects: [],
      requires_env: [],
      evidence_outputs: ['.oxe/cloud/azure/inventory.json', '.oxe/cloud/azure/INVENTORY.md'],
      summary: 'Discovery determinístico de recursos Azure via Resource Graph.',
      operations: ['sync inventory', 'find resource'],
    },
    {
      id: 'azure-servicebus',
      scope: 'execute',
      entrypoint: 'oxe-cc azure servicebus <list|show|plan|apply>',
      approval_policy: 'require_approval_if_external_side_effect',
      side_effects: ['azure_resource_mutation'],
      requires_env: [],
      evidence_outputs: ['.oxe/cloud/azure/operations/*.json', '.oxe/cloud/azure/SERVICEBUS.md'],
      summary: 'Gestão assistida de namespaces, queues, topics e subscriptions do Azure Service Bus.',
      operations: ['list', 'show', 'create namespace', 'create queue', 'create topic', 'create subscription'],
    },
    {
      id: 'azure-eventgrid',
      scope: 'execute',
      entrypoint: 'oxe-cc azure eventgrid <list|show|plan|apply>',
      approval_policy: 'require_approval_if_external_side_effect',
      side_effects: ['azure_resource_mutation'],
      requires_env: [],
      evidence_outputs: ['.oxe/cloud/azure/operations/*.json', '.oxe/cloud/azure/EVENTGRID.md'],
      summary: 'Gestão assistida de topics, system topics e event subscriptions do Azure Event Grid.',
      operations: ['list', 'show', 'create topic', 'create event subscription'],
    },
    {
      id: 'azure-sql-admin',
      scope: 'execute',
      entrypoint: 'oxe-cc azure sql <list|show|plan|apply>',
      approval_policy: 'require_approval_if_external_side_effect',
      side_effects: ['azure_resource_mutation'],
      requires_env: ['AZURE_SQL_ADMIN_PASSWORD'],
      evidence_outputs: ['.oxe/cloud/azure/operations/*.json', '.oxe/cloud/azure/SQL.md'],
      summary: 'Gestão assistida de servers, databases e firewall rules do Azure SQL.',
      operations: ['list', 'show', 'create server', 'create database', 'create firewall rule'],
    },
  ];
  for (const manifest of manifests) {
    const filePath = path.join(capsDir, manifest.id, 'CAPABILITY.md');
    if (!fs.existsSync(filePath)) {
      ensureDir(path.dirname(filePath));
      writeText(filePath, renderCapabilityManifest(manifest));
    }
  }
  return manifests.map((manifest) => manifest.id);
}

function makeOperationId(domain) {
  return `azure-${domain}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCheckpointId() {
  return `CP-AZ-${Date.now().toString(36).toUpperCase()}`;
}

function ipRangeTooWide(start, end) {
  const s = String(start || '').trim();
  const e = String(end || '').trim();
  return (s === '0.0.0.0' && e === '255.255.255.255') || (s === '*' && e === '*');
}

function requireField(input, key, label) {
  const value = input[key];
  if (value == null || value === '') {
    throw new Error(`Informe ${label}.`);
  }
  return String(value);
}

function buildReadCommand(domain, verb, input) {
  const resourceGroup = input.resourceGroup ? ['--resource-group', String(input.resourceGroup)] : [];
  if (domain === 'servicebus') {
    const kind = String(input.kind || 'namespace');
    if (verb === 'list') {
      if (kind === 'namespace') return ['servicebus', 'namespace', 'list', ...resourceGroup, '--output', 'json'];
      if (kind === 'queue') return ['servicebus', 'queue', 'list', '--namespace-name', requireField(input, 'namespace', '--namespace'), ...resourceGroup, '--output', 'json'];
      if (kind === 'topic') return ['servicebus', 'topic', 'list', '--namespace-name', requireField(input, 'namespace', '--namespace'), ...resourceGroup, '--output', 'json'];
      if (kind === 'subscription') {
        return [
          'servicebus',
          'topic',
          'subscription',
          'list',
          '--namespace-name',
          requireField(input, 'namespace', '--namespace'),
          '--topic-name',
          requireField(input, 'topicName', '--topic-name'),
          ...resourceGroup,
          '--output',
          'json',
        ];
      }
    }
    if (verb === 'show') {
      if (kind === 'namespace') return ['servicebus', 'namespace', 'show', '--name', requireField(input, 'name', '--name'), ...resourceGroup, '--output', 'json'];
      if (kind === 'queue') return ['servicebus', 'queue', 'show', '--name', requireField(input, 'name', '--name'), '--namespace-name', requireField(input, 'namespace', '--namespace'), ...resourceGroup, '--output', 'json'];
      if (kind === 'topic') return ['servicebus', 'topic', 'show', '--name', requireField(input, 'name', '--name'), '--namespace-name', requireField(input, 'namespace', '--namespace'), ...resourceGroup, '--output', 'json'];
      if (kind === 'subscription') {
        return [
          'servicebus',
          'topic',
          'subscription',
          'show',
          '--name',
          requireField(input, 'subscriptionName', '--subscription-name'),
          '--namespace-name',
          requireField(input, 'namespace', '--namespace'),
          '--topic-name',
          requireField(input, 'topicName', '--topic-name'),
          ...resourceGroup,
          '--output',
          'json',
        ];
      }
    }
  }
  if (domain === 'eventgrid') {
    const kind = String(input.kind || 'topic');
    if (verb === 'list') {
      if (kind === 'topic') return ['eventgrid', 'topic', 'list', ...resourceGroup, '--output', 'json'];
      if (kind === 'system-topic') return ['eventgrid', 'system-topic', 'list', ...resourceGroup, '--output', 'json'];
      if (kind === 'event-subscription') {
        return [
          'eventgrid',
          'event-subscription',
          'list',
          '--source-resource-id',
          requireField(input, 'sourceResourceId', '--source-resource-id'),
          '--output',
          'json',
        ];
      }
    }
    if (verb === 'show') {
      if (kind === 'topic') return ['eventgrid', 'topic', 'show', '--name', requireField(input, 'name', '--name'), ...resourceGroup, '--output', 'json'];
      if (kind === 'system-topic') return ['eventgrid', 'system-topic', 'show', '--name', requireField(input, 'name', '--name'), ...resourceGroup, '--output', 'json'];
      if (kind === 'event-subscription') {
        return [
          'eventgrid',
          'event-subscription',
          'show',
          '--name',
          requireField(input, 'name', '--name'),
          '--source-resource-id',
          requireField(input, 'sourceResourceId', '--source-resource-id'),
          '--output',
          'json',
        ];
      }
    }
  }
  if (domain === 'sql') {
    const kind = String(input.kind || 'server');
    if (verb === 'list') {
      if (kind === 'server') return ['sql', 'server', 'list', ...resourceGroup, '--output', 'json'];
      if (kind === 'database') return ['sql', 'db', 'list', '--server', requireField(input, 'server', '--server'), ...resourceGroup, '--output', 'json'];
      if (kind === 'firewall-rule') {
        return [
          'sql',
          'server',
          'firewall-rule',
          'list',
          '--server',
          requireField(input, 'server', '--server'),
          ...resourceGroup,
          '--output',
          'json',
        ];
      }
    }
    if (verb === 'show') {
      if (kind === 'server') return ['sql', 'server', 'show', '--name', requireField(input, 'name', '--name'), ...resourceGroup, '--output', 'json'];
      if (kind === 'database') {
        return ['sql', 'db', 'show', '--name', requireField(input, 'name', '--name'), '--server', requireField(input, 'server', '--server'), ...resourceGroup, '--output', 'json'];
      }
      if (kind === 'firewall-rule') {
        return [
          'sql',
          'server',
          'firewall-rule',
          'show',
          '--name',
          requireField(input, 'name', '--name'),
          '--server',
          requireField(input, 'server', '--server'),
          ...resourceGroup,
          '--output',
          'json',
        ];
      }
    }
  }
  throw new Error(`Combinação ${domain}/${verb} ainda não suportada.`);
}

function buildMutationPlan(domain, input) {
  const kind = String(input.kind || '').toLowerCase();
  const resourceGroup = requireField(input, 'resourceGroup', '--resource-group');
  const location = input.location ? String(input.location) : null;
  const operation = {
    operation_id: makeOperationId(domain),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    domain,
    phase: 'planned',
    kind,
    action: 'create',
    mutate: true,
    approval_policy: 'require_approval_if_external_side_effect',
    checkpoint_id: makeCheckpointId(),
    resource_group: resourceGroup,
    location,
    resource_refs: [],
    evidence_outputs: [],
    blocked: false,
    blocked_reason: null,
    summary: '',
    command_args: [],
    command_display: '',
    command_display_redacted: '',
    metadata: {},
  };
  if (domain === 'servicebus') {
    const namespace = input.namespace ? String(input.namespace) : null;
    if (kind === 'namespace') {
      const name = requireField(input, 'name', '--name');
      operation.command_args = ['servicebus', 'namespace', 'create', '--name', name, '--resource-group', resourceGroup];
      if (location) operation.command_args.push('--location', location);
      operation.summary = `Criar namespace Service Bus ${name}`;
      operation.resource_refs.push({ kind: 'namespace', name, resourceGroup });
    } else if (kind === 'queue') {
      const name = requireField(input, 'name', '--name');
      operation.command_args = ['servicebus', 'queue', 'create', '--name', name, '--namespace-name', requireField(input, 'namespace', '--namespace'), '--resource-group', resourceGroup];
      operation.summary = `Criar queue Service Bus ${name} no namespace ${namespace}`;
      operation.resource_refs.push({ kind: 'queue', name, namespace, resourceGroup });
    } else if (kind === 'topic') {
      const name = requireField(input, 'name', '--name');
      operation.command_args = ['servicebus', 'topic', 'create', '--name', name, '--namespace-name', requireField(input, 'namespace', '--namespace'), '--resource-group', resourceGroup];
      operation.summary = `Criar topic Service Bus ${name} no namespace ${namespace}`;
      operation.resource_refs.push({ kind: 'topic', name, namespace, resourceGroup });
    } else if (kind === 'subscription') {
      const name = requireField(input, 'subscriptionName', '--subscription-name');
      const topicName = requireField(input, 'topicName', '--topic-name');
      operation.command_args = ['servicebus', 'topic', 'subscription', 'create', '--name', name, '--namespace-name', requireField(input, 'namespace', '--namespace'), '--topic-name', topicName, '--resource-group', resourceGroup];
      operation.summary = `Criar subscription ${name} no topic ${topicName}`;
      operation.resource_refs.push({ kind: 'subscription', name, namespace, topicName, resourceGroup });
    } else {
      throw new Error('Service Bus suporta kind namespace | queue | topic | subscription.');
    }
  } else if (domain === 'eventgrid') {
    if (kind === 'topic') {
      const name = requireField(input, 'name', '--name');
      operation.command_args = ['eventgrid', 'topic', 'create', '--name', name, '--resource-group', resourceGroup, '--location', location || 'eastus'];
      operation.summary = `Criar topic Event Grid ${name}`;
      operation.resource_refs.push({ kind: 'topic', name, resourceGroup });
    } else if (kind === 'event-subscription') {
      const name = requireField(input, 'name', '--name');
      const sourceResourceId = requireField(input, 'sourceResourceId', '--source-resource-id');
      const endpoint = requireField(input, 'endpoint', '--endpoint');
      operation.command_args = ['eventgrid', 'event-subscription', 'create', '--name', name, '--source-resource-id', sourceResourceId, '--endpoint', endpoint];
      operation.summary = `Criar event subscription ${name}`;
      operation.resource_refs.push({ kind: 'event-subscription', name, sourceResourceId });
      operation.metadata.endpoint = endpoint;
    } else {
      throw new Error('Event Grid suporta kind topic | event-subscription para mutação na v1.');
    }
  } else if (domain === 'sql') {
    if (kind === 'server') {
      const name = requireField(input, 'name', '--name');
      const adminUser = requireField(input, 'adminUser', '--admin-user');
      const passwordEnv = requireField(input, 'adminPasswordEnv', '--admin-password-env');
      const passwordValue = process.env[passwordEnv] || (input.env && input.env[passwordEnv]) || null;
      if (!passwordValue) {
        throw new Error(`A variável de ambiente ${passwordEnv} não está definida.`);
      }
      operation.command_args = ['sql', 'server', 'create', '--name', name, '--resource-group', resourceGroup, '--location', location || 'eastus', '--admin-user', adminUser, '--admin-password', passwordValue];
      operation.summary = `Criar Azure SQL server ${name}`;
      operation.resource_refs.push({ kind: 'server', name, resourceGroup });
      operation.metadata.admin_user = adminUser;
      operation.metadata.admin_password_env = passwordEnv;
      operation.command_display_redacted = `az sql server create --name ${name} --resource-group ${resourceGroup} --location ${location || 'eastus'} --admin-user ${adminUser} --admin-password \${${passwordEnv}}`;
    } else if (kind === 'database') {
      const name = requireField(input, 'name', '--name');
      const server = requireField(input, 'server', '--server');
      const serviceObjective = input.serviceObjective ? String(input.serviceObjective) : 'S0';
      operation.command_args = ['sql', 'db', 'create', '--name', name, '--resource-group', resourceGroup, '--server', server, '--service-objective', serviceObjective];
      operation.summary = `Criar Azure SQL database ${name} no server ${server}`;
      operation.resource_refs.push({ kind: 'database', name, server, resourceGroup });
      operation.metadata.service_objective = serviceObjective;
    } else if (kind === 'firewall-rule') {
      const name = requireField(input, 'name', '--name');
      const server = requireField(input, 'server', '--server');
      const startIp = requireField(input, 'startIpAddress', '--start-ip-address');
      const endIp = requireField(input, 'endIpAddress', '--end-ip-address');
      operation.command_args = ['sql', 'server', 'firewall-rule', 'create', '--name', name, '--resource-group', resourceGroup, '--server', server, '--start-ip-address', startIp, '--end-ip-address', endIp];
      operation.summary = `Criar firewall rule ${name} no Azure SQL server ${server}`;
      operation.resource_refs.push({ kind: 'firewall-rule', name, server, resourceGroup });
      operation.metadata.start_ip_address = startIp;
      operation.metadata.end_ip_address = endIp;
      if (ipRangeTooWide(startIp, endIp)) {
        operation.approval_policy = 'deny_unless_overridden';
        operation.blocked = true;
        operation.blocked_reason = 'Faixa de firewall ampla bloqueada por política.';
      }
    } else {
      throw new Error('Azure SQL suporta kind server | database | firewall-rule.');
    }
  } else {
    throw new Error(`Domínio Azure desconhecido: ${domain}`);
  }
  if (!operation.command_display_redacted) {
    operation.command_display_redacted = `az ${operation.command_args.join(' ')}`;
  }
  operation.command_display = operation.command_display_redacted;
  operation.evidence_outputs = [
    `.oxe/cloud/azure/operations/${operation.operation_id}.json`,
    `.oxe/cloud/azure/operations/${operation.operation_id}.md`,
  ];
  return operation;
}

function renderAzureOperationMarkdown(operation) {
  return [
    `# OXE — Azure Operation ${operation.operation_id}`,
    '',
    `- **Domínio:** ${operation.domain}`,
    `- **Kind:** ${operation.kind}`,
    `- **Ação:** ${operation.action}`,
    `- **Fase:** ${operation.phase}`,
    `- **Mutação:** ${operation.mutate ? 'sim' : 'não'}`,
    `- **Política:** ${operation.approval_policy}`,
    `- **Checkpoint:** ${operation.checkpoint_id || '—'}`,
    `- **Resumo:** ${operation.summary || '—'}`,
    `- **Criado em:** ${operation.created_at}`,
    `- **Atualizado em:** ${operation.updated_at}`,
    '',
    '## Comando',
    '',
    '```bash',
    operation.command_display_redacted || operation.command_display || '',
    '```',
    '',
    '## Recursos alvo',
    '',
    ...(operation.resource_refs || []).map((ref) => `- ${JSON.stringify(ref)}`),
    '',
    '## Evidência',
    '',
    ...(operation.evidence_outputs || []).map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function persistAzureOperation(projectRoot, operation) {
  const p = ensureAzureArtifacts(projectRoot);
  const jsonPath = path.join(p.operationsDir, `${operation.operation_id}.json`);
  const mdPath = path.join(p.operationsDir, `${operation.operation_id}.md`);
  writeJson(jsonPath, redactObject(operation));
  writeText(mdPath, renderAzureOperationMarkdown(redactObject(operation)));
  return { jsonPath, mdPath };
}

function checkpointIndexPath(projectRoot, activeSession) {
  return operational.operationalPaths(projectRoot, activeSession).checkpoints;
}

function readCheckpointIndex(projectRoot, activeSession) {
  return readTextIfExists(checkpointIndexPath(projectRoot, activeSession)) || '';
}

function writeCheckpointIndex(projectRoot, activeSession, rows) {
  const target = checkpointIndexPath(projectRoot, activeSession);
  const lines = [
    '# OXE — Checkpoints',
    '',
    '> Índice de checkpoints formais do ciclo atual. Usado para aprovações humanas e gates sensíveis.',
    '',
    '| ID | Tipo | Fase | Escopo | Estado | Política | Decisão | Override | Criado em | Resolvido em | Notas |',
    '|----|------|------|--------|--------|----------|---------|----------|-----------|--------------|-------|',
    ...rows.map((row) => `| ${row.id} | ${row.type} | ${row.phase} | ${row.scope} | ${row.status} | ${row.policy} | ${row.decision} | ${row.override} | ${row.created_at} | ${row.resolved_at} | ${row.notes} |`),
    '',
  ];
  writeText(target, lines.join('\n'));
}

function upsertCheckpoint(projectRoot, activeSession, checkpoint) {
  const text = readCheckpointIndex(projectRoot, activeSession);
  const rows = [];
  if (text) {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\|\s*(CP-[^|]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/i);
      if (!match) continue;
      rows.push({
        id: match[1].trim(),
        type: match[2].trim(),
        phase: match[3].trim(),
        scope: match[4].trim(),
        status: match[5].trim(),
        policy: match[6].trim(),
        decision: match[7].trim(),
        override: match[8].trim(),
        created_at: match[9].trim(),
        resolved_at: match[10].trim(),
        notes: match[11].trim(),
      });
    }
  }
  const idx = rows.findIndex((row) => row.id === checkpoint.id);
  if (idx === -1) rows.unshift(checkpoint);
  else rows[idx] = checkpoint;
  writeCheckpointIndex(projectRoot, activeSession, rows);
  return checkpoint;
}

function syncRunProviderContext(projectRoot, activeSession, input) {
  const current = operational.readRunState(projectRoot, activeSession);
  const now = new Date().toISOString();
  const providerContext = {
    ...(current && current.provider_context && typeof current.provider_context === 'object' ? current.provider_context : {}),
    azure: {
      ...(((current && current.provider_context) || {}).azure || {}),
      ...(input.provider_context || {}),
    },
  };
  const next = current
    ? operational.writeRunState(projectRoot, activeSession, {
        ...current,
        updated_at: now,
        status: input.status || current.status,
        pending_checkpoints: input.pending_checkpoints || current.pending_checkpoints || [],
        provider_context: providerContext,
        evidence: input.evidence || current.evidence || [],
      })
    : operational.writeRunState(projectRoot, activeSession, {
        run_id: input.run_id || operational.makeRunId(),
        created_at: now,
        updated_at: now,
        status: input.status || 'planned',
        current_wave: null,
        cursor: { wave: null, task: null, mode: 'provider-azure' },
        active_tasks: [],
        pending_checkpoints: input.pending_checkpoints || [],
        evidence: input.evidence || [],
        provider_context: providerContext,
      });
  return next;
}

function attachAzureContextToRun(projectRoot, activeSession, context, operation, status, pendingCheckpoints, evidence) {
  const summary = summarizeInventory((loadAzureInventory(projectRoot) || {}).items || []);
  return syncRunProviderContext(projectRoot, activeSession, {
    status,
    pending_checkpoints: pendingCheckpoints,
    evidence,
    provider_context: {
      enabled: true,
      cloud: context.profile && context.profile.cloud ? context.profile.cloud : 'AzureCloud',
      tenant_id: context.profile && context.profile.tenant_id ? context.profile.tenant_id : null,
      subscription_id: context.profile && context.profile.subscription_id ? context.profile.subscription_id : null,
      auth_mode: context.profile && context.profile.auth_mode ? context.profile.auth_mode : 'unknown',
      inventory_summary: summary,
      last_sync: (loadAzureInventory(projectRoot) || {}).synced_at || null,
      last_operation: operation
        ? {
            operation_id: operation.operation_id,
            domain: operation.domain,
            kind: operation.kind,
            action: operation.action,
            phase: operation.phase,
            summary: operation.summary,
            checkpoint_id: operation.checkpoint_id || null,
            capability_id: `azure-${operation.domain === 'sql' ? 'sql-admin' : operation.domain}`,
            resource_refs: operation.resource_refs || [],
          }
        : null,
    },
  });
}

function planAzureOperation(projectRoot, activeSession, domain, input, options = {}) {
  const context = getAzureContext(projectRoot, options);
  if (!context.cli.installed) throw new Error('Azure CLI não instalada.');
  if (!context.authStatus.login_active) throw new Error('Sessão Azure ausente. Execute "oxe-cc azure auth login".');
  const operation = buildMutationPlan(domain, input);
  operation.phase = 'planned';
  operation.updated_at = new Date().toISOString();
  const files = persistAzureOperation(projectRoot, operation);
  attachAzureContextToRun(projectRoot, activeSession, context, operation, 'planned', [], []);
  operational.appendEvent(projectRoot, activeSession, {
    type: 'azure_operation_planned',
    payload: {
      domain,
      operation_id: operation.operation_id,
      checkpoint_id: operation.checkpoint_id,
      summary: operation.summary,
      files,
    },
  });
  return { context, operation, files };
}

function applyAzureOperation(projectRoot, activeSession, domain, input, options = {}) {
  const context = getAzureContext(projectRoot, options);
  if (!context.cli.installed) throw new Error('Azure CLI não instalada.');
  if (!context.authStatus.login_active) throw new Error('Sessão Azure ausente. Execute "oxe-cc azure auth login".');
  if (options.vpnRequired && !options.vpnConfirmed) {
    throw new Error('Esta operação requer VPN conforme configuração do projeto. Execute com --vpn-confirmed para confirmar a conexão.');
  }
  const operation = buildMutationPlan(domain, input);
  if (options.dryRun) {
    return {
      approved: false,
      dryRun: true,
      operation: { ...operation, phase: 'dry_run' },
      commandPreview: `az ${operation.command_args.join(' ')}`,
      message: '[dry-run] Validação OK. Nenhuma alteração foi feita.',
    };
  }
  if (operation.blocked && !options.overridePolicy) {
    persistAzureOperation(projectRoot, operation);
    throw new Error(operation.blocked_reason || 'Operação Azure bloqueada por política.');
  }
  if (!options.approve) {
    operation.phase = 'waiting_approval';
    operation.updated_at = new Date().toISOString();
    const files = persistAzureOperation(projectRoot, operation);
    upsertCheckpoint(projectRoot, activeSession, {
      id: operation.checkpoint_id,
      type: 'approval',
      phase: 'execution',
      scope: `azure:${domain}:${operation.kind}`,
      status: 'pending_approval',
      policy: operation.approval_policy,
      decision: '—',
      override: '—',
      created_at: operation.created_at.slice(0, 10),
      resolved_at: '—',
      notes: operation.summary,
    });
    attachAzureContextToRun(projectRoot, activeSession, context, operation, 'waiting_approval', [operation.checkpoint_id], []);
    operational.appendEvent(projectRoot, activeSession, {
      type: 'azure_checkpoint_opened',
      payload: {
        domain,
        operation_id: operation.operation_id,
        checkpoint_id: operation.checkpoint_id,
        summary: operation.summary,
        files,
      },
    });
    return {
      approved: false,
      operation,
      files,
      checkpoint_id: operation.checkpoint_id,
      message: 'Mutação Azure planejada. Reexecute com --approve para aplicar.',
    };
  }

  operation.phase = 'running';
  operation.updated_at = new Date().toISOString();
  upsertCheckpoint(projectRoot, activeSession, {
    id: operation.checkpoint_id,
    type: 'approval',
    phase: 'execution',
    scope: `azure:${domain}:${operation.kind}`,
    status: 'approved',
    policy: operation.approval_policy,
    decision: 'approved',
    override: options.overridePolicy ? 'explicit' : '—',
    created_at: operation.created_at.slice(0, 10),
    resolved_at: operation.updated_at.slice(0, 10),
    notes: operation.summary,
  });
  attachAzureContextToRun(projectRoot, activeSession, context, operation, 'running', [], []);
  const result = runAz([...operation.command_args, '--output', 'json'], {
    cwd: projectRoot,
    env: options.env || {},
    runner: options.runner,
  });
  if (result.status !== 0) {
    operation.phase = 'failed';
    operation.updated_at = new Date().toISOString();
    operation.error = (result.stderr || result.stdout || 'Falha ao aplicar operação Azure.').trim();
    const files = persistAzureOperation(projectRoot, operation);
    attachAzureContextToRun(projectRoot, activeSession, context, operation, 'failed', [], []);
    operational.appendEvent(projectRoot, activeSession, {
      type: 'azure_operation_failed',
      payload: {
        domain,
        operation_id: operation.operation_id,
        checkpoint_id: operation.checkpoint_id,
        error: operation.error,
        files,
      },
    });
    throw new Error(operation.error);
  }
  operation.phase = 'applied';
  operation.updated_at = new Date().toISOString();
  operation.result = redactObject(parseJsonOutput(result.stdout, {}));
  const files = persistAzureOperation(projectRoot, operation);
  attachAzureContextToRun(projectRoot, activeSession, context, operation, 'completed', [], [files.mdPath]);
  operational.appendEvent(projectRoot, activeSession, {
    type: 'azure_operation_applied',
    payload: {
      domain,
      operation_id: operation.operation_id,
      checkpoint_id: operation.checkpoint_id,
      files,
      resources: operation.resource_refs,
    },
  });
  return { approved: true, operation, files, result: operation.result };
}

function executeAzureRead(projectRoot, activeSession, domain, verb, input, options = {}) {
  const context = getAzureContext(projectRoot, options);
  if (!context.cli.installed) throw new Error('Azure CLI não instalada.');
  if (!context.authStatus.login_active) throw new Error('Sessão Azure ausente. Execute "oxe-cc azure auth login".');
  const args = buildReadCommand(domain, verb, input);
  const result = runAz(args, { cwd: projectRoot, ...options });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Falha ao consultar recurso Azure.').trim());
  }
  const parsed = parseJsonOutput(result.stdout, []);
  attachAzureContextToRun(projectRoot, activeSession, context, null, 'completed', [], []);
  operational.appendEvent(projectRoot, activeSession, {
    type: 'azure_resource_found',
    payload: {
      domain,
      verb,
      kind: input.kind || null,
      query: redactObject(input),
    },
  });
  return parsed;
}

function loginAzure(projectRoot, options = {}) {
  const cli = detectAzureCli(projectRoot, options);
  if (!cli.installed) throw new Error('Azure CLI não instalada.');
  operational.appendEvent(projectRoot, null, { type: 'azure_login_started' });
  const azArgs = ['login', '--output', 'json'];
  if (options.tenant) azArgs.push('--tenant', String(options.tenant));
  const login = runAz(azArgs, { cwd: projectRoot, inherit: Boolean(options.inherit), ...options });
  if (login.status !== 0) {
    throw new Error((login.stderr || login.stdout || 'Falha no az login.').trim());
  }
  operational.appendEvent(projectRoot, null, { type: 'azure_login_succeeded' });
  // getAzureContext must capture output — strip inherit so it pipes stdout
  const { inherit: _inherit, ...getCtxOptions } = options;
  return getAzureContext(projectRoot, getCtxOptions);
}

function setAzureSubscription(projectRoot, subscription, options = {}) {
  if (!subscription) throw new Error('Informe a subscription.');
  const cli = detectAzureCli(projectRoot, options);
  if (!cli.installed) throw new Error('Azure CLI não instalada.');
  const set = runAz(['account', 'set', '--subscription', String(subscription)], { cwd: projectRoot, ...options });
  if (set.status !== 0) {
    throw new Error((set.stderr || set.stdout || 'Falha ao selecionar subscription.').trim());
  }
  const context = getAzureContext(projectRoot, options);
  operational.appendEvent(projectRoot, null, {
    type: 'azure_subscription_selected',
    payload: {
      subscription: context.profile.subscription_id,
      subscription_name: context.profile.subscription_name,
    },
  });
  return context;
}

function azureDoctor(projectRoot, config = {}, options = {}) {
  const p = options.write === false ? azurePaths(projectRoot) : ensureAzureArtifacts(projectRoot);
  const context = getAzureContext(projectRoot, options);
  const inventory = loadAzureInventory(projectRoot);
  const capsRoot = path.join(projectRoot, '.oxe', 'capabilities');
  const missingCapabilities = AZURE_CAPABILITY_IDS.filter((id) => !fs.existsSync(path.join(capsRoot, id, 'CAPABILITY.md')));
  const warnings = [];
  if (!context.cli.installed) warnings.push('Azure CLI não instalada.');
  else if (!context.cli.okVersion) warnings.push(`Azure CLI ${context.cli.version || 'desconhecida'} abaixo do mínimo suportado.`);
  if (context.cli.installed && !context.authStatus.login_active) warnings.push('Sessão Azure ausente.');
  if (context.authStatus.login_active && !context.profile.subscription_id) warnings.push('Subscription Azure não selecionada.');
  if (!context.authStatus.resource_graph_enabled) warnings.push('Extensão resource-graph ausente ou não habilitada.');
  if (!inventory) warnings.push('Inventário Azure ausente. Execute "oxe-cc azure sync".');
  if (inventory && config && typeof config.azure === 'object') {
    const maxAgeHours = Number(config.azure.inventory_max_age_hours || 24);
    const syncedAt = Date.parse(String(inventory.synced_at || ''));
    if (!Number.isNaN(syncedAt) && maxAgeHours > 0) {
      const ageHours = Math.floor((Date.now() - syncedAt) / (1000 * 60 * 60));
      if (ageHours > maxAgeHours) warnings.push(`Inventário Azure stale (${ageHours}h > ${maxAgeHours}h).`);
    }
  }
  if (missingCapabilities.length) warnings.push(`Capabilities Azure ausentes: ${missingCapabilities.join(', ')}`);
  const operations = listAzureOperations(projectRoot);
  const pendingOperation = operations.find((operation) => operation.phase === 'waiting_approval');
  if (pendingOperation) warnings.push(`Operação Azure pendente sem apply final: ${pendingOperation.operation_id}`);
  const authStatus = {
    ...(context.authStatus || {}),
    checked_at: new Date().toISOString(),
    warnings,
  };
  if (options.write !== false) {
    writeAzureAuthArtifacts(projectRoot, { profile: context.profile || DEFAULT_AZURE_PROFILE, authStatus });
  }
  return {
    healthy: warnings.length === 0,
    warnings,
    profile: context.profile,
    authStatus,
    inventory,
    inventorySummary: inventory && inventory.summary ? inventory.summary : summarizeInventory([]),
    paths: p,
  };
}

module.exports = {
  MIN_AZURE_CLI_MAJOR,
  AZURE_CAPABILITY_IDS,
  RESOURCE_GRAPH_QUERY,
  DEFAULT_AZURE_PROFILE,
  azurePaths,
  ensureAzureArtifacts,
  isAzureContextEnabled,
  detectAzureCli,
  loadAzureProfile,
  loadAzureAuthStatus,
  loadAzureInventory,
  listAzureOperations,
  summarizeInventory,
  normalizeInventoryItem,
  searchAzureInventory,
  diffInventory,
  statusAzure,
  ensureAzureCapabilities,
  getAzureContext,
  loginAzure,
  setAzureSubscription,
  ensureResourceGraphExtension,
  syncAzureInventory,
  executeAzureRead,
  planAzureOperation,
  applyAzureOperation,
  azureDoctor,
  redactObject,
  runAz,
};
