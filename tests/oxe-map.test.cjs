'use strict';

// Artifact catalog + `oxe-cc map`: legend generation, live map model, and the
// host-integration `--json` contract (oxeMapSchema:1).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const catalog = require('../bin/lib/oxe-artifact-catalog.cjs');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-map-'));
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  return dir;
}

describe('artifact catalog — renderLegend', () => {
  test('documents the lean core and points to oxe-cc map', () => {
    const legend = catalog.renderLegend();
    assert.match(legend, /mapa de artefatos/i);
    assert.match(legend, /oxe-cc map/);
    assert.match(legend, /STATE\.md/);
    assert.match(legend, /codebase\//);
    // Every catalog entry shows up in the legend.
    for (const e of catalog.ARTIFACT_CATALOG) {
      assert.ok(legend.includes(e.path), `legenda deve citar ${e.path}`);
    }
  });

  test('core install paths are exactly STATE/config/README', () => {
    assert.deepStrictEqual([...catalog.CORE_INSTALL_PATHS].sort(), ['README.md', 'STATE.md', 'config.json']);
  });
});

describe('artifact catalog — buildMapModel', () => {
  test('all artifacts available when .oxe is empty', () => {
    const dir = tmpProject();
    const model = catalog.buildMapModel(dir);
    assert.strictEqual(model.oxeExists, true);
    assert.strictEqual(model.counts.present, 0);
    assert.strictEqual(model.counts.available, catalog.ARTIFACT_CATALOG.length);
  });

  test('classifies active (file with content) vs empty (zero-byte) vs empty dir', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# state\n', 'utf8');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '', 'utf8'); // empty file
    fs.mkdirSync(path.join(dir, '.oxe', 'codebase'), { recursive: true }); // empty dir
    fs.mkdirSync(path.join(dir, '.oxe', 'runs', 'r1'), { recursive: true }); // populated dir
    const model = catalog.buildMapModel(dir);
    const byPath = Object.fromEntries(model.present.map((n) => [n.path, n.state]));
    assert.strictEqual(byPath['STATE.md'], 'active');
    assert.strictEqual(byPath['config.json'], 'empty');
    assert.strictEqual(byPath['codebase/'], 'empty');
    assert.strictEqual(byPath['runs/'], 'active');
  });

  test('flags stale codebase scan when staleScan is set', () => {
    const dir = tmpProject();
    fs.mkdirSync(path.join(dir, '.oxe', 'codebase'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'codebase', 'OVERVIEW.md'), '# ov\n', 'utf8');
    const model = catalog.buildMapModel(dir, { staleScan: true });
    const node = model.present.find((n) => n.path === 'codebase/');
    assert.strictEqual(node.state, 'stale');
    assert.strictEqual(model.counts.stale, 1);
  });

  test('lists extras outside the catalog', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, '.oxe', 'WHATEVER.md'), 'x', 'utf8');
    const model = catalog.buildMapModel(dir);
    assert.ok(model.extras.includes('WHATEVER.md'));
  });
});

describe('oxe-cc map (CLI)', () => {
  test('--json emits a versioned, parseable model', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# state\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'map', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.oxeMapSchema, 1);
    assert.ok(Array.isArray(parsed.groups));
    assert.ok(parsed.counts.present >= 1);
  });

  test('text output renders the annotated tree with a legend', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# state\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'map', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /\.oxe\//);
    assert.match(r.stdout, /sob demanda/i);
  });
});
