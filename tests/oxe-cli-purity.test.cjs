'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// 1.21 · OXB-003/024: comandos de runtime nunca recriam o que a pessoa apagou no `.oxe/`; OXB-004: `--json` sai limpo.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-purity-')); dirs.push(d); return d; }
const env = { ...process.env, OXE_NO_PROMPT: '1', NO_COLOR: '1' };
const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env });

function listTree(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}

describe('pureza da CLI de runtime', () => {
  it('um .oxe existente não ganha STATE.md, config.json nem README.md de volta', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe'));
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n');
    const before = listTree(dir);
    for (const action of ['status', 'providers', 'agents', 'gates']) {
      run(dir, 'runtime', action);
      assert.deepEqual(listTree(dir), before, `runtime ${action} escreveu no projeto`);
    }
  });

  it('comando de leitura sem .oxe falha com a dica do init, sem criar nada', () => {
    const dir = tmpDir();
    const res = run(dir, 'runtime', 'status');
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /init-oxe/);
    assert.deepEqual(listTree(dir), []);
  });

  it('--json deixa no stdout só o JSON (banner e cabeçalhos no stderr)', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.oxe'));
    const res = spawnSync(process.execPath, [CLI, 'runtime', 'status', '--json', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(res.status, 0, res.stderr);
    const doc = JSON.parse(res.stdout);
    assert.deepEqual(doc, { run: null, status: 'absent' });
    assert.match(res.stderr, /OXE ▸ runtime/);
  });
});
