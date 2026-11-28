'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const catalog = require(path.join(REPO_ROOT, 'bin/lib/oxe-artifact-catalog.cjs'));

describe('A19 — Catálogo blindado (0 extras) e remoção de legado morto OXE-EVENTS.jsonl (OXB-230-19)', () => {
  it('OXB-230-19: oxe-artifact-catalog.cjs covers all modern .oxe/ artifacts including PLAN.json, PRD.md, program/, alm/, evidence/, DELIVER.json, skills/, .cache/, core/', () => {
    const paths = new Set(catalog.ARTIFACT_CATALOG.map((e) => e.path));
    const requiredModern = [
      'PLAN.json',
      'PRD.md',
      'GLOSSARY.md',
      'SYSTEM-DESIGN.md',
      'REFACTOR-PROPOSALS.md',
      'PLAN-STATUS.md',
      'LESSONS.md',
      'OPEN-DEFECTS.json',
      'oxe-version.json',
      'state.json',
      'role.json',
      'DELIVER.json',
      'DELIVERY.md',
      'DELIVERY.json',
      'program/',
      'alm/',
      'grill/',
      'rfc/',
      'dossier/',
      'evidence/',
      'plan/',
      'quick/',
      'release/',
      'skills/',
      '.cache/',
      'core/',
    ];
    for (const req of requiredModern) {
      assert.ok(paths.has(req), `bin/lib/oxe-artifact-catalog.cjs deve catalogar "${req}"`);
    }
    assert.ok(!paths.has('OXE-EVENTS.jsonl'), 'OXE-EVENTS.jsonl legado morto não deve constar no catálogo');
    assert.deepEqual([...catalog.CORE_INSTALL_PATHS].sort(), ['README.md', 'STATE.md', 'config.json']);
  });

  it('OXB-230-19: buildMapModel reports 0 extras for a realistic modern .oxe/ tree and renderLegend lists new entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a19-cat-'));
    try {
      const oxeDir = path.join(tmp, '.oxe');
      fs.mkdirSync(oxeDir, { recursive: true });
      for (const f of ['STATE.md', 'config.json', 'README.md', 'PLAN.json', 'PRD.md', 'GLOSSARY.md', 'state.json', 'role.json', 'DELIVER.json', 'DELIVERY.md', 'oxe-version.json', 'OPEN-DEFECTS.json']) {
        fs.writeFileSync(path.join(oxeDir, f), 'ok\n', 'utf8');
      }
      for (const d of ['program', 'alm', 'grill', 'rfc', 'dossier', 'evidence', 'plan', 'quick', 'release', 'skills', '.cache', 'core']) {
        fs.mkdirSync(path.join(oxeDir, d), { recursive: true });
      }
      const model = catalog.buildMapModel(tmp);
      assert.deepEqual(model.extras, [], `buildMapModel deve reportar 0 extras, obteve: ${JSON.stringify(model.extras)}`);
      const legend = catalog.renderLegend();
      assert.match(legend, /DELIVER\.json/);
      assert.match(legend, /\.cache\//);
      assert.match(legend, /core\//);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
