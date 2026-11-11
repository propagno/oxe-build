'use strict';

/**
 * OXB-094: batch vitest commands. F2's dry-verify had 318 commands (~2h): most were `vitest run <one file>` with the same
 * runner and flags, each paying vitest's start-up. Commands that share the runner prefix and flags become ONE process
 * with all the files; results are still reported per file (dry-verify reads vitest's JSON reporter).
 *
 * Only plain forms are batched: `[npx|pnpm|pnpm exec|npm exec --|yarn] vitest run [flags] <paths…>` where every
 * positional looks like a path and every flag is `--x`, `--x=y` or a known value flag. Anything else is left alone.
 */

const VALUE_FLAGS = new Set(['-t', '--testNamePattern', '-c', '--config', '--project', '--root', '-r', '--dir', '--environment', '--pool', '--reporter', '--outputFile', '--maxWorkers', '--minWorkers', '--shard', '--mode', '--testTimeout', '--hookTimeout', '--retry', '--bail', '--exclude']);
/** Flags that change WHICH tests or HOW they are reported per segment: never batched across different values. */
const PREFIX_RE = /^((?:npx\s+(?:--yes\s+)?|pnpm\s+(?:exec\s+)?|npm\s+exec\s+(?:--\s+)?|yarn\s+)?vitest)\s+(?:run\b|--run\b)\s*(.*)$/;
/**
 * F2 data: 28 commands were `npm run test:electron -- <file>` (vitest under Electron's node, the script passes the files
 * through). `npm run <script> -- <paths…>` / `pnpm run <script> <paths…>` batch the same way (key = the script).
 */
const SCRIPT_RE = /^((?:npm|pnpm|yarn)\s+(?:run\s+)?[\w:.-]+)\s+--\s+(.*)$/;

const looksLikePath = (t) => /[\\/]/.test(t) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(t) || /\.[cm]?[jt]sx?$/.test(t);

/** @returns {{ prefix: string, flags: string[], files: string[], key: string } | null} */
function parseVitest(segment) {
  const text = String(segment || '').trim();
  if (/["'`|<>;&$()]/.test(text.replace(/&&/g, ''))) return null; // quoting, pipes, env: leave alone
  let m = PREFIX_RE.exec(text);
  let prefixOut = null;
  if (m) prefixOut = `${m[1].replace(/\s+/g, ' ')} run`;
  else {
    const s = SCRIPT_RE.exec(text);
    if (!s || /^(npm|pnpm|yarn)\s+(run\s+)?(lint|typecheck|type-check|build|check)\b/.test(s[1])) return null;
    m = s;
    prefixOut = `${s[1].replace(/\s+/g, ' ')} --`;
  }
  const tokens = m[2].split(/\s+/).filter(Boolean);
  const flags = [];
  const files = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      if (t.includes('=')) { flags.push(t); continue; }
      if (VALUE_FLAGS.has(t)) {
        const v = tokens[i + 1];
        if (v == null || v.startsWith('-')) return null;
        flags.push(`${t}=${v}`);
        i += 1;
        continue;
      }
      flags.push(t);
      continue;
    }
    if (!looksLikePath(t)) return null;
    files.push(t.replace(/\\/g, '/'));
  }
  if (!files.length) return null;
  const prefix = prefixOut;
  return { prefix, flags, files, key: `${prefix} ${[...flags].sort().join(' ')}`.trim() };
}

const commandOf = (prefix, flags, files) => [prefix, ...files, ...flags].join(' ');

/** Top-level `&&` segments (quoted text is not split) — same rule as the dry-verify. */
function splitSegments(command) {
  const out = [];
  let current = '';
  let quote = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '&' && s[i + 1] === '&') { out.push(current.trim()); current = ''; i += 1; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * A task's verify with its vitest segments merged per key (first occurrence keeps its place). Same meaning: every file
 * must pass; one process per runner+flags instead of one per file.
 */
function batchVerifyCommand(command) {
  const segments = splitSegments(command);
  if (segments.length < 2) return command;
  const groups = new Map();
  const order = [];
  for (const seg of segments) {
    const v = parseVitest(seg);
    if (!v) { order.push({ raw: seg }); continue; }
    if (!groups.has(v.key)) { groups.set(v.key, { ...v, files: [] }); order.push({ key: v.key }); }
    const g = groups.get(v.key);
    for (const f of v.files) if (!g.files.includes(f)) g.files.push(f);
  }
  if (groups.size === 0 || [...groups.values()].every((g) => g.files.length < 2)) return command;
  return order.map((o) => (o.raw != null ? o.raw : commandOf(groups.get(o.key).prefix, groups.get(o.key).flags, groups.get(o.key).files))).join(' && ');
}

/** Applies batchVerifyCommand to each pending task of a parsed plan (graph and verify suite). */
function batchPlanVerifies(parsedPlan) {
  for (const task of (parsedPlan && parsedPlan.tasks) || []) {
    if (task.done || !task.verifyCommand) continue;
    const batched = batchVerifyCommand(task.verifyCommand);
    if (batched !== task.verifyCommand) {
      task.meta = { ...(task.meta || {}), verify_batched_from: task.verifyCommand };
      task.verifyCommand = batched;
    }
  }
  return parsedPlan;
}

/**
 * Per-file results of a vitest JSON report: relative path → { status, text } where text carries what classification
 * needs (the suite error or the failing assertions), prefixed with the file and a FAIL marker like the console output.
 */
function resultsByFile(report, projectRoot) {
  const path = require('path');
  const out = new Map();
  for (const r of (report && report.testResults) || []) {
    const rel = path.relative(projectRoot, r.name || '').replace(/\\/g, '/');
    const failures = (r.assertionResults || []).filter((a) => a.status === 'failed').flatMap((a) => [`× ${a.title}`, ...(a.failureMessages || [])]);
    const text = r.status === 'passed' ? '' : [`FAIL ${rel}`, r.message || '', ...failures].filter(Boolean).join('\n');
    out.set(rel, { status: r.status, text });
  }
  return out;
}

/** The results of a segment's files (a positional is a filter: it matches every result path containing it). */
function segmentResult(byFile, files) {
  const matched = [];
  for (const filter of files) {
    const norm = filter.replace(/^\.\//, '');
    const hits = [...byFile.entries()].filter(([rel]) => rel === norm || rel.includes(norm));
    if (!hits.length) return null; // unknown to the batch: the caller runs the segment alone
    matched.push(...hits);
  }
  const failed = matched.filter(([, r]) => r.status !== 'passed');
  return { code: failed.length ? 1 : 0, output: failed.map(([, r]) => r.text).join('\n') };
}

module.exports = { parseVitest, batchVerifyCommand, batchPlanVerifies, splitSegments, resultsByFile, segmentResult, commandOf };
