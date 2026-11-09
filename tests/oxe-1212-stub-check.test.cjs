'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const stub = require('../bin/lib/oxe-stub-check.cjs');

// 1.21.2 — OXB-108: a task green on its frozen tests can still ship a skeleton. Three levels: exists, substantive,
// wired. A finding turns the task red with file:line.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const SCRIPT = path.join(__dirname, '..', 'bin', 'lib', 'oxe-stub-check.cjs');

function repo(files = {}, plan = null, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-stub-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, ...config }));
  write(dir, 'src/app.js', "const { used } = require('./used');\nmodule.exports = used;\n");
  write(dir, 'src/used.js', 'exports.used = 1;\n');
  for (const [rel, c] of Object.entries(files)) write(dir, rel, c);
  if (plan) { write(dir, '.oxe/PLAN.json', JSON.stringify(plan, null, 2)); write(dir, '.oxe/PLAN.md', '# PLAN\n'); write(dir, '.oxe/STATE.md', '# S\n'); write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n'); }
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('OXB-108: anti-stub levels', () => {
  it('substantive: stubs in the ADDED lines, with file:line; old TODOs and tests are not flagged; oxe-stub-ok is an exception', () => {
    const dir = repo({ 'src/old.js': '// TODO: legacy, not this task\nexports.x = 1;\n' });
    write(dir, 'src/used.js', [
      'exports.used = 1;',
      "exports.save = () => { throw new Error('not implemented'); };",
      'export function render() {}',
      "export const Panel = () => <div>Placeholder</div>;",
      "exports.ok = () => { throw new Error('not implemented'); }; // oxe-stub-ok: abstract base",
      '',
    ].join('\n'));
    write(dir, 'src/old.js', '// TODO: legacy, not this task\nexports.x = 2;\n');
    write(dir, 'tests/used.test.js', "it('x', () => { throw new Error('not implemented'); });\n");
    const f = stub.stubFindings(dir, { levels: ['substantive'] });
    assert.deepEqual(f.map((x) => `${x.file}:${x.line}`), ['src/used.js:2', 'src/used.js:3', 'src/used.js:4']);
    assert.match(stub.format(f), /src\/used\.js:2 {2}\[substantive\] marcador "not implemented"/);
  });

  it('exists: a pack symbol not defined in its file', () => {
    const dir = repo({}, { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/used.js'] }] });
    write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ tasks: [{ id: 'T1', symbols: [{ name: 'used', path: 'src/used.js', kind: 'const' }, { name: 'saveDraft', path: 'src/used.js', kind: 'function' }, { name: 'gone', path: 'src/missing.js' }] }] }));
    const f = stub.stubFindings(dir, { task: 'T1', levels: ['exists'] });
    assert.deepEqual(f.map((x) => x.why), ['saveDraft declarado no pack, não definido no arquivo', 'arquivo do símbolo gone não existe']);
  });

  it('wired: a NEW source file nobody imports is flagged; imported, entry or test files are not', () => {
    const dir = repo();
    write(dir, 'src/orphan.js', 'exports.orphan = 1;\n');
    write(dir, 'src/helper.js', 'exports.h = 1;\n');
    write(dir, 'src/app.js', "const { used } = require('./used');\nrequire('./helper');\nmodule.exports = used;\n");
    write(dir, 'tests/orphan.test.js', "require('../src/orphan');\n");
    const f = stub.stubFindings(dir, { phase: true, levels: ['wired'] });
    assert.deepEqual(f.map((x) => x.file), ['src/orphan.js'], 'a test importing it does not count');
    write(dir, '.oxe/config.json', JSON.stringify({ stub_check: { wired: true } }));
    assert.deepEqual(stub.stubFindings(dir, { phase: true }).map((x) => x.file), ['src/orphan.js'], 'phase default + wired: true');
    write(dir, '.oxe/config.json', JSON.stringify({ stub_check: { entries: ['src/orphan.js'] } }));
    assert.deepEqual(stub.stubFindings(dir, { phase: true, levels: ['wired'] }), []);
    write(dir, '.oxe/config.json', JSON.stringify({ stub_check: false }));
    assert.deepEqual(stub.stubFindings(dir, { phase: true }), []);
  });

  it('CLI: exit 1 with the findings', () => {
    const dir = repo();
    write(dir, 'src/used.js', "exports.used = () => { throw new Error('TODO'); };\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--levels', 'substantive'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/used\.js:1 {2}\[substantive\]/);
  });
});

describe('OXB-108: in the execute loop', () => {
  it('a task green on its verify but with a stub goes red with file:line; fixed, it completes', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 1 }, tasks: [{ id: 'T1', title: 'save', wave: 1, files: ['src/used.js'], verify: { commands: ['node -e 0'] } }] };
    const dir = repo({}, plan);
    let n = 0;
    const seen = [];
    const executor = { async execute(_node, _l, _r, _a, opts) {
      n += 1;
      seen.push(opts && opts.previousError);
      write(dir, 'src/used.js', n === 1 ? "exports.used = () => { throw new Error('not implemented'); };\n" : 'exports.used = () => 42;\n');
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(res.result.completed, ['T1']);
    assert.equal(n, 2);
    assert.match(String(seen[1]), /src\/used\.js:1 {2}\[substantive\] marcador "not implemented"/, 'the retry sees the stub with file:line');
  });
});
