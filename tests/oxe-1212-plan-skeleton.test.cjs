'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const sk = require('../bin/lib/oxe-plan-skeleton.cjs');

// 1.21.2 — OXB-154 (rest): plan skeleton — stubs from the pack signatures so the frozen tests compile.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

describe('OXB-154: plan skeleton', () => {
  it('stubs per language with the task named in the TODO', () => {
    const t = { id: 'T3', title: 'fila' };
    assert.equal(sk.stub('kotlin', 'fun save(item: Item): Item', t), 'fun save(item: Item): Item = TODO("T3: fila")');
    assert.equal(sk.stub('kotlin', 'fun clear()', t), 'fun clear() { TODO("T3: fila") }');
    assert.match(sk.stub('ts', 'function save(item: Item): Item', t), /^export function save\(item: Item\): Item \{\n  throw new Error\('TODO T3: fila'\);\n\}$/);
    assert.match(sk.stub('python', 'def save(item)', t), /def save\(item\):\n    raise NotImplementedError\("T3: fila"\)/);
    assert.match(sk.stub('java', 'public int size()', t), /public int size\(\) \{\n    throw new UnsupportedOperationException\("TODO T3: fila"\);/);
    assert.match(sk.stub('kotlin', 'interface QueueStore', t), /^interface QueueStore \{\n  \/\/ TODO T3: fila\n\}$/);
  });

  it('writes the stubs of pending tasks only where missing; reports symbols without a signature; the TS stub compiles-in as a module', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sk-'));
    dirs.push(dir);
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T3', title: 'fila', wave: 1, files: ['app/src/main/kotlin/com/oxe/Queue.kt', 'src/queue.js'], acceptance: ['A1'], verify: { commands: ['x'] } },
      { id: 'T4', title: 'feito', wave: 1, done: true, files: ['src/done.js'], acceptance: ['A1'], verify: { commands: ['x'] } },
    ] }));
    write(dir, '.oxe/IMPLEMENTATION-PACK.json', JSON.stringify({ tasks: [
      { id: 'T3', symbols: [
        { name: 'enqueue', path: 'app/src/main/kotlin/com/oxe/Queue.kt', signature: 'fun enqueue(item: String): Int' },
        { name: 'drain', path: 'src/queue.js', signature: 'function drain(n)' },
        { name: 'existing', path: 'src/queue.js', signature: 'function existing()' },
        { name: 'semAssinatura', path: 'src/queue.js' },
      ] },
      { id: 'T4', symbols: [{ name: 'done', path: 'src/done.js', signature: 'function done()' }] },
    ] }));
    write(dir, 'src/queue.js', 'export function existing() { return 1; }\n');
    const dry = op.runtimePlanSkeleton(dir, null, { dryRun: true });
    assert.deepEqual(dry.written, []);
    assert.deepEqual(dry.planned.map((f) => [f.path, f.stubs]), [['app/src/main/kotlin/com/oxe/Queue.kt', ['T3:enqueue']], ['src/queue.js', ['T3:drain']]]);
    assert.match(dry.missing_signature[0], /T3: semAssinatura \(src\/queue\.js\) sem signature no pack/);
    const r = spawnSync(process.execPath, [CLI, 'plan', 'skeleton', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const kt = fs.readFileSync(path.join(dir, 'app/src/main/kotlin/com/oxe/Queue.kt'), 'utf8');
    assert.match(kt, /^package com\.oxe\n\nfun enqueue\(item: String\): Int = TODO\("T3: fila"\)/);
    const js = fs.readFileSync(path.join(dir, 'src/queue.js'), 'utf8');
    assert.match(js, /export function existing\(\) \{ return 1; \}[\s\S]*export function drain\(n\) \{\n  throw new Error\('TODO T3: fila'\);/);
    assert.ok(!fs.existsSync(path.join(dir, 'src/done.js')), 'a done task is not stubbed');
    const again = op.runtimePlanSkeleton(dir, null, {});
    assert.deepEqual(again.planned, [], 'idempotent: the symbols now exist');
  });
});
