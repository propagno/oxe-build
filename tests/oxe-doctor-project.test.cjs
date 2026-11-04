'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../bin/lib/oxe-project-env.cjs');

// 1.21 · OXB-006: o toolchain da máquina contra o que o projeto (e as dependências diretas) pedem.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-env-')); dirs.push(d); return d; }

describe('faixas semver (sem dependências)', () => {
  const cases = [
    ['22.17.1', '^22.22.2 || ^24.15.0 || >=26.0.0', false],
    ['22.22.2', '^22.22.2 || ^24.15.0', true],
    ['24.16.0', '^22.22.2 || ^24.15.0', true],
    ['22.17.1', '>= 10', true],
    ['18.19.0', '>=18.0.0', true],
    ['16.20.0', '>=18', false],
    ['20.11.1', '~20.11', true],
    ['20.12.0', '~20.11', false],
    ['20.5.0', '18 - 20.10', true],
    ['20.11.0', '18 - 20.10', false],
    ['22.1.0', '22.x', true],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['1.0.0', '*', true],
  ];
  for (const [version, range, expected] of cases) {
    it(`${version} ${expected ? '∈' : '∉'} "${range}"`, () => assert.equal(env.satisfies(version, range), expected));
  }
});

describe('checkProjectEnvironment', () => {
  it('engines.node fora da faixa é problema; .nvmrc divergente vira aviso quando há engines', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=22.22' } }));
    fs.writeFileSync(path.join(dir, '.nvmrc'), '24\n');
    const out = env.checkProjectEnvironment(dir, { node: '22.17.1', npm: '10.9.0', freeMb: 4000 });
    assert.equal(out.ok, false);
    assert.match(out.problems[0], /node 22\.17\.1 fora de engines\.node/);
    assert.match(out.warnings.join(), /\.nvmrc/);
  });

  it('o engines das dependências diretas no lockfile entra; o de transitivas não', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { jsdom: '^30' } }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/jsdom': { version: '30.1.3', engines: { node: '^22.22.2 || ^24.15.0 || >=26.0.0' } },
        'node_modules/jsdom/node_modules/deep': { version: '1.0.0', engines: { node: '>=99' } },
        'node_modules/transitive': { version: '1.0.0', engines: { node: '>=99' } },
      },
    }));
    const out = env.checkProjectEnvironment(dir, { node: '22.17.1', npm: null, freeMb: 4000 });
    assert.equal(out.problems.length, 1);
    assert.match(out.problems[0], /jsdom@30\.1\.3/);
    assert.doesNotMatch(out.problems[0], /transitive|deep/);
    assert.equal(env.checkProjectEnvironment(dir, { node: '22.22.2', npm: null, freeMb: 4000 }).ok, true);
  });

  it('memória abaixo do mínimo do executor é aviso; toolchain vai no resultado', () => {
    const dir = tmpDir();
    const out = env.checkProjectEnvironment(dir, { node: '22.0.0', npm: null, freeMb: 500, minFreeMb: 1024 });
    assert.equal(out.ok, true);
    assert.match(out.warnings.join(), /500 MB < 1024 MB/);
    assert.equal(out.toolchain.node, '22.0.0');
  });
});
