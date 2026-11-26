'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('A12 (OB-36 / OXB-221-12): v1.22.1 version sync, Node >=18 engines and changelog', () => {
  it('synchronizes all 5 version sources to 1.22.1 while keeping engines.node >= 18.0.0', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const runtimePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'runtime', 'package.json'), 'utf8'));
    const vsixPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode-extension', 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

    assert.equal(rootPkg.version, '1.22.1');
    assert.equal(runtimePkg.version, '1.22.1');
    assert.equal(vsixPkg.version, '1.22.1');
    assert.equal(rootPkg.engines.node, '>=18.0.0');
    assert.match(rootPkg.dependencies['@types/node'], /^\^?18\./);
    assert.match(readme, /\*\*Versão:\*\*\s*`1\.22\.1`/);

    const topHeading = changelog.match(/^## \[([^\]]+)\]/m);
    assert.ok(topHeading && topHeading[1] === '1.22.1', `CHANGELOG top heading must be [1.22.1], got ${topHeading && topHeading[0]}`);
  });

  it('documents v1.22.1 highlights (presets, modularization, concurrency/timings, model split, pycsv) in CHANGELOG.md', () => {
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const section = changelog.split(/^## \[1\.22\.0\]/m)[0];
    assert.match(section, /oxe-presets\.cjs/);
    assert.match(section, /ops-commands\.cjs/);
    assert.match(section, /alm-refine-runtime\.cjs/);
    assert.match(section, /--concurrency|--shard|--timings/);
    assert.match(section, /--plan-model|--execute-model/);
    assert.match(section, /pycsv/);
  });
});
