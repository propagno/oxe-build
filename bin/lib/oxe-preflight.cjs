'use strict';

/**
 * 1.23.0 (OXB-G09, OXB-G16, OXB-G10, OXB-G13, OXB-G14): `oxe-cc preflight`
 * Fast (<5s) local gate before push / ship:
 *   - OXB-G09 & OXB-G16: configurable `preflight.checks` (cheap guards like css-classes-guard, design-lint, i18n, file-size)
 *   - OXB-G10: path-triggered UI / Perf / CSS regression checks (`preflight.triggers`)
 *   - OXB-G13: static E2E & frozen acceptance selector impact detector (`--e2e-impact`)
 *   - OXB-G14: CSS target risk detector for `border`/`padding`/`height` edits touching `src/design/targets/*.json` selectors
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envSanitize = require('./oxe-env-sanitize.cjs');

const DEFAULT_CSS_RISK_PROPS = /\b(?:border(?:-(?:top|bottom|left|right|width))?|padding(?:-(?:top|bottom|left|right|block|inline))?|height|min-height|max-height|line-height|font-size|box-sizing)\s*:/i;

function readJsonQuiet(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMergedConfig(projectRoot) {
  const base = readJsonQuiet(path.join(projectRoot, 'oxe.config.json'));
  const local = readJsonQuiet(path.join(projectRoot, '.oxe', 'config.json'));
  if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
  return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
}

function globMatch(relPath, pattern) {
  const f = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const p = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  if (!/[*?[{]/.test(p)) return f === p || f.startsWith(`${p.replace(/\/+$/, '')}/`);
  const re = new RegExp(`^${p
    .replace(/[.+^$()|\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0000/g, '.*')}$`);
  return re.test(f);
}

function resolveDiffBase(root, requestedBase, spawn = spawnSync) {
  if (requestedBase) return requestedBase;
  for (const cand of ['origin/main', 'main', 'origin/master', 'master']) {
    const r = spawn('git', ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return cand;
  }
  return 'HEAD';
}

function getChangedFiles(root, base, spawn = spawnSync) {
  const files = new Set();
  const addLines = (out) => {
    for (const l of String(out || '').split(/\r?\n/)) {
      const f = l.trim().replace(/\\/g, '/');
      if (f) files.add(f);
    }
  };
  if (base && base !== 'HEAD') {
    const r1 = spawn('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r1.status === 0) addLines(r1.stdout);
  }
  const r2 = spawn('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r2.status === 0) addLines(r2.stdout);
  const r3 = spawn('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r3.status === 0) addLines(r3.stdout);
  return [...files].sort();
}

function getUnifiedDiff(root, base, spawn = spawnSync) {
  const chunks = [];
  if (base && base !== 'HEAD') {
    const r1 = spawn('git', ['diff', '-U0', `${base}...HEAD`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (r1.status === 0 && r1.stdout) chunks.push(r1.stdout);
  }
  const r2 = spawn('git', ['diff', '-U0', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r2.status === 0 && r2.stdout) chunks.push(r2.stdout);
  return chunks.join('\n');
}

function walkFiles(dirAbs, rootAbs, out = []) {
  if (!fs.existsSync(dirAbs)) return out;
  for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkFiles(full, rootAbs, out);
    } else if (ent.isFile() && /\.(?:spec|test)\.[tj]sx?$/i.test(ent.name)) {
      out.push(path.relative(rootAbs, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * OXB-G13: Parses removed/renamed locale labels, `data-testid` attributes, and settings sections/routes
 * from a git unified diff and cross-checks them against `e2e/**` and `e2e/acceptance/**` (and `tests/acceptance/**`).
 */
function detectE2eImpact(root, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(root);
  const diffText = typeof options.diffText === 'string'
    ? options.diffText
    : getUnifiedDiff(rootAbs, resolveDiffBase(rootAbs, options.base || null, spawn), spawn);

  const removedTokens = new Map(); // token -> { kind, source }
  const addedTokens = new Set();
  let curFile = '';

  const extractFromLine = (line, file, targetMapOrSet, isAdd) => {
    // 1. data-testid="..." or data-testid='...'
    for (const m of line.matchAll(/data-testid\s*=\s*["']([^"']{2,80})["']/g)) {
      if (isAdd) targetMapOrSet.add(m[1]);
      else targetMapOrSet.set(m[1], { kind: 'data-testid', source: file });
    }
    // 2. Settings sections / tabs / routes (data-section, data-tab, id="settings-...", /settings/...)
    for (const m of line.matchAll(/(?:data-section|data-tab|data-route|data-oq-action)\s*=\s*["']([^"']{2,80})["']/g)) {
      if (isAdd) targetMapOrSet.add(m[1]);
      else targetMapOrSet.set(m[1], { kind: 'selector-attr', source: file });
    }
    if (/settings/i.test(file)) {
      for (const m of line.matchAll(/(?:section|tab|id|path)\s*:\s*["']([a-zA-Z0-9_/-]{3,60})["']/g)) {
        if (isAdd) targetMapOrSet.add(m[1]);
        else targetMapOrSet.set(m[1], { kind: 'settings-section', source: file });
      }
    }
    // 3. locales/*.json string values & keys
    if (/(?:^|\/)locales\/.*\.json$/i.test(file)) {
      const kv = /^\s*"([^"]{2,80})"\s*:\s*"([^"]{3,120})"\s*,?\s*$/.exec(line);
      if (kv) {
        const [, k, v] = kv;
        if (isAdd) {
          targetMapOrSet.add(k);
          targetMapOrSet.add(v);
        } else {
          targetMapOrSet.set(k, { kind: 'locale-key', source: file });
          if (!/^[\d\s.,:%-]+$/.test(v)) targetMapOrSet.set(v, { kind: 'locale-label', source: file });
        }
      }
    }
  };

  for (const raw of String(diffText || '').split(/\r?\n/)) {
    if (raw.startsWith('+++ b/')) { curFile = raw.slice(6).trim().replace(/\\/g, '/'); continue; }
    if (raw.startsWith('--- a/') && !curFile) { curFile = raw.slice(6).trim().replace(/\\/g, '/'); continue; }
    if (!curFile || raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('@@')) continue;
    if (raw.startsWith('-')) extractFromLine(raw.slice(1), curFile, removedTokens, false);
    else if (raw.startsWith('+')) extractFromLine(raw.slice(1), curFile, addedTokens, true);
  }

  // Only tokens truly removed or renamed (present in `-` lines and NOT re-added verbatim in `+` lines)
  const effectiveRemoved = [];
  for (const [token, meta] of removedTokens.entries()) {
    if (!addedTokens.has(token)) effectiveRemoved.push({ token, ...meta });
  }

  const specFiles = [
    ...walkFiles(path.join(rootAbs, 'e2e'), rootAbs),
    ...walkFiles(path.join(rootAbs, 'tests', 'acceptance'), rootAbs),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const affectedSpecs = [];
  if (effectiveRemoved.length && specFiles.length) {
    for (const rel of specFiles) {
      let body = '';
      try { body = fs.readFileSync(path.join(rootAbs, rel), 'utf8'); } catch { continue; }
      const matched = effectiveRemoved.filter((t) => body.includes(t.token));
      if (!matched.length) continue;
      const frozen = /(?:^|\/)acceptance\//i.test(rel);
      affectedSpecs.push({
        file: rel,
        frozen,
        matched_tokens: matched.map((m) => ({ token: m.token, kind: m.kind, source: m.source })),
      });
    }
  }
  const frozenAffected = affectedSpecs.filter((s) => s.frozen);
  return {
    ok: affectedSpecs.length === 0,
    tokens_removed: effectiveRemoved,
    specs_scanned: specFiles.length,
    affected_specs: affectedSpecs,
    frozen_affected: frozenAffected,
  };
}

/**
 * OXB-G14 (local CSS half): Reads `src/design/targets/*.json` and alerts when the diff edits
 * `border`/`padding`/`height` properties on selectors/components locked by design targets.
 */
function detectCssTargetRisk(root, options = {}) {
  const spawn = options.spawn || spawnSync;
  const rootAbs = path.resolve(root);
  const targetsDir = path.resolve(rootAbs, options.targetsDir || path.join('src', 'design', 'targets'));
  if (!fs.existsSync(targetsDir)) return { ok: true, targets_loaded: 0, alerts: [] };

  const targetDefs = [];
  for (const f of fs.readdirSync(targetsDir).filter((n) => n.endsWith('.json')).sort()) {
    const doc = readJsonQuiet(path.join(targetsDir, f));
    if (!doc || typeof doc !== 'object') continue;
    const selectors = new Set();
    const collectSelectors = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const x of node) collectSelectors(x); return; }
      for (const [k, v] of Object.entries(node)) {
        if ((k === 'selector' || k === 'cssSelector' || k === 'className') && typeof v === 'string' && v.trim()) {
          selectors.add(v.trim());
        } else if (k === 'selectors' && Array.isArray(v)) {
          for (const s of v) if (typeof s === 'string' && s.trim()) selectors.add(s.trim());
        } else if (v && typeof v === 'object') {
          collectSelectors(v);
        }
      }
    };
    collectSelectors(doc);
    if (selectors.size) {
      targetDefs.push({ file: path.relative(rootAbs, path.join(targetsDir, f)).replace(/\\/g, '/'), id: doc.id || f.replace(/\.json$/, ''), selectors: [...selectors] });
    }
  }
  if (!targetDefs.length) return { ok: true, targets_loaded: 0, alerts: [] };

  const diffText = typeof options.diffText === 'string'
    ? options.diffText
    : getUnifiedDiff(rootAbs, resolveDiffBase(rootAbs, options.base || null, spawn), spawn);

  const cssChangedFiles = new Map(); // file -> { addedLines: string[] }
  let curFile = '';
  for (const raw of String(diffText || '').split(/\r?\n/)) {
    if (raw.startsWith('+++ b/')) { curFile = raw.slice(6).trim().replace(/\\/g, '/'); continue; }
    if (!curFile || !/\.(?:css|scss|less|tsx|jsx)$/i.test(curFile)) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const line = raw.slice(1);
      if (DEFAULT_CSS_RISK_PROPS.test(line)) {
        if (!cssChangedFiles.has(curFile)) cssChangedFiles.set(curFile, []);
        cssChangedFiles.get(curFile).push(line.trim());
      }
    }
  }

  const alerts = [];
  for (const [file, riskLines] of cssChangedFiles.entries()) {
    let fullContent = '';
    try { fullContent = fs.readFileSync(path.join(rootAbs, file), 'utf8'); } catch { fullContent = riskLines.join('\n'); }
    for (const t of targetDefs) {
      const matchedSelectors = t.selectors.filter((sel) => {
        // Match exact selector or its class/id/attribute token (.foo, [data-ui="bar"])
        if (fullContent.includes(sel)) return true;
        const tokens = sel.match(/(?:\.[A-Za-z0-9_-]+|\[[^\]]+\])/g) || [];
        return tokens.some((tok) => tok.length >= 4 && fullContent.includes(tok));
      });
      if (matchedSelectors.length) {
        alerts.push({
          target_id: t.id,
          target_file: t.file,
          css_file: file,
          selectors: matchedSelectors,
          risk_lines: riskLines.slice(0, 6),
        });
      }
    }
  }
  return {
    ok: alerts.length === 0,
    targets_loaded: targetDefs.length,
    alerts,
  };
}

function runCheck(root, check, env, spawn = spawnSync) {
  const started = Date.now();
  const isWin = process.platform === 'win32';
  const timeoutMs = Number(check.timeoutMs || check.timeout_ms) > 0 ? Number(check.timeoutMs || check.timeout_ms) : 60_000;
  const r = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', check.command] : ['-c', check.command], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: isWin,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const duration_ms = Date.now() - started;
  const combined = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const tail = combined ? combined.split(/\r?\n/).slice(-10).join('\n') : '';
  return {
    name: check.name,
    command: check.command,
    kind: check.kind || 'check',
    ok: r.status === 0,
    exit: typeof r.status === 'number' ? r.status : 1,
    duration_ms,
    tail,
  };
}

/**
 * Runs the full `oxe-cc preflight` pipeline:
 *   1. `preflight.checks` (cheap mandatory guards, OXB-G09 + OXB-G16)
 *   2. `preflight.triggers` matched against changed files (OXB-G10)
 *   3. Optional/enabled `--e2e-impact` static selector impact check (OXB-G13)
 *   4. Optional/enabled CSS target geometry risk check against `src/design/targets/*.json` (OXB-G14)
 */
function runPreflight(projectRoot, options = {}) {
  const started = Date.now();
  const rootAbs = path.resolve(projectRoot);
  const spawn = options.spawn || spawnSync;
  const cfg = options.config || readMergedConfig(rootAbs);
  const pf = cfg.preflight && typeof cfg.preflight === 'object' ? cfg.preflight : {};
  const { env, stripped } = envSanitize.sanitizeEnv(process.env, cfg);

  const base = resolveDiffBase(rootAbs, options.base || pf.base || null, spawn);
  const changedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : getChangedFiles(rootAbs, base, spawn);

  // 1. Cheap checks (OXB-G09 & OXB-G16)
  const rawChecks = Array.isArray(pf.checks) ? pf.checks : [];
  const checkResults = [];
  if (!options.e2eImpactOnly) {
    for (let i = 0; i < rawChecks.length; i += 1) {
      const entry = rawChecks[i];
      const check = typeof entry === 'string'
        ? { name: `check-${i + 1}`, command: entry, kind: 'guard' }
        : (entry && entry.command ? { name: entry.name || `check-${i + 1}`, command: entry.command, timeoutMs: entry.timeoutMs || entry.timeout_ms, kind: 'guard' } : null);
      if (!check) continue;
      checkResults.push(runCheck(rootAbs, check, env, spawn));
    }
  }

  // 2. Path-triggered UI / Perf regression checks (OXB-G10)
  const rawTriggers = Array.isArray(pf.triggers) ? pf.triggers : [];
  const triggerResults = [];
  if (!options.noTriggers && !options.e2eImpactOnly) {
    for (let i = 0; i < rawTriggers.length; i += 1) {
      const tr = rawTriggers[i];
      if (!tr || !tr.command || !Array.isArray(tr.globs) || !tr.globs.length) continue;
      const matchedFiles = changedFiles.filter((f) => tr.globs.some((g) => globMatch(f, g)));
      if (!matchedFiles.length) continue;
      const res = runCheck(rootAbs, { name: tr.name || `trigger-${i + 1}`, command: tr.command, timeoutMs: tr.timeoutMs || tr.timeout_ms, kind: 'trigger' }, env, spawn);
      triggerResults.push({ ...res, matched_files: matchedFiles.slice(0, 10) });
    }
  }

  // 3. Static E2E & frozen acceptance selector impact (OXB-G13)
  const wantE2e = options.e2eImpact === true || options.e2eImpactOnly === true || pf.e2eImpact === true;
  const e2eImpact = wantE2e ? detectE2eImpact(rootAbs, { base, spawn, diffText: options.diffText }) : null;

  // 4. Design target CSS geometry risk alert (OXB-G14)
  const wantCssTargets = options.cssTargets !== false && pf.cssTargetCheck !== false && !options.e2eImpactOnly;
  const cssTargets = wantCssTargets ? detectCssTargetRisk(rootAbs, { base, spawn, diffText: options.diffText, targetsDir: pf.designTargetsDir }) : null;

  const checksOk = checkResults.every((r) => r.ok);
  const triggersOk = triggerResults.every((r) => r.ok);
  const e2eBlocking = Boolean(options.strictE2e && e2eImpact && !e2eImpact.ok);
  const cssBlocking = Boolean(options.strictCssTargets && cssTargets && !cssTargets.ok);

  return {
    ok: checksOk && triggersOk && !e2eBlocking && !cssBlocking,
    duration_ms: Date.now() - started,
    base,
    changed_files: changedFiles.length,
    env_stripped: stripped.length,
    checks: checkResults,
    triggers: triggerResults,
    e2e_impact: e2eImpact,
    css_targets: cssTargets,
  };
}

module.exports = {
  globMatch,
  detectE2eImpact,
  detectCssTargetRisk,
  runPreflight,
};
