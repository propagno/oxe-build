#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.cjs');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-vscode-host-'));
  const workspace = path.join(sandbox, 'workspace');
  const copilotFixturePath = path.join(sandbox, 'copilot-chat-fixture');
  fs.mkdirSync(path.join(workspace, '.oxe'), { recursive: true });
  fs.mkdirSync(copilotFixturePath, { recursive: true });

  // Satisfy the production extension dependency without downloading the proprietary
  // Copilot extension or requiring credentials. The OXE manifest and sources remain
  // byte-for-byte the production files loaded by the Extension Development Host.
  const manifest = {
    name: 'copilot-chat',
    displayName: 'Copilot Chat test fixture',
    publisher: 'GitHub',
    version: '0.0.0-test',
    engines: { vscode: '^1.95.0' },
    main: './index.js',
    activationEvents: [],
  };
  fs.writeFileSync(
    path.join(copilotFixturePath, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(copilotFixturePath, 'index.js'),
    "'use strict';\nexports.activate = () => undefined;\nexports.deactivate = () => undefined;\n",
    'utf8'
  );

  await runTests({
    version: '1.95.3',
    extensionDevelopmentPath: [copilotFixturePath, extensionDevelopmentPath],
    extensionTestsPath,
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
    ],
  });
}

main().catch((error) => {
  console.error('Extension Host test failed:', error);
  process.exitCode = 1;
});
