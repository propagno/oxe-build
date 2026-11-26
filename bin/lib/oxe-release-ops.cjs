'use strict';

/**
 * 1.23.0 (OXB-G08 & OXB-G17):
 *   - `oxe-cc release-readiness --version X.Y.Z`: unified pre-release gate checking:
 *       (1) Jira/ALM board integrity (cards missing fixVersion or not yet Homologado/Done)
 *       (2) Required HML/CI gates (`hml-packaged-pass`, `perf-gate`, `packaged-smoke`, `acceptance`)
 *       (3) Multi-platform GitHub Release asset completeness (Desktop + Android APK)
 *       (4) Batch transition readiness for Homologado -> Lançado
 *   - `oxe-cc release-finalize --version X.Y.Z [--apply|--dry-run]`: idempotent multi-workflow
 *       post-publication finalizer checking Desktop + Android APK + checksums, releasing the version in Jira,
 *       and transitioning all Homologado cards of the version to Lançado.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const presets = require('./oxe-presets.cjs');

const DEFAULT_REQUIRED_GATES = Object.freeze(['hml-packaged-pass', 'perf-gate', 'packaged-smoke', 'acceptance']);
const DEFAULT_READY_STATES = Object.freeze(['homologado', 'done', 'lançado', 'lancado', 'released']);
const DEFAULT_TARGET_STATE = 'Lançado';
const DEFAULT_DESKTOP_MOBILE_ASSETS = Object.freeze([
  { label: 'Desktop installer (.exe/.dmg/.AppImage/.deb)', patterns: ['*.exe', '*.dmg', '*.AppImage', '*.deb', '*.msi'] },
  { label: 'Android APK (.apk)', patterns: ['*.apk'] },
  { label: 'Checksums (SHA256SUMS / checksums)', patterns: ['*checksum*', '*sha256*'] },
]);

function resolveExpectedAssets(cfg = {}) {
  if (cfg && cfg.release && Array.isArray(cfg.release.expectedAssets)) {
    return cfg.release.expectedAssets;
  }
  const presetCfg = presets.resolvePresetConfig(cfg);
  if (presetCfg.hasExplicitPreset) {
    return Array.isArray(presetCfg.release && presetCfg.release.expectedAssets)
      ? presetCfg.release.expectedAssets
      : [];
  }
  return DEFAULT_DESKTOP_MOBILE_ASSETS;
}

function readJsonQuiet(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

function readMergedConfig(root) {
  const base = readJsonQuiet(path.join(root, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(root, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
}

function normVersion(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

function assetMatchesPattern(name, pattern) {
  const n = String(name || '').toLowerCase();
  const p = String(pattern || '').toLowerCase();
  if (!p) return false;
  const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return re.test(n);
}

function checkMultiPlatformAssets(assets, cfgRelease = {}) {
  const names = (Array.isArray(assets) ? assets : []).map((a) => (typeof a === 'string' ? a : (a && a.name) || '')).filter(Boolean);
  let expected;
  if (cfgRelease && Array.isArray(cfgRelease.expectedAssets)) {
    expected = cfgRelease.expectedAssets;
  } else if (cfgRelease && (cfgRelease.preset || cfgRelease.presets || cfgRelease.release)) {
    expected = resolveExpectedAssets(cfgRelease);
  } else {
    expected = DEFAULT_DESKTOP_MOBILE_ASSETS;
  }
  const missing = [];
  const matched = [];
  for (const spec of expected) {
    const patterns = typeof spec === 'string' ? [spec] : (Array.isArray(spec.patterns) ? spec.patterns : []);
    const label = typeof spec === 'string' ? spec : (spec.label || patterns.join(' | '));
    const hits = names.filter((n) => patterns.some((p) => assetMatchesPattern(n, p)));
    if (hits.length) matched.push({ label, assets: hits });
    else missing.push({ label, patterns });
  }
  return { ok: missing.length === 0, total_assets: names.length, matched, missing };
}

function fetchReleaseAssets(root, tag, options = {}) {
  if (Array.isArray(options.assets)) return { ok: true, tag, assets: options.assets };
  const spawn = options.spawn || spawnSync;
  const r = spawn('gh', ['release', 'view', tag, '--json', 'tagName,isDraft,assets'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) {
    return { ok: false, tag, assets: [], error: String(r.stderr || r.stdout || 'gh release view falhou').trim() };
  }
  try {
    const j = JSON.parse(String(r.stdout || '{}'));
    return { ok: true, tag: j.tagName || tag, draft: Boolean(j.isDraft), assets: Array.isArray(j.assets) ? j.assets : [] };
  } catch (err) {
    return { ok: false, tag, assets: [], error: err.message };
  }
}

function validateChecksumsText(checksumsText, assetNames) {
  const names = new Set((assetNames || []).map((a) => (typeof a === 'string' ? a : a.name)));
  const lines = String(checksumsText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, valid_lines: 0, missing_assets: [], invalid_lines: ['checksums vazio'] };
  const invalid = [];
  const missingAssets = [];
  let valid = 0;
  for (const l of lines) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(l);
    if (!m) { invalid.push(l); continue; }
    valid += 1;
    const fname = m[2].trim();
    if (names.size && !names.has(fname)) missingAssets.push(fname);
  }
  return { ok: invalid.length === 0 && missingAssets.length === 0 && valid > 0, valid_lines: valid, missing_assets: missingAssets, invalid_lines: invalid };
}

function makeJiraClient(cfg, options = {}) {
  const env = options.env || process.env;
  const alm = cfg && cfg.alm && typeof cfg.alm === 'object' ? cfg.alm : {};
  const almJira = alm.jira && typeof alm.jira === 'object' ? alm.jira : {};
  const site = String(options.site || almJira.site || alm.site || env.JIRA_SITE || '').trim().replace(/\/+$/, '');
  const project = String(options.project || almJira.project || alm.project || env.JIRA_PROJECT || '').trim();
  if (typeof options.jiraRequest === 'function') {
    return { configured: true, site, project, request: options.jiraRequest };
  }
  if (!site || !project || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) {
    return { configured: false, site, project, request: null };
  }
  const auth = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`;
  const request = async (method, apiPath, body) => {
    const res = await fetch(`${site}${apiPath}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { json = null; }
    if (!res.ok) throw new Error(`Jira ${method} ${apiPath} -> ${res.status}: ${txt.slice(0, 200)}`);
    return json;
  };
  return { configured: true, site, project, request };
}

/**
 * OXB-G08: Unified pre-release readiness check (`oxe-cc release-readiness --version X.Y.Z`).
 */
async function checkReleaseReadiness(projectRoot, options = {}) {
  const version = normVersion(options.version);
  if (!version) throw new Error('informe a versão: oxe-cc release-readiness --version <X.Y.Z>');
  const rootAbs = path.resolve(projectRoot);
  const cfg = options.config || readMergedConfig(rootAbs);
  const relCfg = {
    ...(cfg.release && typeof cfg.release === 'object' ? cfg.release : {}),
    expectedAssets: resolveExpectedAssets(cfg),
  };
  const tag = `v${version}`;
  const blockers = [];
  const warnings = [];

  // 1. Jira / ALM board check (cards in version not Homologado + cards in Homologado without fixVersion)
  const readyStates = new Set((Array.isArray(relCfg.readyStates) ? relCfg.readyStates : DEFAULT_READY_STATES).map((s) => s.toLowerCase()));
  const jira = makeJiraClient(cfg, options);
  let board = { checked: false, version_cards: [], not_ready: [], missing_fix_version: [], ready_for_release: [] };
  if (Array.isArray(options.boardIssues) || jira.configured) {
    board.checked = true;
    let versionIssues = [];
    let orphanIssues = [];
    if (Array.isArray(options.boardIssues)) {
      versionIssues = options.boardIssues.filter((i) => (i.fixVersions || []).includes(version));
      orphanIssues = options.boardIssues.filter((i) => !(i.fixVersions || []).length && readyStates.has(String(i.status || '').toLowerCase()));
    } else {
      const q1 = encodeURIComponent(`project = ${jira.project} AND fixVersion = "${version}"`);
      const r1 = await jira.request('GET', `/rest/api/3/search/jql?jql=${q1}&maxResults=100&fields=summary,status,fixVersions`);
      versionIssues = ((r1 && r1.issues) || []).map((i) => ({
        key: i.key,
        summary: i.fields && i.fields.summary,
        status: i.fields && i.fields.status && i.fields.status.name,
        fixVersions: ((i.fields && i.fields.fixVersions) || []).map((v) => v.name),
      }));
      const q2 = encodeURIComponent(`project = ${jira.project} AND fixVersion is EMPTY AND status = "Homologado"`);
      try {
        const r2 = await jira.request('GET', `/rest/api/3/search/jql?jql=${q2}&maxResults=50&fields=summary,status`);
        orphanIssues = ((r2 && r2.issues) || []).map((i) => ({ key: i.key, summary: i.fields && i.fields.summary, status: i.fields && i.fields.status && i.fields.status.name }));
      } catch { orphanIssues = []; }
    }
    board.version_cards = versionIssues;
    board.not_ready = versionIssues.filter((i) => !readyStates.has(String(i.status || '').toLowerCase()));
    board.ready_for_release = versionIssues.filter((i) => readyStates.has(String(i.status || '').toLowerCase()));
    board.missing_fix_version = orphanIssues;
    if (board.not_ready.length) {
      blockers.push(`${board.not_ready.length} card(s) da versão ${version} ainda fora de Homologado/Done: ${board.not_ready.map((c) => `${c.key} (${c.status})`).join(', ')}`);
    }
    if (board.missing_fix_version.length) {
      blockers.push(`${board.missing_fix_version.length} card(s) Homologado sem fixVersion: ${board.missing_fix_version.map((c) => c.key).join(', ')}`);
    }
  } else {
    warnings.push('ALM/Jira não configurado — checagem de board pulada');
  }

  // 2. Required gates (hml-packaged-pass, perf-gate, packaged-smoke, acceptance)
  const requiredGates = Array.isArray(relCfg.requiredGates) && relCfg.requiredGates.length
    ? relCfg.requiredGates
    : DEFAULT_REQUIRED_GATES;
  const evidenceFile = path.join(rootAbs, '.oxe', 'release', `evidence-${tag}.json`);
  const evidenceDoc = options.gates || readJsonQuiet(evidenceFile) || {};
  const gateResults = requiredGates.map((g) => {
    const val = evidenceDoc[g];
    const ok = val === true || (val && typeof val === 'object' && (val.ok === true || String(val.status || '').toLowerCase() === 'pass' || String(val.status || '').toLowerCase() === 'passed'));
    return { gate: g, ok, detail: val && typeof val === 'object' ? (val.status || val.url || null) : (val == null ? 'missing' : String(val)) };
  });
  const missingGates = gateResults.filter((g) => !g.ok);
  if (missingGates.length) {
    blockers.push(`gate(s) de release pendente(s)/vermelho(s): ${missingGates.map((g) => g.gate).join(', ')}`);
  }

  // 3. Multi-platform GitHub release assets (Desktop + Android APK + checksums)
  let assetsReport = { checked: false, ok: true, missing: [], matched: [], total_assets: 0 };
  if (options.checkAssets !== false) {
    const fetched = fetchReleaseAssets(rootAbs, tag, options);
    assetsReport.checked = true;
    if (!fetched.ok) {
      if (options.requireAssets) blockers.push(`release ${tag} não encontrada no GitHub: ${fetched.error}`);
      else warnings.push(`release ${tag} ainda não publicada no GitHub (${fetched.error})`);
    } else {
      const check = checkMultiPlatformAssets(fetched.assets, relCfg);
      assetsReport = { checked: true, ...check };
      if (!check.ok) {
        blockers.push(`assets multi-plataforma incompletos em ${tag}: faltam ${check.missing.map((m) => m.label).join(', ')}`);
      }
    }
  }

  return {
    ok: blockers.length === 0,
    version,
    tag,
    blockers,
    warnings,
    board,
    gates: gateResults,
    assets: assetsReport,
  };
}

/**
 * OXB-G17: Idempotent post-publication finalizer (`oxe-cc release-finalize --version X.Y.Z [--apply|--dry-run]`).
 */
async function finalizeRelease(projectRoot, options = {}) {
  const version = normVersion(options.version);
  if (!version) throw new Error('informe a versão: oxe-cc release-finalize --version <X.Y.Z>');
  const rootAbs = path.resolve(projectRoot);
  const cfg = options.config || readMergedConfig(rootAbs);
  const relCfg = {
    ...(cfg.release && typeof cfg.release === 'object' ? cfg.release : {}),
    expectedAssets: resolveExpectedAssets(cfg),
  };
  const tag = `v${version}`;
  const apply = Boolean(options.apply);
  const errors = [];

  // 1. Verify Desktop + Android APK + checksums published on GitHub Releases
  const fetched = fetchReleaseAssets(rootAbs, tag, options);
  if (!fetched.ok) {
    return { ok: false, dry_run: !apply, version, tag, errors: [`release ${tag} indisponível: ${fetched.error}`], transitioned: [], version_released: false };
  }
  const assetCheck = checkMultiPlatformAssets(fetched.assets, relCfg);
  if (!assetCheck.ok) {
    errors.push(`assets incompletos em ${tag}: faltam ${assetCheck.missing.map((m) => m.label).join(', ')}`);
  }
  let checksums = null;
  if (typeof options.checksumsText === 'string') {
    checksums = validateChecksumsText(options.checksumsText, fetched.assets);
    if (!checksums.ok) {
      errors.push(`checksums inválidos em ${tag}: ${checksums.invalid_lines.length} linha(s) inválida(s), ${checksums.missing_assets.length} asset(s) ausente(s)`);
    }
  }
  if (errors.length) {
    return { ok: false, dry_run: !apply, version, tag, assets: assetCheck, checksums, errors, transitioned: [], version_released: false };
  }

  // 2. Idempotent Jira transitions (Homologado -> Lançado) + mark version released
  const targetState = String(relCfg.releasedState || DEFAULT_TARGET_STATE);
  const jira = makeJiraClient(cfg, options);
  const plannedCards = [];
  const transitioned = [];
  const alreadyReleased = [];
  let versionReleased = false;

  if (jira.configured) {
    const q = encodeURIComponent(`project = ${jira.project} AND fixVersion = "${version}"`);
    const search = await jira.request('GET', `/rest/api/3/search/jql?jql=${q}&maxResults=100&fields=summary,status`);
    const issues = (search && search.issues) || [];
    for (const i of issues) {
      const st = String((i.fields && i.fields.status && i.fields.status.name) || '');
      if (st.toLowerCase() === targetState.toLowerCase()) {
        alreadyReleased.push(i.key);
        continue;
      }
      plannedCards.push({ key: i.key, from: st, to: targetState });
      if (apply) {
        const t = await jira.request('GET', `/rest/api/3/issue/${i.key}/transitions`);
        const match = ((t && t.transitions) || []).find((x) => x.name.toLowerCase() === targetState.toLowerCase() || (x.to && x.to.name.toLowerCase() === targetState.toLowerCase()));
        if (!match) {
          errors.push(`${i.key}: transição para "${targetState}" não encontrada`);
          continue;
        }
        await jira.request('POST', `/rest/api/3/issue/${i.key}/transitions`, { transition: { id: match.id } });
        transitioned.push(i.key);
      }
    }

    // Release Jira project version
    const versions = await jira.request('GET', `/rest/api/3/project/${jira.project}/versions`);
    const vObj = (Array.isArray(versions) ? versions : []).find((v) => v && v.name === version);
    if (vObj) {
      if (vObj.released) {
        versionReleased = true;
      } else if (apply) {
        await jira.request('PUT', `/rest/api/3/version/${vObj.id}`, {
          released: true,
          releaseDate: new Date().toISOString().slice(0, 10),
        });
        versionReleased = true;
      }
    }
  }

  return {
    ok: errors.length === 0,
    dry_run: !apply,
    version,
    tag,
    assets: assetCheck,
    checksums,
    planned_transitions: plannedCards,
    transitioned,
    already_released: alreadyReleased,
    version_released: versionReleased,
    errors,
  };
}

module.exports = {
  DEFAULT_REQUIRED_GATES,
  makeJiraClient,
  checkMultiPlatformAssets,
  validateChecksumsText,
  checkReleaseReadiness,
  finalizeRelease,
};
