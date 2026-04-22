'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const oxeManifest = require('./oxe-manifest.cjs');

const REQUIRED_RUNTIMES = [
  'cursor',
  'copilot_vscode',
  'claude_code',
  'codex',
  'opencode',
  'gemini',
  'windsurf',
  'antigravity',
];

const WRAPPER_TARGETS = [
  {
    key: '.github/prompts',
    dir: '.github/prompts',
    filter: (name) => (name === 'oxe.prompt.md' || name.startsWith('oxe-')) && name.endsWith('.prompt.md'),
  },
  {
    key: 'commands/oxe',
    dir: 'commands/oxe',
    filter: (name) => name.endsWith('.md'),
  },
  {
    key: '.cursor/commands',
    dir: '.cursor/commands',
    filter: (name) => (name === 'oxe.md' || name.startsWith('oxe-')) && name.endsWith('.md'),
  },
];

function releasePaths(projectRoot) {
  const releaseDir = path.join(projectRoot, '.oxe', 'release');
  return {
    releaseDir,
    manifest: path.join(releaseDir, 'release-manifest.json'),
    smokeReport: path.join(releaseDir, 'runtime-smoke-report.json'),
    recoveryFixtureReport: path.join(releaseDir, 'recovery-fixture-report.json'),
    multiAgentSoakReport: path.join(releaseDir, 'multi-agent-soak-report.json'),
  };
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readPackageVersion(filePath) {
  const json = readJsonIfExists(filePath);
  if (!json || typeof json.version !== 'string') return null;
  return json.version.trim();
}

function readReadmeVersion(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) return null;
  const match = text.match(/\*\*Versão:\*\*\s*`([^`]+)`/i);
  return match ? match[1].trim() : null;
}

function parseChangelogTop(filePath) {
  const text = readTextIfExists(filePath);
  if (!text) {
    return {
      path: filePath,
      version: null,
      date: null,
      headerLine: null,
      hasHighlights: false,
      highlights: [],
      ok: false,
    };
  }
  const match = text.match(/^## \[([^\]]+)\]\s+—\s+(\d{4}-\d{2}-\d{2})\s*$/m);
  if (!match) {
    return {
      path: filePath,
      version: null,
      date: null,
      headerLine: null,
      hasHighlights: false,
      highlights: [],
      ok: false,
    };
  }
  const headerLine = match[0];
  const start = match.index + headerLine.length;
  const nextHeader = text.slice(start).match(/\n## \[/);
  const section = nextHeader ? text.slice(start, start + nextHeader.index) : text.slice(start);
  const highlights = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S+/.test(line));
  return {
    path: filePath,
    version: match[1].trim(),
    date: match[2].trim(),
    headerLine,
    hasHighlights: highlights.length > 0,
    highlights,
    ok: true,
  };
}

function parseBannerVersion(filePath, fallbackVersion) {
  const text = readTextIfExists(filePath);
  if (!text) return { version: null, mode: 'missing' };
  if (text.includes('v{version}')) return { version: fallbackVersion || null, mode: 'placeholder' };
  const match = text.match(/v(\d+\.\d+\.\d+)/);
  return { version: match ? match[1] : null, mode: match ? 'fixed' : 'unknown' };
}

function hashObject(value) {
  const json = JSON.stringify(value, null, 2);
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oxe-release-hash-'));
  const tempFile = path.join(tempDir, 'payload.json');
  fs.writeFileSync(tempFile, json, 'utf8');
  const hash = oxeManifest.sha256File(tempFile);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return hash;
}

function collectWrapperHashes(projectRoot) {
  const wrappers = {};
  for (const target of WRAPPER_TARGETS) {
    const dir = path.join(projectRoot, target.dir);
    if (!fs.existsSync(dir)) {
      wrappers[target.key] = {
        dir: target.dir,
        missing: true,
        fileCount: 0,
        aggregateHash: null,
        files: [],
      };
      continue;
    }
    const files = fs.readdirSync(dir)
      .filter((name) => target.filter(name))
      .sort()
      .map((name) => {
        const filePath = path.join(dir, name);
        return {
          path: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
          hash: oxeManifest.sha256File(filePath),
        };
      });
    wrappers[target.key] = {
      dir: target.dir,
      missing: false,
      fileCount: files.length,
      aggregateHash: hashObject(files),
      files,
    };
  }
  return wrappers;
}

function diffWrapperHashes(before, after) {
  const mismatches = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const a = before[key] || null;
    const b = after[key] || null;
    if (!a || !b || a.aggregateHash !== b.aggregateHash || a.fileCount !== b.fileCount) {
      mismatches.push({
        target: key,
        before: a,
        after: b,
      });
    }
  }
  return mismatches;
}

function runSyncScript(packageRoot, scriptName, projectRoot) {
  const scriptPath = path.join(packageRoot, 'scripts', scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      OXE_SYNC_REPO_ROOT: projectRoot,
      OXE_NO_BANNER: '1',
    },
  });
  return {
    script: scriptName,
    status: result.status,
    ok: result.status === 0,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function syncWrappers(projectRoot, packageRoot) {
  const before = collectWrapperHashes(projectRoot);
  const syncRuntime = runSyncScript(packageRoot, 'sync-runtime-metadata.cjs', projectRoot);
  const syncCursor = runSyncScript(packageRoot, 'sync-cursor-from-prompts.cjs', projectRoot);
  const after = collectWrapperHashes(projectRoot);
  const mismatches = diffWrapperHashes(before, after);
  return {
    before,
    after,
    scripts: [syncRuntime, syncCursor],
    mismatches,
    ok: syncRuntime.ok && syncCursor.ok && mismatches.length === 0,
  };
}

function readReportSummary(reportPath, requiredItems, extractOk) {
  const data = readJsonIfExists(reportPath);
  if (!data || !Array.isArray(data.results)) {
    return {
      path: reportPath,
      present: false,
      ok: false,
      total: 0,
      failures: ['report_missing'],
      missingRequired: Array.isArray(requiredItems) ? requiredItems.slice() : [],
      results: [],
      raw: data,
    };
  }
  const results = data.results;
  const failures = results.filter((item) => !extractOk(item)).map((item) => item.runtime || item.fixture || item.scenario || item.name || 'unknown');
  const missingRequired = Array.isArray(requiredItems)
    ? requiredItems.filter((name) => !results.some((item) => (item.runtime || item.fixture || item.scenario || item.name) === name))
    : [];
  return {
    path: reportPath,
    present: true,
    ok: failures.length === 0 && missingRequired.length === 0,
    total: results.length,
    failures,
    missingRequired,
    results,
    raw: data,
  };
}

function loadRuntimeSmokeReport(projectRoot) {
  return readReportSummary(releasePaths(projectRoot).smokeReport, REQUIRED_RUNTIMES, (item) => {
    return Boolean(
      item
      && item.install_ok
      && item.oxe_present
      && item.workflow_resolution_ok
      && item.wrapper_drift_ok !== false
      && item.uninstall_ok
    );
  });
}

function loadRecoveryFixtureReport(projectRoot) {
  return readReportSummary(releasePaths(projectRoot).recoveryFixtureReport, null, (item) => Boolean(item && item.ok));
}

function loadMultiAgentSoakReport(projectRoot) {
  return readReportSummary(releasePaths(projectRoot).multiAgentSoakReport, null, (item) => Boolean(item && item.ok));
}

function readVersionSnapshot(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const runtimePackagePath = path.join(projectRoot, 'packages', 'runtime', 'package.json');
  const vscodePackagePath = path.join(projectRoot, 'vscode-extension', 'package.json');
  const readmePath = path.join(projectRoot, 'README.md');
  const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
  const bannerPath = path.join(projectRoot, 'bin', 'banner.txt');
  const rootVersion = readPackageVersion(packageJsonPath);
  const changelog = parseChangelogTop(changelogPath);
  return {
    rootPackage: { path: packageJsonPath, version: rootVersion },
    runtimePackage: { path: runtimePackagePath, version: readPackageVersion(runtimePackagePath) },
    vscodeExtension: { path: vscodePackagePath, version: readPackageVersion(vscodePackagePath) },
    readme: { path: readmePath, version: readReadmeVersion(readmePath) },
    changelog,
    banner: { path: bannerPath, ...parseBannerVersion(bannerPath, rootVersion) },
  };
}

function buildReleaseManifest(projectRoot, options = {}) {
  const packageRoot = path.resolve(options.packageRoot || projectRoot);
  const paths = releasePaths(projectRoot);
  const versions = readVersionSnapshot(projectRoot);
  const runtimeEntry = path.join(packageRoot, 'lib', 'runtime', 'index.js');
  const wrapperSync = options.skipWrapperSync ? {
    before: collectWrapperHashes(projectRoot),
    after: collectWrapperHashes(projectRoot),
    scripts: [],
    mismatches: [],
    ok: true,
  } : syncWrappers(projectRoot, packageRoot);
  const smoke = loadRuntimeSmokeReport(projectRoot);
  const recovery = loadRecoveryFixtureReport(projectRoot);
  const multiAgent = loadMultiAgentSoakReport(projectRoot);
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_root: projectRoot,
    package_root: packageRoot,
    release_contract: {
      execute_verify: 'runtime-first',
      promotion_target: 'pr_draft',
      multi_agent_backend: 'git_worktree',
      branch_push: 'advanced_only',
    },
    versions,
    runtime_compiled: {
      path: runtimeEntry,
      ok: fs.existsSync(runtimeEntry),
    },
    wrappers: {
      hash_before_sync: wrapperSync.before,
      hash_after_sync: wrapperSync.after,
      sync: {
        ok: wrapperSync.ok,
        mismatches: wrapperSync.mismatches,
        scripts: wrapperSync.scripts,
      },
    },
    reports: {
      runtime_smoke: smoke,
      recovery_fixtures: recovery,
      multi_agent_soak: multiAgent,
    },
  };
  if (options.writeManifest) {
    ensureDirForFile(paths.manifest);
    fs.writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  return manifest;
}

function checkReleaseConsistency(projectRoot, options = {}) {
  const manifest = buildReleaseManifest(projectRoot, options);
  const blockers = [];
  const warnings = [];
  const versions = manifest.versions;
  const canonicalVersion = versions.rootPackage.version;
  const compareTargets = [
    ['packages/runtime/package.json', versions.runtimePackage.version],
    ['vscode-extension/package.json', versions.vscodeExtension.version],
    ['README.md', versions.readme.version],
    ['CHANGELOG.md', versions.changelog.version],
    ['bin/banner.txt', versions.banner.version],
  ];
  for (const [label, version] of compareTargets) {
    if (!version || version !== canonicalVersion) {
      blockers.push(`${label} diverge da versão raiz (${canonicalVersion || 'ausente'})`);
    }
  }
  if (!versions.changelog.ok) {
    blockers.push('CHANGELOG.md sem cabeçalho de versão no topo');
  } else {
    if (!versions.changelog.date) blockers.push('CHANGELOG.md topo sem data');
    if (!versions.changelog.hasHighlights) blockers.push('CHANGELOG.md topo sem highlights');
  }
  if (!manifest.runtime_compiled.ok) {
    blockers.push('runtime não compilado (lib/runtime/index.js ausente)');
  }
  if (!manifest.wrappers.sync.ok) {
    if (manifest.wrappers.sync.scripts.some((entry) => !entry.ok)) {
      blockers.push('sync de wrappers falhou');
    }
    if (manifest.wrappers.sync.mismatches.length > 0) {
      blockers.push('wrappers ficam dirty após sync-runtime-metadata/sync:cursor');
    }
  }
  if (!manifest.reports.runtime_smoke.present || !manifest.reports.runtime_smoke.ok) {
    blockers.push('runtime smoke matrix incompleta ou com falhas');
  }
  if (!manifest.reports.recovery_fixtures.present || !manifest.reports.recovery_fixtures.ok) {
    blockers.push('recovery fixture report incompleto ou com falhas');
  }
  if (!manifest.reports.multi_agent_soak.present || !manifest.reports.multi_agent_soak.ok) {
    blockers.push('multi-agent soak report incompleto ou com falhas');
  }
  if (versions.banner.mode === 'unknown') {
    warnings.push('banner.txt sem placeholder v{version} nem versão fixa detectável');
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    manifest,
    manifestPath: releasePaths(projectRoot).manifest,
  };
}

module.exports = {
  REQUIRED_RUNTIMES,
  WRAPPER_TARGETS,
  releasePaths,
  collectWrapperHashes,
  loadRuntimeSmokeReport,
  loadRecoveryFixtureReport,
  loadMultiAgentSoakReport,
  buildReleaseManifest,
  checkReleaseConsistency,
};
