'use strict';

/**
 * OXB-162: runs a long project command (promote's `npm run pr:ready`, 10+ min) and prints progress lines on stderr so a
 * caller can tell it is alive: each npm script that starts (`> pkg@x lint`) closes the previous one
 * (`pr:ready: lint ok · ▶ typecheck`), plus a heartbeat with the elapsed time. The result goes to stdout as JSON
 * ({ status, tail, timed_out }) for the parent's spawnSync.
 *
 * Usage (internal): node oxe-progress-run.cjs <label> <timeoutMs> <heartbeatMs> -- <command…>
 */

const { spawn, spawnSync } = require('child_process');

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** The npm script a banner line starts (`> name@1.0.0 lint`), or null. */
function scriptOfBanner(line) {
  const m = /^> (?:@?[^\s@]+(?:\/[^\s@]+)?@\S+) (\S+)\s*$/.exec(String(line).trim());
  return m ? m[1] : null;
}

function main(argv) {
  const sep = argv.indexOf('--');
  const [label, timeoutRaw, heartbeatRaw] = argv.slice(0, sep);
  const command = argv.slice(sep + 1).join(' ');
  const timeoutMs = Number(timeoutRaw) || 1_800_000;
  const heartbeatMs = Number(heartbeatRaw) || 60_000;
  const started = Date.now();
  const say = (msg) => process.stderr.write(`  ${label}: ${msg}\n`);
  const chunks = [];
  let size = 0;
  let pending = '';
  let current = null;
  let currentAt = started;
  const done = [];
  const onLine = (line) => {
    const script = scriptOfBanner(line);
    if (!script || script === label) return;
    if (current) done.push(current);
    say(`${current ? `${current} ok (${fmt(Date.now() - currentAt)}) · ` : ''}▶ ${script}`);
    current = script;
    currentAt = Date.now();
  };
  const onData = (buf) => {
    const text = buf.toString('utf8');
    if (size < 8 * 1024 * 1024) { chunks.push(text); size += text.length; }
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const l of lines) onLine(l);
  };
  say(`rodando \`${command}\``);
  const child = spawn(command, { shell: true, cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let timedOut = false;
  const kill = () => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* */ } } }
  };
  const timer = setTimeout(() => { timedOut = true; say(`tempo esgotado (${fmt(timeoutMs)}) — encerrando`); kill(); }, timeoutMs);
  const beat = setInterval(() => say(`${current ? `${current} rodando há ${fmt(Date.now() - currentAt)} · ` : ''}total ${fmt(Date.now() - started)}`), heartbeatMs);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { kill(); process.exit(130); });
  child.on('close', (code) => {
    clearTimeout(timer);
    clearInterval(beat);
    if (pending) onLine(pending);
    const ok = code === 0 && !timedOut;
    say(`${current ? `${current} ${ok ? 'ok' : 'FALHOU'} · ` : ''}${ok ? 'verde' : 'VERMELHO'} em ${fmt(Date.now() - started)}`);
    const output = chunks.join('');
    process.stdout.write(JSON.stringify({ status: timedOut ? null : code, timed_out: timedOut, tail: output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n'), scripts: [...done, ...(current ? [current] : [])] }));
  });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { scriptOfBanner, fmt };
