'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OP_FILE = path.join(ROOT, 'bin', 'lib', 'oxe-operational.cjs');
const CHILD_ENV_FILE = path.join(ROOT, 'bin', 'lib', 'operational', 'child-env.cjs');
const ALM_REFINE_FILE = path.join(ROOT, 'bin', 'lib', 'operational', 'alm-refine-runtime.cjs');
const BASELINE_OP_LINES = 15949;

describe('A9 (OB-33 / OXB-221-09): Strangler Fig Slice 1 of oxe-operational.cjs preserves 209 exports + ADR D-6', () => {
  it('extracts child-env.cjs and alm-refine-runtime.cjs with zero circular dependency and shrinks oxe-operational.cjs by >= 700 lines', () => {
    assert.equal(fs.existsSync(CHILD_ENV_FILE), true, 'bin/lib/operational/child-env.cjs must exist');
    assert.equal(fs.existsSync(ALM_REFINE_FILE), true, 'bin/lib/operational/alm-refine-runtime.cjs must exist');

    const childEnvSrc = fs.readFileSync(CHILD_ENV_FILE, 'utf8');
    const almRefineSrc = fs.readFileSync(ALM_REFINE_FILE, 'utf8');
    assert.doesNotMatch(childEnvSrc, /require\([^)]*oxe-operational/, 'child-env.cjs must not circularly require oxe-operational.cjs');
    assert.doesNotMatch(almRefineSrc, /require\([^)]*oxe-operational/, 'alm-refine-runtime.cjs must not circularly require oxe-operational.cjs');

    const childMod = require(CHILD_ENV_FILE);
    const almMod = require(ALM_REFINE_FILE);
    assert.equal(typeof childMod.createChildEnvPolicy, 'function');
    assert.equal(typeof almMod.createAlmRefineRuntime, 'function');

    const opSrc = fs.readFileSync(OP_FILE, 'utf8');
    const lineCount = opSrc.split(/\r?\n/).length;
    const extractedLines = childEnvSrc.split(/\r?\n/).length + almRefineSrc.split(/\r?\n/).length;
    assert.match(opSrc, /child-env\.cjs/, 'oxe-operational.cjs must delegate to operational/child-env.cjs');
    assert.match(opSrc, /alm-refine-runtime\.cjs/, 'oxe-operational.cjs must delegate to operational/alm-refine-runtime.cjs');
    assert.ok(
      extractedLines >= 700,
      `extracted operational slices must hold >= 700 lines (current: ${extractedLines})`
    );
    assert.ok(
      lineCount < BASELINE_OP_LINES,
      `bin/lib/oxe-operational.cjs must stay below baseline ${BASELINE_OP_LINES} (current: ${lineCount})`
    );
  });

  it('preserves all 209 exports on oxe-operational.cjs facade and publishes ADR D-6', () => {
    const op = require(OP_FILE);
    const keys = Object.keys(op);
    assert.ok(keys.length >= 209, `expected >= 209 exports on oxe-operational.cjs, got ${keys.length}`);

    const criticalFns = [
      'runtimeAlmRefine',
      'runtimeAlmRefineImport',
      'runtimeAlmAdmin',
      'runtimeAlmMetrics',
      'runtimeTrace',
      'traceSnapshot',
      'traceGateFindings',
      'uiCardGaps',
      'runtimeAlm',
      'almAutoSync',
      'runRuntimeVerify',
      'runRuntimeExecute',
    ];
    for (const fn of criticalFns) {
      assert.equal(typeof op[fn], 'function', `expected function export "${fn}" on oxe-operational.cjs`);
    }

    const adrDir = path.join(ROOT, 'docs', 'adr');
    const files = fs.readdirSync(adrDir);
    const d6 = files.find((f) => /^D-6-.*\.md$/i.test(f));
    assert.ok(d6, `ADR D-6-*.md not found in docs/adr/ (found: ${files.join(', ')})`);
    const readme = fs.readFileSync(path.join(adrDir, 'README.md'), 'utf8');
    assert.ok(readme.includes('D-6'), 'docs/adr/README.md must list D-6');
  });
});
