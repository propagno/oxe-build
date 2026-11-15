'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const si = require('../bin/lib/oxe-suite-impact.cjs');

// G43 (OxeSpace 15/11, OxeCode F6 T42, US$ 8): a channel added to shared/types/ipc.ts without shared/mcp-coverage.ts
// in the task's scope — tests/mcp-coverage.test.ts checks one against the other and failed at every attempt.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-g43-'));
  dirs.push(dir);
  write(dir, 'shared/types/ipc.ts', "export const IPC_CHANNELS = { git: { status: 'git:status' } } as const;\n");
  write(dir, 'shared/mcp-coverage.ts', "import { IPC_CHANNELS } from './types/ipc';\nexport const MCP_COVERAGE = { 'git:status': 'oxespace_git' };\nvoid IPC_CHANNELS;\n");
  write(dir, 'shared/util.ts', 'export const x = 1;\n');
  write(dir, 'tests/mcp-coverage.test.ts', "import { IPC_CHANNELS } from '../shared/types/ipc';\nimport { MCP_COVERAGE } from '../shared/mcp-coverage';\nimport { x } from '../shared/util';\nit('gives every IPC channel of the app a capability', () => { void IPC_CHANNELS; void MCP_COVERAGE; void x; });\n");
  return dir;
}
const files = ['shared/types/ipc.ts', 'shared/mcp-coverage.ts', 'shared/util.ts', 'tests/mcp-coverage.test.ts'];

describe('G43: registry in scope, its checked manifest out of it', () => {
  it('found: a suite imports the registry and a manifest that imports the registry (not a plain helper)', () => {
    const dir = repo();
    const doc = { tasks: [{ id: 'T42', wave: 1, files: ['shared/types/ipc.ts', 'src/git.ts'] }] };
    const found = si.registryManifestGaps(dir, doc, { files, detect: true });
    assert.equal(si.registryManifestGaps(dir, doc, { files }).length, 0, 'detection is opt-in');
    assert.deepEqual(found.map((f) => [f.task, f.registry, f.manifest, f.suite, f.declared]), [['T42', 'shared/types/ipc.ts', 'shared/mcp-coverage.ts', 'tests/mcp-coverage.test.ts', false]]);
    const msg = si.registryManifestMessages(found, { level: 'error' });
    assert.equal(msg.errors.length, 1);
    assert.match(msg.errors[0], /T42 muda shared\/types\/ipc\.ts, e shared\/mcp-coverage\.ts fica fora do escopo .*\[G43\]/);
  });

  it('the manifest in the scope (own or an ancestor\'s) clears it; a declared pair is named without a suite', () => {
    const dir = repo();
    assert.equal(si.registryManifestGaps(dir, { tasks: [{ id: 'T42', files: ['shared/types/ipc.ts', 'shared/mcp-coverage.ts'] }] }, { files, detect: true }).length, 0);
    assert.equal(si.registryManifestGaps(dir, { tasks: [{ id: 'T41', files: ['shared/mcp-coverage.ts'] }, { id: 'T42', depends_on: ['T41'], files: ['shared/types/ipc.ts'] }] }, { files, detect: true }).length, 0);
    const declared = si.registryManifestGaps(dir, { tasks: [{ id: 'T7', files: ['shared/types/ipc.ts'] }] }, { files, detect: false, pairs: [{ registry: 'shared/types/ipc.ts', manifest: 'docs/channels.md' }] });
    assert.deepEqual(declared.map((f) => [f.manifest, f.declared]), [['docs/channels.md', true]]);
    assert.equal(si.registryManifestGaps(dir, { tasks: [{ id: 'T1', done: true, files: ['shared/types/ipc.ts'] }] }, { files }).length, 0, 'a done task is not asked');
  });

  it('R42: a type-only import, a helper without constants, or a suite not using both constants never counts', () => {
    const dir = repo();
    write(dir, 'src/types.ts', "export type User = { id: string };\nexport const ROLES = ['a', 'b'];\n");
    write(dir, 'src/user-service.ts', "import type { User } from './types';\nexport const DEFAULTS = { a: 1 };\nexport function load(u: User) { return u; }\n");
    write(dir, 'tests/user-service.test.ts', "import type { User } from '../src/types';\nimport { load, DEFAULTS } from '../src/user-service';\nit('x', () => { void load; void DEFAULTS; const u: User = { id: '1' }; void u; });\n");
    const f2 = [...files, 'src/types.ts', 'src/user-service.ts', 'tests/user-service.test.ts'];
    assert.deepEqual(si.registryManifestGaps(dir, { tasks: [{ id: 'T9', files: ['src/types.ts'] }] }, { files: f2, detect: true }), []);
  });
});
