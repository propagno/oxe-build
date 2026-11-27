'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const ROOT = path.resolve(__dirname, '..', '..');

describe('A12 (OB-36 / OXB-221-12): v1.22.1+ version sync, Node >=18 engines and changelog', () => {
  it('synchronizes all 5 version sources (>= 1.22.1) while keeping engines.node >= 18.0.0', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const runtimePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'runtime', 'package.json'), 'utf8'));
    const vsixPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode-extension', 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

    const v = rootPkg.version;
    assert.ok(semver.valid(v) && semver.gte(v, '1.22.1'), `version must be >= 1.22.1, got ${v}`);
    assert.equal(runtimePkg.version, v);
    assert.equal(vsixPkg.version, v);
    assert.equal(rootPkg.engines.node, '>=18.0.0');
    assert.match(rootPkg.dependencies['@types/node'], /^\^?18\./);
    assert.ok(readme.includes(`**Versão:** \`${v}\``), `README.md must match version ${v}`);

    const topHeading = changelog.match(/^## \[([^\]]+)\]/m);
    assert.ok(topHeading && topHeading[1] === v, `CHANGELOG top heading must be [${v}], got ${topHeading && topHeading[0]}`);
    assert.match(changelog, /^## \[1\.22\.1\]/m, 'CHANGELOG must retain [1.22.1] section');
  });

  it('documents v1.22.1 highlights (presets, modularization, concurrency/timings, model split, pycsv) in CHANGELOG.md', () => {
    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const from1221 = changelog.split(/^## \[1\.22\.1\]/m)[1] || '';
    const section = from1221.split(/^## \[1\.22\.0\]/m)[0];
    assert.match(section, /oxe-presets\.cjs/);
    assert.match(section, /ops-commands\.cjs/);
    assert.match(section, /alm-refine-runtime\.cjs/);
    assert.match(section, /--concurrency|--shard|--timings/);
    assert.match(section, /--plan-model|--execute-model/);
    assert.match(section, /pycsv/);
  });
});
