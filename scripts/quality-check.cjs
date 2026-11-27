#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
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

function parsePositiveInt(raw) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
  }
  return null;
}

function resolveTestConcurrency(explicit, options = {}) {
  const explicitCount = parsePositiveInt(explicit);
  if (explicitCount !== null) return explicitCount;

  const env = options.env || process.env;
  const envCount = parsePositiveInt(env.OXE_TEST_CONCURRENCY);
  if (envCount !== null) return envCount;

  const rawParallelism = options.parallelism !== undefined && options.parallelism !== null
    ? options.parallelism
    : (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
  const parsedParallelism = Number(rawParallelism);
  const parallelism = Number.isFinite(parsedParallelism) && parsedParallelism > 0
    ? Math.floor(parsedParallelism)
    : 1;
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    return Math.min(4, Math.max(1, parallelism));
  }
  return Math.max(1, Math.min(8, parallelism));
}

function parseShardSpec(shardSpec) {
  if (typeof shardSpec !== 'string') {
    throw new Error(`Shard inválido: "${shardSpec}". Use <k>/<total> com 1 <= k <= total.`);
  }
  const match = /^(\d+)\/(\d+)$/.exec(shardSpec.trim());
  if (!match) {
    throw new Error(`Shard inválido: "${shardSpec}". Use <k>/<total> com 1 <= k <= total.`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 1 || total < 1 || index > total) {
    throw new Error(`Shard inválido: "${shardSpec}". Exige inteiros positivos com 1 <= k <= total.`);
  }
  return { index, total, spec: `${index}/${total}` };
}

function selectTestShard(suites, shardSpec) {
  if (!Array.isArray(suites)) {
    throw new Error('suites deve ser um array.');
  }
  const { index, total } = parseShardSpec(shardSpec);
  const sorted = [...suites].sort();
  return sorted.filter((_, idx) => (idx % total) === (index - 1));
}

function parseSlowSuitesFromTap(tapText, limit = 10) {
  if (typeof tapText !== 'string' || tapText.trim() === '') return [];
  const maxEntries = limit === undefined ? 10 : Number(limit);
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) return [];

  const lines = tapText.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headerMatch = /^(?:ok|not ok)\s+\d+\s+-\s+(.+)$/.exec(lines[i]);
    if (!headerMatch) continue;
    const name = headerMatch[1].trim();
    if (i + 1 >= lines.length || !/^\s*---\s*$/.test(lines[i + 1])) continue;
    let durationMs = null;
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break;
      const durMatch = /^\s*duration_ms:\s*([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/.exec(lines[j]);
      if (durMatch) {
        const parsed = Number(durMatch[1]);
        if (Number.isFinite(parsed)) durationMs = parsed;
      }
    }
    i = j;
    if (durationMs !== null) {
      entries.push({ name, duration_ms: durationMs });
    }
  }

  entries.sort((a, b) => b.duration_ms - a.duration_ms);
  return entries.slice(0, Math.floor(maxEntries));
}

function parseTestRootArgs(argv = []) {
  if (!Array.isArray(argv)) {
    throw new Error('argv deve ser um array.');
  }
  const parsed = {
    concurrency: null,
    shard: null,
    timings: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      parsed.dryRun = true;
    } else if (token === '--concurrency' || token.startsWith('--concurrency=')) {
      const raw = token === '--concurrency' ? argv[++i] : token.slice('--concurrency='.length);
      const value = parsePositiveInt(raw);
      if (value === null) {
        throw new Error(`Valor inválido para --concurrency: "${raw}". Informe um inteiro positivo.`);
      }
      parsed.concurrency = value;
    } else if (token === '--shard' || token.startsWith('--shard=')) {
      const raw = token === '--shard' ? argv[++i] : token.slice('--shard='.length);
      if (raw === undefined) {
        throw new Error('Valor ausente para --shard. Use <k>/<total>.');
      }
      parsed.shard = parseShardSpec(raw).spec;
    } else if (token === '--timings') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        const count = parsePositiveInt(next);
        if (count === null) {
          throw new Error(`Valor inválido para --timings: "${next}". Informe um inteiro positivo.`);
        }
        parsed.timings = count;
        i += 1;
      } else {
        parsed.timings = 10;
      }
    } else if (token.startsWith('--timings=')) {
      const raw = token.slice('--timings='.length);
      const count = parsePositiveInt(raw);
      if (count === null) {
        throw new Error(`Valor inválido para --timings: "${raw}". Informe um inteiro positivo.`);
      }
      parsed.timings = count;
    } else {
      throw new Error(`Argumento desconhecido para test-root: "${token}".`);
    }
  }

  return parsed;
}

function testRoot(argv = []) {
  let options;
  try {
    options = parseTestRootArgs(argv);
  } catch (error) {
    console.error(`[quality] ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const allSuites = walk(path.join(ROOT, 'tests'), (file) => file.endsWith('.test.cjs'))
    .map(relative)
    .sort();
  if (allSuites.length === 0) throw new Error('Nenhum teste tests/*.test.cjs foi encontrado.');

  let suites = allSuites;
  if (options.shard) {
    try {
      suites = selectTestShard(allSuites, options.shard);
    } catch (error) {
      console.error(`[quality] ${error.message}`);
      process.exitCode = 2;
      return;
    }
  }

  const concurrency = resolveTestConcurrency(options.concurrency);
  const args = ['--test', `--test-concurrency=${concurrency}`, ...suites];

  if (options.dryRun) {
    const plannedArgs = options.timings
      ? ['--test', '--test-reporter=tap', `--test-concurrency=${concurrency}`, ...suites]
      : args;
    console.log(`[quality] dry-run (${suites.length}/${allSuites.length} suites, concurrency=${concurrency}${options.shard ? `, shard=${options.shard}` : ''}):`);
    console.log(`${process.execPath} ${plannedArgs.join(' ')}`);
    return;
  }

  if (options.timings !== null) {
    console.log(`[quality] executando ${suites.length} suites raiz (concurrency=${concurrency}, timings=top ${options.timings})`);
    const tapArgs = ['--test', '--test-reporter=tap', `--test-concurrency=${concurrency}`, ...suites];
    const result = spawnSync(process.execPath, tapArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    const slowest = parseSlowSuitesFromTap(result.stdout || '', options.timings);
    if (slowest.length > 0) {
      console.log(`\n[quality] top ${slowest.length} suites mais lentas:`);
      for (const entry of slowest) {
        console.log(`  ${entry.duration_ms.toFixed(1)} ms  ${entry.name}`);
      }
    }
    process.exitCode = result.status == null ? 1 : result.status;
    return;
  }

  console.log(`[quality] executando ${suites.length} suites raiz (concurrency=${concurrency})`);
  runNode(args);
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

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === 'test-root') testRoot(rest);
  else if (command === 'lint') lint();
  else if (command === 'format') format();
  else if (command === 'format-check') formatCheck();
  else {
    console.error('Uso: node scripts/quality-check.cjs <test-root|lint|format|format-check>');
    process.exitCode = 2;
  }
}

module.exports = {
  resolveTestConcurrency,
  selectTestShard,
  parseSlowSuitesFromTap,
  parseTestRootArgs,
  testRoot,
  main,
};

if (require.main === module) {
  main();
}
