#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['bin', 'lib', 'scripts'];
const JAVASCRIPT_DIRS = [...SOURCE_DIRS, 'tests', 'vscode-extension/src'];
const FORMAT_DIRS = [...JAVASCRIPT_DIRS, 'packages/runtime/src', 'packages/runtime/tests'];
const FORMAT_CONFIGS = [
  'package.json',
  'eslint.config.cjs',
  'vscode-extension/package.json',
  'packages/runtime/package.json',
  'packages/runtime/tsconfig.json',
  'packages/runtime/tsconfig.test.json',
];
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'coverage', 'dist-tests']);

function walk(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, predicate, files);
    else if (predicate(target)) files.push(target);
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
}

function testRoot() {
  const tests = walk(path.join(ROOT, 'tests'), (file) => file.endsWith('.test.cjs')).sort();
  if (tests.length === 0) throw new Error('Nenhum teste tests/*.test.cjs foi encontrado.');
  console.log(`[quality] executando ${tests.length} suites raiz`);
  runNode(['--test', ...tests.map(relative)]);
}

function lint() {
  const files = JAVASCRIPT_DIRS.flatMap((dir) =>
    walk(path.join(ROOT, dir), (file) => JS_EXTENSIONS.has(path.extname(file)))
  ).filter((file) => !relative(file).startsWith('lib/runtime/')).sort();
  const eslint = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const eslintResult = spawnSync(process.execPath, [eslint, ...files.map(relative)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (eslintResult.error) throw eslintResult.error;
  if (eslintResult.status !== 0) {
    process.exitCode = eslintResult.status || 1;
    return;
  }

  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const typeResult = spawnSync(process.execPath, [
    tsc,
    '--project',
    path.join(ROOT, 'packages', 'runtime', 'tsconfig.json'),
    '--noEmit',
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (typeResult.error) throw typeResult.error;
  if (typeResult.status !== 0) {
    process.exitCode = typeResult.status || 1;
    return;
  }
  console.log(`[quality] lint: ESLint aprovou ${files.length} arquivos; runtime TypeScript aprovado`);
}

function formatFiles() {
  const files = FORMAT_DIRS.flatMap((dir) =>
    walk(path.join(ROOT, dir), (file) => JS_EXTENSIONS.has(path.extname(file)) || file.endsWith('.ts'))
  );
  files.push(...FORMAT_CONFIGS.map((file) => path.join(ROOT, file)));
  files.push(...walk(
    path.join(ROOT, '.github', 'workflows'),
    (file) => file.endsWith('.yml') || file.endsWith('.yaml')
  ));
  return [...new Set(files)].filter((file) => fs.existsSync(file)).sort();
}

function normalizedText(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join(eol)
    .replace(/(?:\r?\n)*$/, eol);
}

function formattedJson(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${JSON.stringify(JSON.parse(text), null, 2)}\n`.replace(/\n/g, eol);
}

function formatCheck() {
  const files = formatFiles();
  const failures = [];
  for (const file of files.sort()) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.endsWith('\n')) failures.push(`${relative(file)}: falta newline final`);
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) failures.push(`${relative(file)}:${index + 1}: whitespace final`);
    });
  }
  for (const file of files.filter((candidate) => candidate.endsWith('.json'))) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const canonical = formattedJson(text);
      if (text !== canonical) {
        failures.push(`${relative(file)}: JSON não está formatado com indentação de 2 espaços`);
      }
    } catch (error) {
      failures.push(`${relative(file)}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`[quality] format:check: ${files.length} arquivos consistentes`);
}

function format() {
  const files = formatFiles();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const normalized = file.endsWith('.json')
      ? formattedJson(text)
      : normalizedText(text);
    if (text !== normalized) fs.writeFileSync(file, normalized, 'utf8');
  }
  console.log(`[quality] format: ${files.length} arquivos normalizados`);
}

const command = process.argv[2];
if (command === 'test-root') testRoot();
else if (command === 'lint') lint();
else if (command === 'format') format();
else if (command === 'format-check') formatCheck();
else {
  console.error('Uso: node scripts/quality-check.cjs <test-root|lint|format|format-check>');
  process.exitCode = 2;
}
