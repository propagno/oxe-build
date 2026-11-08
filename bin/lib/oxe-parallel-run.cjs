#!/usr/bin/env node
'use strict';

/**
 * OXB-095: run shell commands concurrently from synchronous code (the plan lint / dry-verify API is sync).
 * `runParallel(jobs, opts)` spawns this file once (spawnSync); here a pool runs the jobs with at most `max` at a time
 * and starts a new one only when free memory ≥ `minFreeMb`. Each result: { id, code, output, timedOut, secs }.
 * Progress lines (`[n/N] … ok 12s`) go to stderr as jobs finish, so a long run is never silent.
 */

const { spawn, spawnSync } = require('child_process');
const os = require('os');

function runParallel(jobs, opts = {}) {
  if (!jobs.length) return [];
  const res = spawnSync(process.execPath, [__filename], {
    input: JSON.stringify({ jobs, max: opts.max || 2, minFreeMb: opts.minFreeMb || 0, cwd: opts.cwd || process.cwd(), timeoutMs: opts.timeoutMs || 180_000 }),
    encoding: 'utf8',
    env: opts.env || process.env,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', opts.progress === 'inherit' ? 'inherit' : 'pipe'],
    windowsHide: true,
  });
  if (res.status !== 0 || !res.stdout) throw new Error(`execução paralela falhou: ${res.stderr || res.error || res.status}`);
  const out = JSON.parse(res.stdout);
  if (typeof opts.onProgress === 'function' && res.stderr) for (const line of String(res.stderr).split(/\r?\n/).filter(Boolean)) opts.onProgress(line);
  return out;
}

async function pool(input) {
  const { jobs, max, minFreeMb, cwd, timeoutMs } = input;
  const results = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const isWin = process.platform === 'win32';
  const runOne = (i) => new Promise((resolve) => {
    const job = jobs[i];
    const started = Date.now();
    const child = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', job.command] : ['-c', job.command], { cwd, windowsHide: true, windowsVerbatimArguments: isWin, env: process.env });
    let output = '';
    const cap = (d) => { output += d; if (output.length > 8 * 1024 * 1024) output = output.slice(-4 * 1024 * 1024); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* */ } }, job.timeoutMs || timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - started) / 1000);
      results[i] = { id: job.id, code: timedOut ? null : code, output, timedOut, secs };
      done += 1;
      process.stderr.write(`[${done}/${jobs.length}] ${job.label || job.command.slice(0, 70)} ... ${timedOut ? 'timeout' : code === 0 ? 'exit 0' : `exit ${code}`} ${secs}s\n`);
      resolve();
    });
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const worker = async () => {
    while (next < jobs.length) {
      // memory gate: a new process only with enough free memory (the first always starts)
      while (minFreeMb && done < next && os.freemem() / (1024 * 1024) < minFreeMb) await wait(250);
      if (next >= jobs.length) break; // another worker took the last job while this one waited
      const i = next;
      next += 1;
      await runOne(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(max, jobs.length)) }, worker));
  return results;
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', async () => {
    const results = await pool(JSON.parse(raw));
    process.stdout.write(JSON.stringify(results));
  });
}

module.exports = { runParallel };
