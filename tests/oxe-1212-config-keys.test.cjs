'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const health = require('../bin/lib/oxe-project-health.cjs');

// 1.21.2 — doctor warned that 14 keys the runtime reads (task_gates, execute, parallel, deps_strategy…) were
// "não usadas pelo oxe-cc", which invites a user to delete working gates. ALLOWED_CONFIG_KEYS is now tested against
// the top-level keys the code really reads from .oxe/config.json.

const ROOT = path.join(__dirname, '..');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// Names that, somewhere in the code, are bound to a SUB-object of the config (config.program, config.close.seams,
// config.review, ui_verify…) — a key read through them is not top-level.
const NESTED_ONLY = new Set([
  'grow_limit_lines', // close.seams
  'max_rounds', // review
  'default_risk', // program
  'risk_decision', // program
  'timeout_ms', // ui_verify / checkpoint_related_tests
  'command', // ui_verify / checkpoint_related_tests
  'max_files', // checkpoint_related_tests
  'fix_version', // alm
  'release_version', // alm
  'dry_run', // alm
  'adopt_prefixes', // alm
  'search_settle_ms', // alm
  'ledger_guard', // alm
  'ready_gate', // alm
  'stories_source', // alm
  'require_apply', // alm (OXB-G13)
  'ref_label', // alm (intake label "plain")
  'precheck', // lint.precheck
]);

function sourceFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'dist-tests'].includes(e.name)) walk(p); } else if (/\.(cjs|js|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'bin'));
  walk(path.join(ROOT, 'packages', 'runtime', 'src'));
  return out;
}

/** Top-level keys of .oxe/config.json the code reads, keyed to the first file that reads each. */
function keysTheCodeReads() {
  const PATTERNS = [
    // cfg.x / config.x / projectConfig.x / oxeConfig.x (optional chaining or bracket access too)
    /\b(?:cfg|config|projectConfig|oxeConfig)\s*(?:\?\.|\.)\s*([a-z][a-z0-9_]*)\b/g,
    /\b(?:cfg|config|projectConfig|oxeConfig)\s*(?:\?\.)?\[\s*['"]([a-z][a-z0-9_]*)['"]\s*\]/g,
    // (readProjectConfig(root) || {}).x and readProjectConfig(root).x
    /readProjectConfig\([^()]*\)(?:\s*\|\|\s*\{\}\s*\))?\s*\.\s*([a-z][a-z0-9_]*)\b/g,
  ];
  const found = new Map();
  for (const f of sourceFiles()) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const k = m[1];
        // Only snake_case or the single-word keys a config really has; skip JS members (config.length, cfg.map…).
        if (!k.includes('_') && !health.ALLOWED_CONFIG_KEYS.includes(k) && !SINGLE_WORD_KEYS.has(k)) continue;
        if (NESTED_ONLY.has(k)) continue;
        if (!found.has(k)) found.set(k, path.relative(ROOT, f));
      }
    }
  }
  return found;
}

// Single-word top-level keys (no underscore, so the scan cannot tell them from JS members by shape).
const SINGLE_WORD_KEYS = new Set([
  'execute', 'parallel', 'worktree', 'program', 'models', 'review', 'close', 'context', 'deps', 'executor', 'lint',
  'signal', 'guards', 'nfr',
]);

describe('doctor: config keys the runtime reads are known', () => {
  it('every top-level key the code reads is in ALLOWED_CONFIG_KEYS', () => {
    const missing = [...keysTheCodeReads()].filter(([k]) => !health.ALLOWED_CONFIG_KEYS.includes(k)).map(([k, f]) => `${k} (${f})`);
    assert.deepEqual(missing, [], `read by the code but called unknown by doctor: ${missing.join(', ')}`);
  });

  it('the keys oxespace runs with produce no "chaves desconhecidas" warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cfgkeys-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const cfg = {
      profile: 'balanced',
      checkpoint_check: 'npm run typecheck',
      checkpoint_related_tests: true,
      deps_optional_ignore: ['fsevents'],
      native_check: 'node -e 1',
      execute: { dispatch: 'stream' },
      suite_rules: [],
      verify_timeout_ms: 600000,
      worktree: { copy_local: ['.env'] },
      deps_strategy: 'link',
      deps_link_from: '.',
      deps_protected: [],
      parallel: { max: 2 },
      task_gates: [],
      task_suite_command: 'npx vitest run {suites}',
      coupled_scope: [],
      integration_checks: false,
      lint: { precheck: false },
      models: { tiers: [] },
    };
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(cfg, null, 2));
    const unknown = Object.keys(cfg).filter((k) => !health.ALLOWED_CONFIG_KEYS.includes(k));
    assert.deepEqual(unknown, []);
    const r = health.validateConfigShape ? health.validateConfigShape(cfg) : null;
    if (r && Array.isArray(r.unknownKeys)) assert.deepEqual(r.unknownKeys, []);
  });
});
