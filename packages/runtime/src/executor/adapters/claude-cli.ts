import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import type { ChatMessage, CompletionResponse, StreamCompletionOptions, ToolCall, ToolSchema } from '../stream-completion';
import { childProcessEnv, PROVIDER_CREDENTIAL_ENV } from '../shell-argv';
import type { AdapterDetection, ExecutorAdapter } from './types';

/**
 * `claude -p` (headless Claude Code) as the completion backend, in "bridge" mode: the CLI runs with
 * its own tools disabled and only decides the next step; the runtime executes the tool calls under
 * the node's allowlist and workspace containment. One short-lived process per turn — no HTTP server,
 * no port, no API key (the 1.17 benchmark lost a run when the external bridge process was killed).
 */
export interface ClaudeCliAdapterOptions {
  /** Executable name or path (default: `$OXE_CLAUDE_BIN` or `claude`). */
  command?: string;
  /** Arguments placed before the claude flags — e.g. a node script that stands in for the CLI. */
  prefixArgs?: string[];
  /** `--model` for the CLI; null/empty keeps the CLI default. */
  model?: string | null;
  /** Per-turn timeout (default 5 min). */
  timeoutMs?: number;
  /** Extra attempts when the reply is not the expected JSON (default 2). */
  parseRetries?: number;
  extraArgs?: string[];
  /**
   * Memory gate before every turn: wait until the machine has this much free memory (MB) before spawning
   * `claude -p`. Default `$OXE_EXECUTOR_MIN_FREE_MB` or 0 (off). Shared machines reap processes when memory runs out.
   */
  minFreeMemoryMb?: number;
  /** How long a turn waits for memory before failing the attempt as `env` (default 10 min). */
  memoryWaitMs?: number;
  /** Free memory reader (bytes); tests inject it. */
  freeMemory?: () => number;
  /** Poll interval of the memory gate (default 5 s). */
  memoryPollMs?: number;
  /** OXB-148: hard limit of a bridge prompt in chars (default 1.2M); over it the turn fails fast as `context`. */
  maxPromptChars?: number;
}

/** One `claude -p` at a time per process: turns of parallel nodes queue instead of stacking CLI processes. */
let turnChain: Promise<unknown> = Promise.resolve();
function singleFlight<T>(work: () => Promise<T>): Promise<T> {
  const next = turnChain.then(work, work);
  turnChain = next.catch(() => undefined);
  return next;
}

interface Spawnable {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

interface CliReply {
  text: string;
  costUsd: number;
}

const CLAUDE_FLAGS = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config'];
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/**
 * OXB-148: F2-T1's 2.29M-char prompt was ~1.37M tokens (≈1.7 chars/token for code + Portuguese). The window is 1M
 * tokens; 1.2M chars keeps a margin. Tool results older than the last few are elided from 600k chars on.
 */
export const DEFAULT_MAX_PROMPT_CHARS = 1_200_000;
const ELIDE_FROM_CHARS = 600_000;
const KEEP_RECENT_TOOL_RESULTS = 6;

/** Elides the oldest tool results (keeping the last few) until the conversation fits the soft budget. */
export function fitTranscript(messages: ChatMessage[], hardLimit: number = DEFAULT_MAX_PROMPT_CHARS): ChatMessage[] {
  const size = (ms: ChatMessage[]) => ms.reduce((n, m) => n + String(m.content ?? '').length, 0);
  const soft = Math.min(ELIDE_FROM_CHARS, hardLimit);
  if (size(messages) <= soft) return messages;
  const out = messages.map((m) => ({ ...m }));
  const toolIdx = out.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  const elidable = toolIdx.slice(0, Math.max(0, toolIdx.length - KEEP_RECENT_TOOL_RESULTS));
  for (const i of elidable) {
    if (size(out) <= soft) break;
    const len = String(out[i].content ?? '').length;
    if (len > 400) out[i].content = `[resultado antigo omitido para caber na janela: ${len} chars — leia de novo se precisar]`;
  }
  return out;
}
let callSeq = 0;

/** First matching executable on PATH (on Windows also tries .exe/.cmd/.bat), or null. */
export function resolveExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
  envPath: string = process.env.PATH ?? '',
): string | null {
  if (command.includes('/') || command.includes('\\')) return fs.existsSync(command) ? command : null;
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const dir of envPath.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/** `.cmd`/`.bat` shims need cmd.exe; everything else is spawned directly (no shell, no re-quoting). */
export function buildSpawnable(executable: string, args: string[], platform: NodeJS.Platform = process.platform): Spawnable {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const line = [quoteWindowsArg(executable), ...args.map(quoteWindowsArg)].join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
  }
  return { file: executable, args, windowsVerbatimArguments: false };
}

export function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') return `### TOOL RESULT (${m.name}, id=${m.tool_call_id})\n${m.content ?? ''}`;
      if (m.role === 'assistant') {
        const calls = (m.tool_calls ?? []).map((tc) => `CALL ${tc.function.name} ${tc.function.arguments}`).join('\n');
        return `### ASSISTANT\n${m.content ?? ''}\n${calls}`.trim();
      }
      return `### ${m.role.toUpperCase()}\n${m.content ?? ''}`;
    })
    .join('\n\n');
}

export function buildBridgePrompt(messages: ChatMessage[], tools: ToolSchema[] = [], retryHint = false): string {
  return [
    'You are acting as a tool-calling chat model for the OXE runtime.',
    'You CANNOT run tools yourself. Decide the next step and answer with ONLY one JSON object, no prose, no code fence:',
    '{"content": "<short text or empty>", "tool_calls": [{"name": "<tool>", "arguments": {...}}]}',
    'Use an empty tool_calls array only when you are done talking. Call finish_task when the task is complete.',
    'You may emit several tool_calls in one turn when they are independent.',
    ...(retryHint ? ['', 'Your previous reply was not a valid JSON object of that shape. Reply with the JSON object only.'] : []),
    '',
    'AVAILABLE TOOLS (JSON schema):',
    JSON.stringify(tools.map((t) => t.function), null, 1),
    '',
    'CONVERSATION SO FAR:',
    renderTranscript(messages),
  ].join('\n');
}

/** Parse the model's reply into content + tool calls; null when it is not the expected JSON. */
/** An adapter failure with what the CLI said, classified (context / quota / llm / env) and the cost already spent. */
export interface CliFailure extends Error { kind: 'context' | 'quota' | 'llm' | 'env'; costUsd: number; subtype: string | null; exitCode: number | null; }

const CONTEXT_RE = /prompt is too long|too many tokens|context (window|length)|input is too long|maximum context|exceeds? the (model'?s? )?(context|token)/i;
const QUOTA_RE = /usage limit|rate.?limit|limit reached|quota|credit balance|overloaded|resets? (at|in)|try again (later|in)|429/i;

export function cliFailure(input: { code: number | null; stdout: string; stderr: string; envelope: { result?: unknown; total_cost_usd?: unknown; subtype?: unknown; is_error?: unknown } | null; promptChars?: number }): CliFailure {
  const env = input.envelope;
  const subtype = env && typeof env.subtype === 'string' ? env.subtype : null;
  const result = env ? String(env.result ?? '') : '';
  const stdoutTail = env ? '' : String(input.stdout || '').trim().slice(-400);
  const stderr = String(input.stderr || '').trim().slice(0, 400);
  const text = [subtype, result, stdoutTail, stderr].filter(Boolean).join(' · ');
  const kind: CliFailure['kind'] = CONTEXT_RE.test(text) ? 'context' : QUOTA_RE.test(text) ? 'quota' : subtype === 'error_max_turns' ? 'llm' : 'env';
  const parts = [
    `claude exit ${input.code ?? '?'}`,
    subtype ? `subtype=${subtype}` : null,
    result ? `result=${result.slice(0, 400)}` : null,
    stdoutTail ? `stdout=${stdoutTail}` : null,
    stderr ? `stderr=${stderr}` : null,
    input.promptChars ? `prompt=${input.promptChars} chars (~${Math.round(input.promptChars / 4)} tokens)` : null,
    `kind=${kind}`,
  ].filter(Boolean);
  const error = new Error(parts.join(' · ')) as CliFailure;
  error.kind = kind;
  error.costUsd = env && typeof env.total_cost_usd === 'number' ? env.total_cost_usd : 0;
  error.subtype = subtype;
  error.exitCode = input.code;
  return error;
}

export function parseBridgeReply(text: string): { content: string; tool_calls: ToolCall[] } | null {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { content?: unknown; tool_calls?: unknown };
  if (obj.tool_calls !== undefined && !Array.isArray(obj.tool_calls)) return null;
  const seq = ++callSeq;
  const calls = (Array.isArray(obj.tool_calls) ? obj.tool_calls : [])
    .filter((c): c is { name: string; arguments?: unknown } => Boolean(c) && typeof (c as { name?: unknown }).name === 'string')
    .map((c, index): ToolCall => ({
      id: `call_${seq}_${index}`,
      type: 'function',
      function: {
        name: c.name,
        arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
      },
    }));
  return { content: typeof obj.content === 'string' ? obj.content : '', tool_calls: calls };
}

export class ClaudeCliAdapter implements ExecutorAdapter {
  readonly id = 'claude' as const;
  readonly requiresApiKey = false;

  constructor(private readonly options: ClaudeCliAdapterOptions = {}) {}

  private get command(): string {
    return this.options.command || process.env.OXE_CLAUDE_BIN || 'claude';
  }

  private executable(): string | null {
    // With prefixArgs the command is an interpreter given by the caller (tests, wrappers).
    if (this.options.prefixArgs?.length) return this.command;
    return resolveExecutable(this.command);
  }

  detect(): AdapterDetection {
    const executable = this.executable();
    if (!executable) {
      return { available: false, version: null, binary: null, error: `${this.command} não encontrado no PATH` };
    }
    const spawnable = buildSpawnable(executable, [...(this.options.prefixArgs ?? []), '--version']);
    const res = spawnSync(spawnable.file, spawnable.args, {
      encoding: 'utf8',
      timeout: 15_000,
      env: childProcessEnv(process.env, { allow: PROVIDER_CREDENTIAL_ENV }),
      windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
    });
    if (res.status !== 0) {
      return { available: false, version: null, binary: executable, error: String(res.error ?? res.stderr ?? `exit ${res.status}`).slice(0, 300) };
    }
    return { available: true, version: String(res.stdout).trim().split(/\r?\n/)[0] || null, binary: executable, error: null };
  }

  createCompletion() {
    return (opts: StreamCompletionOptions): Promise<CompletionResponse> => this.complete(opts);
  }

  private async complete(opts: StreamCompletionOptions): Promise<CompletionResponse> {
    const retries = this.options.parseRetries ?? 2;
    let costUsd = 0;
    let lastText = '';
    // OXB-148: the whole conversation is re-sent on every turn. Old tool results are elided first; a prompt still over
    // the hard limit fails fast as `context` without paying for a call that cannot fit.
    const messages = fitTranscript(opts.messages, this.options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS);
    for (let attempt = 0; attempt <= retries; attempt++) {
      const prompt = buildBridgePrompt(messages, opts.tools ?? [], attempt > 0);
      if (prompt.length > (this.options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS)) {
        throw cliFailure({ code: null, stdout: '', stderr: '', envelope: { is_error: true, subtype: 'prompt_over_limit', result: `Prompt is too long (estimated before the call, limit ${this.options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS} chars)` }, promptChars: prompt.length });
      }
      const reply = await singleFlight(async () => {
        await this.waitForMemory();
        return this.runOnce(prompt, opts.timeoutMs);
      });
      costUsd += reply.costUsd;
      lastText = reply.text;
      const parsed = parseBridgeReply(reply.text);
      if (parsed) {
        return {
          content: parsed.content,
          tool_calls: parsed.tool_calls,
          finish_reason: parsed.tool_calls.length ? 'tool_calls' : 'stop',
          usage: { cost_usd: costUsd },
        };
      }
    }
    // Still not JSON: hand the text back with no tool calls — the executor's no_tool_call rule fails
    // the attempt as `llm` instead of reporting a success.
    return { content: lastText, tool_calls: [], finish_reason: 'stop', usage: { cost_usd: costUsd } };
  }

  /** Pauses the executor while free memory is below the floor; gives up (env failure) after `memoryWaitMs`. */
  private async waitForMemory(): Promise<void> {
    const floorMb = this.options.minFreeMemoryMb ?? Number(process.env.OXE_EXECUTOR_MIN_FREE_MB || 0);
    if (!floorMb || floorMb <= 0) return;
    const read = this.options.freeMemory ?? (() => os.freemem());
    const poll = this.options.memoryPollMs ?? 5_000;
    const deadline = Date.now() + (this.options.memoryWaitMs ?? 10 * 60_000);
    for (;;) {
      const freeMb = read() / (1024 * 1024);
      if (freeMb >= floorMb) return;
      if (Date.now() >= deadline) {
        throw new Error(`memória livre ${Math.round(freeMb)} MB abaixo do mínimo ${floorMb} MB — executor pausado até o limite e desistiu`);
      }
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
  }

  private runOnce(prompt: string, timeoutMs?: number): Promise<CliReply> {
    return this.runOnceRaw(prompt, timeoutMs);
  }

  private runOnceRaw(prompt: string, timeoutMs?: number): Promise<CliReply> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error(`${this.command} não encontrado no PATH`));
    const model = this.options.model ? ['--model', this.options.model] : [];
    const spawnable = buildSpawnable(executable, [
      ...(this.options.prefixArgs ?? []),
      ...CLAUDE_FLAGS,
      ...model,
      ...(this.options.extraArgs ?? []),
    ]);
    const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const proc = spawn(spawnable.file, spawnable.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childProcessEnv(process.env, { allow: PROVIDER_CREDENTIAL_ENV }),
        windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`claude -p excedeu ${limit} ms`));
      }, limit);
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.stderr.on('data', (chunk) => { err += chunk; });
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        // OXB-148: `claude -p --output-format json` puts the real reason in STDOUT (is_error, subtype, result), also on a
        // non-zero exit with an empty stderr. F2's T1 failed 3/3 as "claude exit 1: " with nothing to act on.
        let envelope: { result?: unknown; total_cost_usd?: unknown; is_error?: unknown; subtype?: unknown } | null = null;
        try { envelope = JSON.parse(out); } catch { envelope = null; }
        if (code !== 0 || !envelope || envelope.is_error) {
          return reject(cliFailure({ code, stdout: out, stderr: err, envelope, promptChars: prompt.length }));
        }
        resolve({
          text: String(envelope.result ?? ''),
          costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : 0,
        });
      });
      proc.stdin.end(prompt);
    });
  }
}
