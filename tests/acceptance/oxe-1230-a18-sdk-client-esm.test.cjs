'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A18 — SDK Facade createClient(projectRoot), ESM nativo (index.mjs) e zero drift de tipos (OXB-230-18)', () => {
  it('OXB-230-18: lib/sdk/client.cjs and require(\'oxe-cc\') expose bound createClient(projectRoot) ergonomic API', () => {
    const clientMod = require(path.join(REPO_ROOT, 'lib/sdk/client.cjs'));
    const sdk = require(path.join(REPO_ROOT, 'lib/sdk/index.cjs'));
    assert.equal(typeof clientMod.createClient, 'function', 'lib/sdk/client.cjs deve exportar createClient');
    assert.equal(sdk.createClient, clientMod.createClient, 'SDK index deve reexportar createClient');

    const client = sdk.createClient(REPO_ROOT);
    assert.equal(client.projectRoot, REPO_ROOT);
    assert.equal(client.version, sdk.version);

    const status = client.status();
    assert.ok(status && typeof status === 'object');
    assert.ok(status.next && typeof status.next === 'object');

    const primer = client.primer();
    assert.equal(primer.oxePrimerSchema, 1);
    assert.equal(primer.project_mode, 'brownfield');

    const onboard = client.onboard();
    assert.ok(onboard && typeof onboard === 'object');

    const parity = client.ciParity({ skipCleanCheckout: true });
    assert.equal(parity.oxeCiParitySchema, 1);

    const agents = client.agents.list();
    assert.ok(Array.isArray(agents));

    const deliv = client.deliver.status();
    assert.equal(deliv.oxeDeliverSchema, 1);

    const dash = client.dashboard.context();
    assert.ok(dash && typeof dash === 'object');
  });

  it('OXB-230-18: native ESM import(\'oxe-cc\'), CJS require(\'oxe-cc\'), conditional exports, test:sdk-types and CHANGELOG.md docs', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.exports && pkg.exports['.'] && typeof pkg.exports['.'] === 'object', 'exports["."] deve ser objeto condicional');
    assert.equal(pkg.exports['.'].import, './lib/sdk/index.mjs');
    assert.equal(pkg.exports['.'].require, './lib/sdk/index.cjs');
    assert.equal(pkg.exports['.'].types, './lib/sdk/index.d.ts');

    // Direct ESM import
    const esmUrl = pathToFileURL(path.join(REPO_ROOT, 'lib/sdk/index.mjs')).href;
    const esm = await import(esmUrl);
    assert.equal(typeof esm.createClient, 'function', 'ESM deve exportar createClient');
    assert.equal(typeof esm.runDoctorChecks, 'function', 'ESM deve exportar runDoctorChecks');
    assert.equal(esm.version, pkg.version);
    assert.ok(esm.default && esm.default.createClient === esm.createClient, 'ESM default export deve coincidir com named exports');

    // Real consumer test resolving bare specifier `oxe-cc` via both require('oxe-cc') and import('oxe-cc')
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a18-consumer-'));
    try {
      const nm = path.join(fixture, 'node_modules');
      fs.mkdirSync(nm, { recursive: true });
      fs.symlinkSync(REPO_ROOT, path.join(nm, 'oxe-cc'), 'junction');

      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;

      const cjsCheck = spawnSync(process.execPath, ['-e', "const oxe = require('oxe-cc'); const c = oxe.createClient(process.cwd()); if (!c.version) process.exit(2);"], {
        cwd: fixture,
        env: childEnv,
        encoding: 'utf8',
      });
      assert.equal(cjsCheck.status, 0, `require('oxe-cc') falhou:\n${cjsCheck.stderr}`);

      const esmCheck = spawnSync(process.execPath, ['--input-type=module', '-e', "const oxe = await import('oxe-cc'); const c = oxe.createClient(process.cwd()); if (!c.version || oxe.default.createClient !== oxe.createClient) process.exit(2);"], {
        cwd: fixture,
        env: childEnv,
        encoding: 'utf8',
      });
      assert.equal(esmCheck.status, 0, `import('oxe-cc') falhou:\n${esmCheck.stderr}`);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }

    // Zero drift in generated TypeScript declarations (same check as npm run test:sdk-types)
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const check = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/generate-sdk-types.cjs'), '--check'], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
    });
    assert.equal(check.status, 0, `test:sdk-types drift check falhou:\n${check.stdout}\n${check.stderr}`);

    // Final release docs reflect createClient & ESM entrypoint in CHANGELOG.md
    const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /createClient/, 'CHANGELOG.md deve documentar createClient');
    assert.match(changelog, /index\.mjs|ESM/i, 'CHANGELOG.md deve documentar entrypoint ESM');
  });
});
