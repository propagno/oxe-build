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

  it('handles inline bodies on interface/class, generic constraints, and object return types without duplicate braces', () => {
    const t = { id: 'T5', title: 'tipos' };
    const rootWithTs = path.resolve(__dirname, '..');

    const ifaceWithBody = sk.stub('ts', 'export interface Opts { a: string; b: number }', t);
    assert.equal(ifaceWithBody, 'export interface Opts { a: string; b: number }');
    assert.equal(sk.checkStubSyntax('src/opts.ts', ifaceWithBody, { root: rootWithTs }).ok, true);

    // An interface containing a `type:` field must NOT be misread as a `type` alias (`= unknown`)
    const actionIface = sk.stub('ts', 'export interface Action { type: string; payload?: unknown }', t);
    assert.equal(actionIface, 'export interface Action { type: string; payload?: unknown }');
    assert.equal(sk.checkStubSyntax('src/action.ts', actionIface, { root: rootWithTs }).ok, true);

    const clsWithBody = sk.stub('ts', 'export class Store { get(): number { return 0; } }', t);
    assert.equal(clsWithBody, 'export class Store { get(): number { return 0; } }');
    assert.equal(sk.checkStubSyntax('src/store.ts', clsWithBody, { root: rootWithTs }).ok, true);

    // `{ id: string }` inside `<T extends ...>` is a constraint, not the interface body
    const genericIfaceNoBody = sk.stub('ts', 'export interface Filter<T extends { id: string }>', t);
    assert.equal(genericIfaceNoBody, 'export interface Filter<T extends { id: string }> {\n  // TODO T5: tipos\n}');
    assert.equal(sk.checkStubSyntax('src/filter.ts', genericIfaceNoBody, { root: rootWithTs }).ok, true);

    // `: { ok: boolean }` is a function return type, not a function body
    const objReturnFn = sk.stub('ts', 'export function check(): { ok: boolean }', t);
    assert.equal(objReturnFn, "export function check(): { ok: boolean } {\n  throw new Error('TODO T5: tipos');\n}");
    assert.equal(sk.checkStubSyntax('src/check.ts', objReturnFn, { root: rootWithTs }).ok, true);
  });

  it('generates valid typed const stubs in TS (`undefined as unknown as T`) and plain `undefined` in JS', () => {
    const t = { id: 'T6', title: 'constantes' };
    const rootWithTs = path.resolve(__dirname, '..');

    const tsConst = sk.stub('ts', 'export const X: T', t);
    assert.equal(tsConst, 'export const X: T = undefined as unknown as T;');
    assert.equal(sk.checkStubSyntax('src/constants.ts', tsConst, { root: rootWithTs }).ok, true);

    const tsFnTypeConst = sk.stub('ts', 'const HANDLER: (a: number) => boolean', t);
    assert.equal(tsFnTypeConst, 'export const HANDLER: (a: number) => boolean = undefined as unknown as (a: number) => boolean;');
    assert.equal(sk.checkStubSyntax('src/handler.ts', tsFnTypeConst, { root: rootWithTs }).ok, true);

    const jsConstFromTyped = sk.stub('js', 'export const X: T', t);
    assert.equal(jsConstFromTyped, 'export const X = undefined;');
    assert.equal(sk.checkStubSyntax('src/constants.js', jsConstFromTyped).ok, true);

    const jsPlainConst = sk.stub('js', 'const LIMIT', t);
    assert.equal(jsPlainConst, 'export const LIMIT = undefined;');
    assert.equal(sk.checkStubSyntax('src/limit.js', jsPlainConst).ok, true);
  });

  it('nameOf extracts symbol names for TS generics `parse<T>(`, Kotlin generics `fun <T : Comparable<T>>`, and `const` so existing symbols are not duplicated', () => {
    assert.equal(sk.nameOf('export function parse<T>(raw: string): T'), 'parse');
    assert.equal(sk.nameOf('export async function fetchAll<T extends { id: string }>(url: string): Promise<T[]>'), 'fetchAll');
    assert.equal(sk.nameOf('fun <T : Comparable<T>> sort(items: List<T>): List<T>'), 'sort');
    assert.equal(sk.nameOf('export const MAX_ITEMS: number'), 'MAX_ITEMS');
    assert.equal(sk.nameOf('export interface Opts { a: string }'), 'Opts');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sk-generic-'));
    dirs.push(dir);
    write(dir, 'src/parser.ts', 'export function parse<T>(raw: string): T {\n  return JSON.parse(raw) as T;\n}\n');
    const doc = {
      tasks: [
        { id: 'T1', title: 'parser', wave: 1, files: ['src/parser.ts'], acceptance: ['A1'], verify: { commands: ['x'] } },
        { id: 'T2', title: 'extra', wave: 2, files: ['src/parser.ts'], acceptance: ['A2'], verify: { commands: ['x'] } },
      ],
    };
    const pack = {
      tasks: [
        {
          id: 'T1',
          symbols: [
            // `name` omitted intentionally so `plan` relies on `nameOf(s.signature)`
            { path: 'src/parser.ts', signature: 'export function parse<T>(raw: string): T' },
            { path: 'src/parser.ts', signature: 'export function format<T>(val: T): string' },
          ],
        },
        {
          id: 'T2',
          symbols: [
            // Same missing symbol referenced in a later wave must not be emitted twice in the same file
            { path: 'src/parser.ts', signature: 'export function format<T>(val: T): string' },
          ],
        },
      ],
    };
    const planned = sk.plan(dir, doc, pack);
    assert.equal(planned.files.length, 1);
    assert.deepEqual(planned.files[0].stubs.map((s) => s.name), ['format'], 'existing `parse<T>` skipped and `format<T>` deduplicated');
    const rendered = sk.renderFile(dir, planned.files[0]);
    const syntax = sk.checkStubSyntax('src/parser.ts', rendered, { root: path.resolve(__dirname, '..') });
    assert.equal(syntax.ok, true, JSON.stringify(syntax));
  });

  it('checkStubSyntax catches broken JS/CJS/MJS/TS stubs and degrades to warning (not error) when project has no typescript', () => {
    const rootWithTs = path.resolve(__dirname, '..');

    // CJS via vm.Script
    assert.equal(sk.checkStubSyntax('src/ok.cjs', 'const x = 1;\nmodule.exports = { x };\n').ok, true);
    const badCjs = sk.checkStubSyntax('src/bad.cjs', 'export const x = 1;\n');
    assert.equal(badCjs.ok, false);
    assert.match(badCjs.errors[0], /^src\/bad\.cjs:1: SyntaxError:/);

    // MJS and JS via node --check / vm.Script
    assert.equal(sk.checkStubSyntax('src/ok.mjs', 'export const x = undefined;\n').ok, true);
    assert.equal(sk.checkStubSyntax('src/ok-esm.js', 'export function drain(n) {\n  throw new Error("TODO");\n}\n').ok, true);
    const badJs = sk.checkStubSyntax('src/bad.js', 'export const X: number {\n  throw new Error("TODO");\n}\n');
    assert.equal(badJs.ok, false);
    assert.match(badJs.errors[0], /^src\/bad\.js:1: SyntaxError:/);

    // TS/TSX via project's typescript transpileModule (syntax-only diagnostics)
    assert.equal(sk.checkStubSyntax('src/View.tsx', 'export function View() { return <div>ok</div>; }\n', { root: rootWithTs }).ok, true);

    const badTsIface = sk.checkStubSyntax(
      'src/bad-iface.ts',
      'export interface Action { type: string } = unknown;\n',
      { root: rootWithTs }
    );
    assert.equal(badTsIface.ok, false);
    assert.ok(badTsIface.errors.some((e) => /src\/bad-iface\.ts:1:.*TS\d+/.test(e)), JSON.stringify(badTsIface.errors));

    const badTsConst = sk.checkStubSyntax(
      'src/bad-const.ts',
      'export const MAX_ITEMS: number {\n  throw new Error("TODO");\n}\n',
      { root: rootWithTs }
    );
    assert.equal(badTsConst.ok, false);
    assert.ok(badTsConst.errors.some((e) => /src\/bad-const\.ts:1:.*TS\d+/.test(e)), JSON.stringify(badTsConst.errors));

    // TS project without typescript in node_modules -> warning, NOT error (ok: true, checked: false)
    const emptyProj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sk-nots-'));
    dirs.push(emptyProj);
    const noTs = sk.checkStubSyntax('src/no-ts.ts', 'export const X: T = undefined as unknown as T;\n', { root: emptyProj });
    assert.equal(noTs.ok, true);
    assert.equal(noTs.checked, false);
    assert.equal(noTs.errors.length, 0);
    assert.equal(noTs.warnings.length, 1);
    assert.match(noTs.warnings[0], /typescript não encontrado em node_modules/);
  });
});
