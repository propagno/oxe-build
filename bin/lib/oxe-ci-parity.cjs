'use strict';

/**
 * 1.23.0 (OXB-230-02): Local pre-push CI parity verifier (`oxe-cc doctor --ci-parity`).
 * Checks:
 *  1. Clean-checkout `doctor` (exports committed HEAD without gitignored local files)
 *  2. `engines.node` parity across root package.json, sub-packages, and script templates
 *  3. POSIX symlink / `.gitignore` hygiene (no backslash rules, no tracked symlink shadowed by trailing-slash dir rule)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const oxeHealth = require('./oxe-project-health.cjs');

function parseMinNodeMajor(range) {
  if (!range || typeof range !== 'string') return null;
  const m = range.match(/>=?\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function checkCleanCheckoutDoctor(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const spawn = options.spawn || spawnSync;
  const hasGit = fs.existsSync(path.join(rootAbs, '.git'));
  if (!hasGit) {
    const report = oxeHealth.buildHealthReport(rootAbs);
    const ok = report.healthStatus !== 'broken' && !report.configParseError;
    return {
      ok,
      mode: 'direct',
      workspaceMode: report.workspaceMode,
      healthStatus: report.healthStatus,
      problems: ok ? [] : [`doctor em modo direto reportou ${report.healthStatus}`],
      warnings: ['diretório sem .git — verificação de clean checkout rodada diretamente no workspace'],
    };
  }

  const headCheck = spawn('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: rootAbs,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (headCheck.status !== 0) {
    return {
      ok: true,
      mode: 'no_head',
      workspaceMode: null,
      healthStatus: 'unknown',
      problems: [],
      warnings: ['repositório sem commit HEAD ainda — clean-checkout doctor pulado'],
    };
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ci-parity-'));
  const checkoutDir = path.join(tmpRoot, 'repo');
  const tmpIndex = path.join(tmpRoot, 'tmp-index');
  try {
    fs.mkdirSync(checkoutDir, { recursive: true });
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    const rt = spawn('git', ['read-tree', 'HEAD'], { cwd: rootAbs, env, encoding: 'utf8', windowsHide: true });
    if (rt.status !== 0) {
      return {
        ok: false,
        mode: 'clean_checkout',
        workspaceMode: null,
        healthStatus: 'error',
        problems: [`git read-tree HEAD falhou: ${String(rt.stderr || rt.stdout || '').trim()}`],
        warnings: [],
      };
    }
    const prefix = `${checkoutDir.replace(/\\/g, '/')}/`;
    const co = spawn('git', ['checkout-index', '-a', '-f', `--prefix=${prefix}`], {
      cwd: rootAbs,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (co.status !== 0) {
      return {
        ok: false,
        mode: 'clean_checkout',
        workspaceMode: null,
        healthStatus: 'error',
        problems: [`git checkout-index falhou: ${String(co.stderr || co.stdout || '').trim()}`],
        warnings: [],
      };
    }

    const report = oxeHealth.buildHealthReport(checkoutDir);
    const problems = [];
    if (report.configParseError) {
      problems.push(`configParseError em checkout limpo: ${report.configParseError}`);
    }
    if (report.healthStatus === 'broken') {
      const reasons = [...(report.sessionWarn || []), ...(report.phaseWarn || [])].slice(0, 5);
      problems.push(`doctor em checkout limpo reportou broken${reasons.length ? `: ${reasons.join(' | ')}` : ''}`);
    }
    return {
      ok: problems.length === 0,
      mode: 'clean_checkout',
      workspaceMode: report.workspaceMode,
      healthStatus: report.healthStatus,
      sessionWarn: report.sessionWarn || [],
      problems,
      warnings: [],
    };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function checkEnginesParity(projectRoot) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const rootPkgPath = path.join(rootAbs, 'package.json');
  if (!fs.existsSync(rootPkgPath)) {
    return {
      ok: true,
      root_engines_node: null,
      root_min_major: null,
      scanned: [],
      mismatches: [],
      problems: [],
      warnings: ['sem package.json na raiz'],
    };
  }

  let rootPkg = {};
  try {
    rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      root_engines_node: null,
      root_min_major: null,
      scanned: ['package.json'],
      mismatches: [],
      problems: [`package.json inválido: ${err.message}`],
      warnings: [],
    };
  }

  const rootEnginesNode = (rootPkg.engines && rootPkg.engines.node) || null;
  const rootMinMajor = parseMinNodeMajor(rootEnginesNode);
  const scanned = ['package.json'];
  const mismatches = [];
  const problems = [];

  if (rootMinMajor == null) {
    return {
      ok: true,
      root_engines_node: rootEnginesNode,
      root_min_major: null,
      scanned,
      mismatches,
      problems,
      warnings: [],
    };
  }

  // 1. Check workspace / sub-package package.json files (packages/*, vscode-extension)
  const subPkgPaths = [path.join(rootAbs, 'vscode-extension', 'package.json')];
  const packagesDir = path.join(rootAbs, 'packages');
  if (fs.existsSync(packagesDir)) {
    try {
      for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          subPkgPaths.push(path.join(packagesDir, entry.name, 'package.json'));
        }
      }
    } catch { /* ignore */ }
  }

  for (const sp of subPkgPaths) {
    if (!fs.existsSync(sp)) continue;
    const rel = path.relative(rootAbs, sp).replace(/\\/g, '/');
    scanned.push(rel);
    try {
      const parsed = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const eng = parsed && parsed.engines && parsed.engines.node;
      const minMaj = parseMinNodeMajor(eng);
      if (minMaj != null && minMaj > rootMinMajor) {
        const msg = `engines.node incompatível em ${rel}: declara "${eng}" (> raiz "${rootEnginesNode}")`;
        mismatches.push({ file: rel, declared: eng, declared_major: minMaj, root_major: rootMinMajor });
        problems.push(msg);
      }
    } catch { /* ignore */ }
  }

  // 2. Check scripts/*.cjs and scripts/*.js templates embedding `engines: { node: '>=NN' }`
  const scriptsDir = path.join(rootAbs, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    try {
      for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:c?js|mjs)$/.test(entry.name)) continue;
        const full = path.join(scriptsDir, entry.name);
        const rel = path.relative(rootAbs, full).replace(/\\/g, '/');
        scanned.push(rel);
        const src = fs.readFileSync(full, 'utf8');
        const re = /engines\s*:\s*\{\s*['"]?node['"]?\s*:\s*['"]([^'"]+)['"]\s*\}/g;
        let match;
        while ((match = re.exec(src)) !== null) {
          const eng = match[1];
          const minMaj = parseMinNodeMajor(eng);
          if (minMaj != null && minMaj > rootMinMajor) {
            const msg = `engines.node drift em template ${rel}: declara "${eng}" enquanto package.json raiz suporta "${rootEnginesNode}"`;
            mismatches.push({ file: rel, declared: eng, declared_major: minMaj, root_major: rootMinMajor });
            problems.push(msg);
          }
        }
      }
    } catch { /* ignore */ }
  }

  return {
    ok: problems.length === 0,
    root_engines_node: rootEnginesNode,
    root_min_major: rootMinMajor,
    scanned,
    mismatches,
    problems,
    warnings: [],
  };
}

function checkPosixSymlinkGitignore(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const spawn = options.spawn || spawnSync;
  const giPath = path.join(rootAbs, '.gitignore');
  const problems = [];
  const warnings = [];
  const backslashRules = [];
  const trackedSymlinks = [];

  let rules = [];
  if (fs.existsSync(giPath)) {
    const rawLines = fs.readFileSync(giPath, 'utf8').split(/\r?\n/);
    for (let idx = 0; idx < rawLines.length; idx += 1) {
      const line = rawLines[idx].trim();
      if (!line || line.startsWith('#')) continue;
      // Unescaped backslash used as path separator breaks POSIX gitignore
      if (/[A-Za-z0-9_.-]\\[A-Za-z0-9_.-]/.test(line)) {
        backslashRules.push({ line: idx + 1, rule: line });
        problems.push(`.gitignore:${idx + 1} usa separador "\\" ("${line}") — inválido em POSIX`);
      }
      rules.push(line);
    }
  }

  if (fs.existsSync(path.join(rootAbs, '.git'))) {
    const ls = spawn('git', ['ls-files', '-s'], { cwd: rootAbs, encoding: 'utf8', windowsHide: true });
    if (ls.status === 0 && ls.stdout) {
      const dirOnlyRules = new Set(
        rules
          .filter((r) => !r.startsWith('!') && r.endsWith('/'))
          .map((r) => r.replace(/^\/+/, '').replace(/\/+$/, ''))
      );
      for (const row of String(ls.stdout).split(/\r?\n/)) {
        if (!row.startsWith('120000 ')) continue;
        const tabIdx = row.indexOf('\t');
        const symPath = tabIdx >= 0 ? row.slice(tabIdx + 1).trim() : '';
        if (!symPath) continue;
        trackedSymlinks.push(symPath);
        const norm = symPath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (dirOnlyRules.has(norm) || dirOnlyRules.has(path.posix.basename(norm))) {
          problems.push(`symlink rastreado "${norm}" não é ignorado por regra com "/" final no .gitignore em POSIX`);
        }
      }
    }
  }

  return {
    ok: problems.length === 0,
    tracked_symlinks: trackedSymlinks,
    backslash_rules: backslashRules,
    problems,
    warnings,
  };
}

function majorMinor(ver) {
  const m = String(ver || '').trim().match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * Checks whether tracked `release-evidence/scorecard-report.json` matches the root package's `major.minor` line.
 * Prevents surprises in CI (`npm run release:manifest`) when bumping to a new minor version.
 */
function checkScorecardEvidenceParity(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const pkgPath = path.join(rootAbs, 'package.json');
  const evidencePath = path.join(rootAbs, 'release-evidence', 'scorecard-report.json');
  const problems = [];
  const warnings = [];
  if (!fs.existsSync(pkgPath) || !fs.existsSync(evidencePath)) {
    return { ok: true, checked: false, drifted: false, package_version: null, evidence_version: null, problems, warnings };
  }
  let pkgVersion = null;
  let evVersion = null;
  try { pkgVersion = String(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || ''); } catch { pkgVersion = null; }
  try { evVersion = String(JSON.parse(fs.readFileSync(evidencePath, 'utf8')).oxe_version || ''); } catch { evVersion = null; }
  const pkgLine = majorMinor(pkgVersion);
  const evLine = majorMinor(evVersion);
  const drifted = Boolean(pkgLine && evLine && pkgLine !== evLine);
  if (drifted) {
    const msg = `release-evidence/scorecard-report.json está na linha ${evVersion} (package.json=${pkgVersion}) — o CI exige scorecard da linha ${pkgLine}.x antes do release`;
    if (options.strictScorecard) problems.push(msg);
    else warnings.push(msg);
  }
  return {
    ok: problems.length === 0,
    checked: true,
    drifted,
    package_version: pkgVersion,
    evidence_version: evVersion,
    problems,
    warnings,
  };
}

function runCiParityCheck(projectRoot, options = {}) {
  const rootAbs = path.resolve(projectRoot || process.cwd());
  const cleanCheckout = checkCleanCheckoutDoctor(rootAbs, options);
  const enginesParity = checkEnginesParity(rootAbs);
  const symlinkGitignore = checkPosixSymlinkGitignore(rootAbs, options);
  const scorecardEvidence = checkScorecardEvidenceParity(rootAbs, options);

  const problems = [
    ...cleanCheckout.problems,
    ...enginesParity.problems,
    ...symlinkGitignore.problems,
    ...scorecardEvidence.problems,
  ];
  const warnings = [
    ...cleanCheckout.warnings,
    ...enginesParity.warnings,
    ...symlinkGitignore.warnings,
    ...scorecardEvidence.warnings,
  ];

  return {
    oxeCiParitySchema: 1,
    ok: problems.length === 0,
    projectRoot: rootAbs,
    checked_at: new Date().toISOString(),
    checks: {
      clean_checkout_doctor: cleanCheckout,
      engines_parity: enginesParity,
      posix_symlink_gitignore: symlinkGitignore,
      scorecard_evidence: scorecardEvidence,
    },
    problems,
    warnings,
  };
}

module.exports = {
  runCiParityCheck,
  checkCleanCheckoutDoctor,
  checkEnginesParity,
  checkPosixSymlinkGitignore,
  checkScorecardEvidenceParity,
  parseMinNodeMajor,
};
