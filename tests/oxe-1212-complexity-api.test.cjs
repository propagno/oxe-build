'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const cx = require('../bin/lib/oxe-complexity.cjs');
const api = require('../bin/lib/oxe-api-surface.cjs');

// 1.21.2 — OXB-115 complexity alarm; OXB-116 API surface diff per phase.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const branches = (n) => Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i};`).join('\n');

function project(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-cx-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, ...config }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/route.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'src/route.js', `export function route(x) {\n${branches(3)}\n  return -1;\n}\nexport function keep(a, b) { return a + b; }\n`);
  write(dir, 'electron/ipc.ts', "ipcMain.handle('settings:get', () => 1);\n");
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-115: complexity alarm', () => {
  it('a touched function that grew past the limit gets a proposal; strict blocks the close', () => {
    const dir = project();
    write(dir, 'src/route.js', `export function route(x) {\n${branches(20)}\n  return -1;\n}\nexport function keep(a, b) { return a + b; }\nexport function fresh(x) {\n${branches(18)}\n}\n`);
    const res = op.runtimeComplexity(dir, null, {});
    assert.deepEqual(res.alarms.map((a) => [a.name, a.before, a.after]), [['route', 4, 21], ['fresh', null, 19]]);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'REFACTOR-PROPOSALS.md'), 'utf8'), /`route` — src\/route\.js:1/);
    assert.equal(res.block, false);
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, profile: 'strict' }));
    const close = (() => { try { const r = op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false, defects: false }); return (r.gate && r.gate.reasons) || r.reasons || []; } catch (e) { return [e.message]; } })();
    assert.ok(close.some((r) => /complexidade: route \(src\/route\.js:1\) 4→21/.test(r)), close.join('\n'));
  });

  it('functionsOf ignores keywords in strings and comments', () => {
    const f = cx.functionsOf("function a() {\n  // if if if\n  const s = 'if && ||';\n  return 1;\n}\n");
    assert.equal(f[0].complexity, 1);
  });
});

describe('OXB-116: API surface diff', () => {
  it('exports, signatures, IPC channels and MCP tools before → after; an export change the pack did not declare is flagged', () => {
    const dir = project();
    write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ tasks: [{ id: 'T1', symbols: [{ name: 'route', path: 'src/route.js' }] }] }));
    write(dir, 'src/route.js', 'export function route(x, opts) { return x; }\nexport const added = (a) => a;\n');
    write(dir, 'electron/ipc.ts', "ipcMain.handle('settings:set', () => 1);\nserver.tool('oxespace_status', {});\n");
    const out = op.runtimeDossier(dir, null, { phase: 'F1' });
    assert.equal(out.api_surface.added, 3, JSON.stringify(out.api_surface));
    assert.equal(out.api_surface.removed, 2);
    assert.equal(out.api_surface.changed, 1);
    assert.deepEqual(out.api_surface.flagged.sort(), ['export:added (src/route.js)', 'export:keep (src/route.js)']);
    const md = fs.readFileSync(path.join(out.dir, 'api-surface.md'), 'utf8');
    assert.match(md, /`function route\(x\)` → `function route\(x, opts\)`/);
    assert.match(md, /`ipc settings:set`/);
    assert.match(md, /`mcp oxespace_status`/);
  });

  it('surfaceOf reads ESM and CommonJS exports', () => {
    const s = api.surfaceOf("exports.a = (x) => x;\nmodule.exports = { b, c: 1 };\nexport class K {}\n");
    assert.deepEqual([...s.keys()].sort(), ['export:K', 'export:a', 'export:b', 'export:c']);
  });
});
