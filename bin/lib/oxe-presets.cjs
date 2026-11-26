'use strict';

/**
 * 1.22.1 (OXB-221-04): Declarative project presets (`cli`, `web`, `desktop-mobile`, `brand-strict`).
 * Separates the agnostic OXE core from optional domain defaults.
 * Precedence: explicit keys in `.oxe/config.json` > explicit keys in `oxe.config.json` > preset(s) in order > agnostic default.
 */

const fs = require('node:fs');
const path = require('node:path');

const AGNOSTIC_DEFAULTS = Object.freeze({
  ui: {
    brandGate: false,
  },
  ship: {
    requiredCommitStatuses: [],
  },
  preflight: {
    cssTargetsDir: null,
  },
  verify: {
    noBatchPatterns: [],
  },
  envSanitize: {
    stripEnvPrefixes: [],
  },
  release: {
    expectedAssets: [],
  },
});

const PRESETS = Object.freeze({
  cli: Object.freeze({
    ui: { brandGate: false },
    ship: { requiredCommitStatuses: [] },
    preflight: { cssTargetsDir: null },
    verify: { noBatchPatterns: [] },
    envSanitize: { stripEnvPrefixes: [] },
    release: {
      expectedAssets: [],
    },
  }),
  web: Object.freeze({
    ui: { brandGate: false },
    ship: { requiredCommitStatuses: [] },
    preflight: { cssTargetsDir: null },
    verify: { noBatchPatterns: [] },
    envSanitize: { stripEnvPrefixes: [] },
    release: {
      expectedAssets: [],
    },
  }),
  'desktop-mobile': Object.freeze({
    ui: { brandGate: false },
    ship: { requiredCommitStatuses: [] },
    preflight: { cssTargetsDir: null },
    verify: { noBatchPatterns: ['gradle152'] },
    envSanitize: { stripEnvPrefixes: ['OXESPACE_', 'AI_MEMORY_'] },
    release: {
      expectedAssets: [
        { label: 'Desktop installer (.exe/.dmg/.AppImage/.deb)', patterns: ['*.exe', '*.dmg', '*.AppImage', '*.deb', '*.msi'] },
        { label: 'Android APK (.apk)', patterns: ['*.apk'] },
        { label: 'Checksums (SHA256SUMS / checksums)', patterns: ['*checksum*', '*sha256*'] },
      ],
    },
  }),
  'brand-strict': Object.freeze({
    ui: { brandGate: true },
    ship: { requiredCommitStatuses: ['marca/conformidade'] },
    preflight: { cssTargetsDir: 'src/design/targets' },
    verify: { noBatchPatterns: [] },
    envSanitize: { stripEnvPrefixes: [] },
    release: {
      expectedAssets: [],
    },
  }),
});

const PRESET_NAMES = Object.freeze(Object.keys(PRESETS));

function readJsonQuiet(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function readRawConfig(rootOrCfg) {
  if (!rootOrCfg) return {};
  if (typeof rootOrCfg === 'string') {
    const base = readJsonQuiet(path.join(rootOrCfg, 'oxe.config.json'));
    const local = readJsonQuiet(path.join(rootOrCfg, '.oxe', 'config.json'));
    if (base && typeof base === 'object' && local && typeof local === 'object') return { ...base, ...local };
    return (local && typeof local === 'object' ? local : (base && typeof base === 'object' ? base : {}));
  }
  return typeof rootOrCfg === 'object' ? rootOrCfg : {};
}

function cloneValue(val) {
  if (Array.isArray(val)) return val.map(cloneValue);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = cloneValue(v);
    return out;
  }
  return val;
}

function mergePresetLayer(acc, layer) {
  if (!layer || typeof layer !== 'object') return acc;
  if (layer.ui && typeof layer.ui === 'object') {
    if (layer.ui.brandGate === true) acc.ui.brandGate = true;
  }
  if (layer.ship && Array.isArray(layer.ship.requiredCommitStatuses)) {
    acc.ship.requiredCommitStatuses = [...new Set([...acc.ship.requiredCommitStatuses, ...layer.ship.requiredCommitStatuses])];
  }
  if (layer.preflight && layer.preflight.cssTargetsDir) {
    acc.preflight.cssTargetsDir = layer.preflight.cssTargetsDir;
  }
  if (layer.verify && Array.isArray(layer.verify.noBatchPatterns)) {
    acc.verify.noBatchPatterns = [...new Set([...acc.verify.noBatchPatterns, ...layer.verify.noBatchPatterns])];
  }
  if (layer.envSanitize && Array.isArray(layer.envSanitize.stripEnvPrefixes)) {
    acc.envSanitize.stripEnvPrefixes = [...new Set([...acc.envSanitize.stripEnvPrefixes, ...layer.envSanitize.stripEnvPrefixes])];
  }
  if (layer.release && Array.isArray(layer.release.expectedAssets) && layer.release.expectedAssets.length) {
    acc.release.expectedAssets = cloneValue(layer.release.expectedAssets);
  }
  return acc;
}

function applyExplicitOverrides(acc, cfg) {
  if (!cfg || typeof cfg !== 'object') return acc;
  if (cfg.ui && typeof cfg.ui === 'object' && typeof cfg.ui.brandGate === 'boolean') {
    acc.ui.brandGate = cfg.ui.brandGate;
  }
  if (cfg.ship && typeof cfg.ship === 'object' && Array.isArray(cfg.ship.requiredCommitStatuses)) {
    acc.ship.requiredCommitStatuses = cloneValue(cfg.ship.requiredCommitStatuses);
  }
  if (cfg.preflight && typeof cfg.preflight === 'object' && Object.prototype.hasOwnProperty.call(cfg.preflight, 'cssTargetsDir')) {
    acc.preflight.cssTargetsDir = cfg.preflight.cssTargetsDir;
  }
  if (cfg.verify && typeof cfg.verify === 'object' && Array.isArray(cfg.verify.noBatchPatterns)) {
    acc.verify.noBatchPatterns = cloneValue(cfg.verify.noBatchPatterns);
  }
  if (cfg.envSanitize && typeof cfg.envSanitize === 'object' && Array.isArray(cfg.envSanitize.stripEnvPrefixes)) {
    acc.envSanitize.stripEnvPrefixes = cloneValue(cfg.envSanitize.stripEnvPrefixes);
  }
  if (Array.isArray(cfg.stripEnvPrefixes)) {
    acc.envSanitize.stripEnvPrefixes = cloneValue(cfg.stripEnvPrefixes);
  }
  if (cfg.release && typeof cfg.release === 'object' && Array.isArray(cfg.release.expectedAssets)) {
    acc.release.expectedAssets = cloneValue(cfg.release.expectedAssets);
  }
  return acc;
}

/**
 * Resolves effective preset policies for a project root or raw config object.
 * @param {string|object|null} rootOrCfg
 */
function resolvePresetConfig(rootOrCfg) {
  const cfg = readRawConfig(rootOrCfg);
  const requested = [];
  if (typeof cfg.preset === 'string' && cfg.preset.trim()) requested.push(cfg.preset.trim());
  if (Array.isArray(cfg.presets)) {
    for (const p of cfg.presets) {
      if (typeof p === 'string' && p.trim()) requested.push(p.trim());
    }
  }
  const uniqueRequested = [...new Set(requested)];
  const appliedPresets = [];
  const warnings = [];
  const acc = cloneValue(AGNOSTIC_DEFAULTS);

  for (const name of uniqueRequested) {
    if (Object.prototype.hasOwnProperty.call(PRESETS, name)) {
      mergePresetLayer(acc, PRESETS[name]);
      appliedPresets.push(name);
    } else {
      warnings.push(`preset desconhecido "${name}" (use: ${PRESET_NAMES.join(', ')})`);
    }
  }

  applyExplicitOverrides(acc, cfg);
  return {
    ...acc,
    appliedPresets,
    hasExplicitPreset: uniqueRequested.length > 0,
    warnings,
  };
}

/** Merges resolved preset defaults under explicit config keys without mutating the input object. */
function mergePresetIntoConfig(cfg) {
  const base = cfg && typeof cfg === 'object' ? cfg : {};
  const resolved = resolvePresetConfig(base);
  return {
    ...base,
    ui: { ...resolved.ui, ...(base.ui && typeof base.ui === 'object' ? base.ui : {}) },
    ship: { ...resolved.ship, ...(base.ship && typeof base.ship === 'object' ? base.ship : {}) },
    preflight: { ...resolved.preflight, ...(base.preflight && typeof base.preflight === 'object' ? base.preflight : {}) },
    verify: { ...resolved.verify, ...(base.verify && typeof base.verify === 'object' ? base.verify : {}) },
    release: { ...resolved.release, ...(base.release && typeof base.release === 'object' ? base.release : {}) },
  };
}

module.exports = {
  AGNOSTIC_DEFAULTS,
  PRESETS,
  PRESET_NAMES,
  resolvePresetConfig,
  mergePresetIntoConfig,
};
