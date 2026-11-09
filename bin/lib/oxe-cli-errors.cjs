'use strict';

/**
 * OXB-133: typed errors with a stable exit code. With `--json-errors` (or OXE_JSON_ERRORS=1) every failing command
 * prints ONE envelope line on stderr — `{ ok:false, kind, message, command, hint, exit }` — instead of the prose, and
 * exits with the code of its kind. Without the flag nothing changes. Catalog: docs/cli-errors.md.
 */

const KINDS = Object.freeze({
  internal: 1,
  usage: 2,
  validation: 3,
  not_found: 4,
  conflict: 5,
  gate_failed: 6,
  environment: 7,
});

const HINTS = {
  usage: 'veja oxe-cc <comando> --help',
  validation: 'corrija a entrada indicada e rode de novo',
  not_found: 'confira o caminho, o id ou rode oxe-cc init-oxe',
  conflict: 'o estado já mudou; leia o status e decida',
  gate_failed: 'o comando rodou e reprovou: veja o relatório',
  environment: 'a máquina, não o código: ferramenta, rede, memória ou permissão',
  internal: 'falha inesperada: rode de novo com --debug e reporte',
};

// eslint-disable-next-line no-control-regex
const strip = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*(✗|FAIL|x)\s*/u, '').trim();

/** The kind of a failure from its message (the CLI's own wording). */
function classify(message, code) {
  const m = strip(message).toLowerCase();
  if (!m && code) return 'gate_failed';
  if (/opção desconhecida|unknown option|^use: |uso: |informe --|exige --|argumento|subcomando/.test(m)) return 'usage';
  if (/não encontrad[oa] no path|enoent|eacces|eperm|memória|memory|rede|network|econn|timed? ?out|permiss/.test(m)) return 'environment';
  if (/não existe|não encontrad|not found|sem \.oxe|sem plan|inexistente|desconhecid[ao]/.test(m)) return 'not_found';
  if (/já existe|já foi|conflit|em uso|lock|outra execução|stale|mudou depois/.test(m)) return 'conflict';
  if (/inválid|recusad|precisa|deve |obrigatóri|exige|schema|formato/.test(m)) return 'validation';
  if (/reprov|falhou|failed|bloque|blocked|gate|divergênc/.test(m)) return 'gate_failed';
  return code ? 'gate_failed' : 'internal';
}

function envelope(kind, message, command) {
  return { ok: false, kind, message: strip(message).split(/\r?\n/)[0].slice(0, 500), detail: strip(message).split(/\r?\n/).slice(1).join('\n').slice(0, 4000) || undefined, command, hint: HINTS[kind], exit: KINDS[kind] };
}

/**
 * Removes the flag from argv; when on, captures console.error and, at exit with a non-zero code, prints the envelope
 * and fixes the exit code to its kind.
 */
function install(argv, env = process.env) {
  const on = argv.includes('--json-errors') || env.OXE_JSON_ERRORS === '1';
  const filtered = argv.filter((a) => a !== '--json-errors');
  if (!on) return { on: false, argv: filtered };
  const command = filtered.slice(2).filter((a) => !a.startsWith('-')).slice(0, 2).join(' ') || 'oxe-cc';
  const captured = [];
  const origError = console.error;
  console.error = (...args) => { captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')); };
  let printed = false;
  const emit = (err) => {
    if (printed) return;
    printed = true;
    const code = process.exitCode || 0;
    const msg = err ? (err && err.message) || String(err) : captured.filter((l) => strip(l)).join('\n');
    const kind = err ? classify(msg, 1) === 'gate_failed' ? 'internal' : classify(msg, 1) : classify(msg, code);
    process.stderr.write(`${JSON.stringify(envelope(kind, msg || `exit ${code}`, command))}\n`);
    process.exitCode = KINDS[kind];
  };
  process.on('exit', (code) => { if (code && code !== 0) emit(null); });
  process.on('uncaughtException', (err) => { process.exitCode = 1; emit(err); process.exit(); });
  return { on: true, argv: filtered, restore: () => { console.error = origError; } };
}

module.exports = { KINDS, HINTS, classify, envelope, install };
