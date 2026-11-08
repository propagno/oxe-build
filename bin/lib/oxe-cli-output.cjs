'use strict';

/**
 * 1.21.2 (OXB-065): output for logs and machines.
 *
 * - Plain mode: when stdout is not a TTY (redirected to a log, read by an agent loop) or with `--plain`, status glyphs
 *   become ASCII words (OK, FAIL, BLOCKED…) and box drawing becomes ASCII. A reader that decodes with a legacy code
 *   page (pwsh `*>> log`) still finds "OK T3"; accents stay real UTF-8.
 * - `runtime execute --json`: one NDJSON line per task event, `{type:'task', task, attempt, status, cost_usd, failed_segment?}`.
 */

const PLAIN_GLYPHS = [
  [/[✓✔]/g, 'OK'],
  [/[✗✘❌]/g, 'FAIL'],
  [/⛔/g, 'BLOCKED'],
  [/↺/g, 'RETRY'],
  [/⚠️?/g, 'WARN'],
  [/[→⟶➜]/g, '->'],
  [/←/g, '<-'],
  [/…/g, '...'],
  [/[—–]/g, '-'],
  [/[━─═]+/g, (m) => '-'.repeat(m.length)],
  [/[│┃║]/g, '|'],
  [/[┌┐└┘├┤┬┴┼╭╮╰╯╔╗╚╝]/g, '+'],
  [/[▸▹›]/g, '>'],
  [/[•●○◆◇■□▶►]/g, '*'],
  // Whatever pictograph is left (emoji, arrows, dingbats) carries no meaning in a log: drop it.
  [/[←-⇿⌀-⏿①-➿⤀-⯿️]|[\u{1F000}-\u{1FAFF}]/gu, ''],
];

function toPlain(text) {
  let out = String(text);
  for (const [re, rep] of PLAIN_GLYPHS) out = out.replace(re, rep);
  return out;
}

/** Plain when forced (`OXE_PLAIN=1` / `--plain`) or when stdout is not a TTY, unless `OXE_PLAIN=0`. */
function isPlainMode({ env = process.env, argv = process.argv, isTTY = process.stdout.isTTY } = {}) {
  if (env.OXE_PLAIN === '1' || argv.includes('--plain')) return true;
  if (env.OXE_PLAIN === '0') return false;
  return isTTY !== true;
}

/** Rewrites what goes through `stream.write` with {@link toPlain}; always writes UTF-8 bytes. */
function installPlainWriter(stream) {
  const original = stream.write.bind(stream);
  stream.write = (chunk, encoding, cb) => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return original(Buffer.from(toPlain(text), 'utf8'), typeof encoding === 'function' ? encoding : cb);
    }
    return original(chunk, encoding, cb);
  };
  return () => { stream.write = original; };
}

/**
 * Turns runtime progress events into NDJSON task lines. `write(line)` receives one JSON document per call.
 * Statuses: running (attempt started), retry, completed, failed (attempts exhausted), blocked (gate/policy/external),
 * scope_violation.
 */
function createTaskNdjsonEmitter(write) {
  const state = new Map();
  return (event) => {
    if (!event) return;
    if (event.type === 'BudgetExhausted') {
      write(JSON.stringify({ type: 'budget_exhausted', reason: event.payload?.reason || null }));
      return;
    }
    const task = event.work_item_id || event.nodeId;
    if (!task) return;
    const st = state.get(task) || { attempt: 0, cost: 0, total: 0, failed_segment: null };
    state.set(task, st);
    const line = (status, extra = {}) => {
      const out = {
        type: 'task',
        task,
        attempt: st.attempt,
        status,
        cost_usd: Number(st.cost.toFixed(4)),
        total_cost_usd: Number(st.total.toFixed(4)),
      };
      if (st.failed_segment && (status === 'retry' || status === 'failed')) out.failed_segment = st.failed_segment;
      write(JSON.stringify({ ...out, ...extra }));
    };
    if (event.type === 'AttemptStarted') {
      st.attempt = Number(event.payload?.attempt_number) || st.attempt + 1;
      st.cost = 0;
      st.failed_segment = null;
      line('running');
    } else if (event.type === 'executor_usage' && typeof event.detail?.cost_usd === 'number') {
      st.cost += event.detail.cost_usd;
      st.total += event.detail.cost_usd;
    } else if (event.type === 'VerificationCompleted' && event.payload?.failed_segment) {
      st.failed_segment = event.payload.failed_segment;
    } else if (event.type === 'WorkItemCompleted') {
      line('completed', event.payload?.completed_by ? { completed_by: event.payload.completed_by } : {});
    } else if (event.type === 'RetryScheduled') {
      line('retry', { reason: event.payload?.reason || null });
    } else if (event.type === 'WorkItemBlocked') {
      // The final block after the attempts is a failure; a gate/policy/external block is not.
      const failedForGood = event.payload?.max_attempts != null;
      line(failedForGood ? 'failed' : 'blocked', { reason: event.payload?.failure_class || event.payload?.reason || null });
    } else if (event.type === 'ScopeViolation') {
      line('scope_violation', { paths: event.payload?.paths || [] });
    }
  };
}

module.exports = { toPlain, isPlainMode, installPlainWriter, createTaskNdjsonEmitter, PLAIN_GLYPHS };
