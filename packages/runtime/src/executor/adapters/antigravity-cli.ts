import os from 'os';
import { CLI_FAILURE_QUOTA_RE } from '../quota-patterns';
import { spawn, spawnSync } from 'child_process';
import type { CompletionResponse, StreamCompletionOptions, ToolCall } from '../stream-completion';
import { childProcessEnv, PROVIDER_CREDENTIAL_ENV } from '../shell-argv';
import {
  buildBridgePrompt,
  buildSpawnable,
  DEFAULT_MAX_PROMPT_CHARS,
  fitTranscript,
  parseBridgeReply,
  resolveExecutable,
} from './claude-cli';
import type { CliFailure } from './claude-cli';
import type { AdapterDetection, ExecutorAdapter } from './types';

/**
 * OXB-197: `agy -p` (Antigravity CLI) as an execution adapter in bridge mode, on parity with `claude` and `http`.
 * Spawns one headless `agy` turn (`--output-format stream-json --disable-slash-commands`), parses NDJSON events
 * (`init`, `step_update`, tool-call events, and terminal `{ status: "SUCCESS" | "ERROR", response, usage }`),
 * and lets `LlmTaskExecutor` enforce scope guards, tool execution, and `ExecutorTurn` heartbeats.
 */
export interface AntigravityCliAdapterOptions {
  /** Executable name or path (default: `$OXE_AGY_BIN` || `$OXE_ANTIGRAVITY_BIN` || `agy`). */
  command?: string;
  /** Arguments placed before the agy flags — e.g. a node script shim in tests. */
  prefixArgs?: string[];
  /** `--model` for the CLI; null/empty keeps Antigravity's default model. */
  model?: string | null;
  /** `--mode` for `agy` (default `'plan'` so host mutating tools stay disabled; null omits `--mode`). */
  mode?: string | null;
  /** `--output-format` for `agy` (default `'stream-json'`). */
  outputFormat?: 'stream-json' | 'json';
  /** Per-turn timeout (default 20 min). */
  timeoutMs?: number;
  /** Extra attempts when the reply is not the expected JSON (default 2). */
  parseRetries?: number;
  extraArgs?: string[];
  /** Maximum prompt length passed directly via `-p <prompt>` before falling back to stdin (default 16_000 chars). */
  maxArgvChars?: number;
  /** Additional environment variable names allowed through `childProcessEnv` scrub. */
  allowEnv?: string[];
  /** Memory gate floor in MB before spawning `agy` (default `$OXE_EXECUTOR_MIN_FREE_MB` or 0). */
  minFreeMemoryMb?: number;
  memoryWaitMs?: number;
  freeMemory?: () => number;
  memoryPollMs?: number;
  /** Hard limit of a bridge prompt in chars (default 1.2M). */
  maxPromptChars?: number;
}

export interface ParsedAntigravityStream {
  events: Array<Record<string, unknown>>;
  conversationId: string | null;
  steps: Array<{ state: string; message: string }>;
  responseText: string;
  structuredOutput: Record<string, unknown> | null;
  toolCalls: ToolCall[];
  isError: boolean;
  subtype: string | null;
  errorMessage: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    thinkingTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_MAX_ARGV_CHARS = 16_000;
const STDIN_BRIDGE_INSTRUCTION = 'Follow the OXE bridge prompt on stdin and output ONLY the JSON object.';

const CONTEXT_RE = /prompt is too long|too many tokens|context (window|length)|input is too long|maximum context|exceeds? the (model'?s? )?(context|token)|token limit exceeded/i;
const QUOTA_RE = CLI_FAILURE_QUOTA_RE;

let agyTurnChain: Promise<unknown> = Promise.resolve();
function singleFlight<T>(work: () => Promise<T>): Promise<T> {
  const next = agyTurnChain.then(work, work);
  agyTurnChain = next.catch(() => undefined);
  return next;
}

let agyCallSeq = 0;

function normalizeToolCallEntry(raw: unknown, seq: number, index: number): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const fnObj = obj.function && typeof obj.function === 'object' ? (obj.function as Record<string, unknown>) : null;
  const name = typeof obj.name === 'string'
    ? obj.name
    : (fnObj && typeof fnObj.name === 'string' ? fnObj.name : null);
  if (!name) return null;
  const rawArgs = obj.arguments !== undefined
    ? obj.arguments
    : (obj.input !== undefined ? obj.input : (obj.args !== undefined ? obj.args : (fnObj ? fnObj.arguments : {})));
  const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
  const id = typeof obj.id === 'string' && obj.id ? obj.id : `agy_call_${seq}_${index}`;
  return {
    id,
    type: 'function',
    function: { name, arguments: argsStr },
  };
}

/**
 * Parses NDJSON (`stream-json`) or single-JSON (`json`) stdout emitted by `agy -p`.
 * Supports:
 *  - `{ type: "init", conversation_id }`
 *  - `{ type: "step_update", state, message }`
 *  - `{ type: "tool_call" | "tool_use", name, arguments | input, id? }` or `{ tool_calls: [...] }`
 *  - `{ status: "SUCCESS" | "ERROR", response, structured_output?, error?, usage? }` (`agy` v1.5+)
 *  - `{ type: "result", is_error, subtype?, result, total_cost_usd?, usage? }`
 */
export function parseAntigravityEvents(stdout: string): ParsedAntigravityStream {
  const events: Array<Record<string, unknown>> = [];
  let conversationId: string | null = null;
  const steps: Array<{ state: string; message: string }> = [];
  let responseText = '';
  let structuredOutput: Record<string, unknown> | null = null;
  const toolCalls: ToolCall[] = [];
  let isError = false;
  let subtype: string | null = null;
  let errorMessage: string | null = null;
  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };

  const trimmed = String(stdout ?? '').trim();
  const lines = trimmed ? trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const parsedObjects: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    try {
      const val = JSON.parse(line);
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        parsedObjects.push(val as Record<string, unknown>);
      }
    } catch {
      // ignore non-JSON diagnostic lines when other valid JSON lines exist; whole-stdout fallback below handles multi-line JSON
    }
  }

  if (!parsedObjects.length && trimmed.startsWith('{')) {
    try {
      const whole = JSON.parse(trimmed);
      if (whole && typeof whole === 'object' && !Array.isArray(whole)) {
        parsedObjects.push(whole as Record<string, unknown>);
      }
    } catch {
      // leave parsedObjects empty; caller treats raw text or exit code accordingly
    }
  }

  const seq = ++agyCallSeq;
  for (const ev of parsedObjects) {
    events.push(ev);
    const type = typeof ev.type === 'string' ? ev.type : '';

    if (type === 'init' && typeof ev.conversation_id === 'string') {
      conversationId = ev.conversation_id;
    } else if (type === 'step_update') {
      steps.push({
        state: typeof ev.state === 'string' ? ev.state : '',
        message: typeof ev.message === 'string' ? ev.message : '',
      });
    } else if (type === 'tool_call' || type === 'tool_use') {
      const tc = normalizeToolCallEntry(ev, seq, toolCalls.length);
      if (tc) toolCalls.push(tc);
    } else if (type === 'error') {
      isError = true;
      errorMessage = typeof ev.error === 'string' ? ev.error : (typeof ev.message === 'string' ? ev.message : JSON.stringify(ev));
    }

    if (ev.usage && typeof ev.usage === 'object') {
      const u = ev.usage as Record<string, unknown>;
      if (typeof u.input_tokens === 'number') usage.promptTokens = u.input_tokens;
      else if (typeof u.prompt_tokens === 'number') usage.promptTokens = u.prompt_tokens;
      if (typeof u.output_tokens === 'number') usage.completionTokens = u.output_tokens;
      else if (typeof u.completion_tokens === 'number') usage.completionTokens = u.completion_tokens;
      if (typeof u.thinking_tokens === 'number') usage.thinkingTokens = u.thinking_tokens;
      if (typeof u.total_tokens === 'number') usage.totalTokens = u.total_tokens;
      if (typeof u.cost_usd === 'number') usage.costUsd = u.cost_usd;
    }
    if (typeof ev.total_cost_usd === 'number') {
      usage.costUsd = ev.total_cost_usd;
    }

    // Terminal envelope of `agy --output-format stream-json` / `json`
    if (typeof ev.status === 'string') {
      const statusUpper = ev.status.toUpperCase();
      if (statusUpper === 'ERROR' || statusUpper === 'FAILED') {
        isError = true;
        subtype = typeof ev.subtype === 'string' ? ev.subtype : statusUpper.toLowerCase();
        errorMessage = typeof ev.error === 'string'
          ? ev.error
          : (typeof ev.response === 'string' && ev.response ? ev.response : (typeof ev.message === 'string' ? ev.message : 'agy status=ERROR'));
      } else if (statusUpper === 'SUCCESS' || statusUpper === 'DONE' || statusUpper === 'OK') {
        if (typeof ev.response === 'string') responseText = ev.response;
        if (ev.structured_output && typeof ev.structured_output === 'object' && !Array.isArray(ev.structured_output)) {
          structuredOutput = ev.structured_output as Record<string, unknown>;
        }
      }
    }

    // Claude-compatible `{ type: "result", result, is_error }` envelope
    if (type === 'result') {
      if (typeof ev.subtype === 'string') subtype = ev.subtype;
      if (ev.is_error) {
        isError = true;
        errorMessage = typeof ev.result === 'string' && ev.result
          ? ev.result
          : (typeof ev.error === 'string' ? ev.error : 'agy is_error=true');
      } else if (typeof ev.result === 'string') {
        responseText = ev.result;
      }
    }

    // Direct bridge JSON object (`{"content": "...", "tool_calls": [...]}`) emitted as a line
    if (!type && ev.status === undefined && (Array.isArray(ev.tool_calls) || typeof ev.content === 'string')) {
      if (typeof ev.content === 'string' && !responseText) responseText = JSON.stringify(ev);
      if (Array.isArray(ev.tool_calls)) {
        for (const item of ev.tool_calls) {
          const tc = normalizeToolCallEntry(item, seq, toolCalls.length);
          if (tc) toolCalls.push(tc);
        }
      }
    }
  }

  if (structuredOutput && Array.isArray(structuredOutput.tool_calls)) {
    for (const item of structuredOutput.tool_calls) {
      const tc = normalizeToolCallEntry(item, seq, toolCalls.length);
      if (tc) toolCalls.push(tc);
    }
    if (!responseText) {
      responseText = JSON.stringify(structuredOutput);
    }
  }

  return {
    events,
    conversationId,
    steps,
    responseText,
    structuredOutput,
    toolCalls,
    isError,
    subtype,
    errorMessage,
    usage,
  };
}

export function agyFailure(input: {
  code: number | null;
  stdout: string;
  stderr: string;
  parsed?: ParsedAntigravityStream | null;
  promptChars?: number;
}): CliFailure {
  const parsed = input.parsed ?? null;
  const subtype = parsed?.subtype ?? null;
  const result = parsed?.errorMessage || parsed?.responseText || '';
  const stdoutTail = result ? '' : String(input.stdout || '').trim().slice(-400);
  const stderr = String(input.stderr || '').trim().slice(0, 400);
  const text = [subtype, result, stdoutTail, stderr].filter(Boolean).join(' · ');
  const kind: CliFailure['kind'] = CONTEXT_RE.test(text)
    ? 'context'
    : QUOTA_RE.test(text)
      ? 'quota'
      : subtype === 'error_max_turns'
        ? 'llm'
        : 'env';
  const parts = [
    `agy exit ${input.code ?? '?'}`,
    subtype ? `subtype=${subtype}` : null,
    result ? `result=${result.slice(0, 400)}` : null,
    stdoutTail ? `stdout=${stdoutTail}` : null,
    stderr ? `stderr=${stderr}` : null,
    input.promptChars ? `prompt=${input.promptChars} chars (~${Math.round(input.promptChars / 4)} tokens)` : null,
    `kind=${kind}`,
  ].filter(Boolean);
  const error = new Error(parts.join(' · ')) as CliFailure;
  error.kind = kind;
  error.costUsd = parsed?.usage.costUsd ?? 0;
  error.subtype = subtype;
  error.exitCode = input.code;
  return error;
}

export function buildAntigravityArgs(
  prompt: string,
  options: {
    prefixArgs?: string[];
    model?: string | null;
    mode?: string | null;
    outputFormat?: 'stream-json' | 'json';
    extraArgs?: string[];
    maxArgvChars?: number;
  } = {},
): { args: string[]; stdinPrompt: string | null } {
  const format = options.outputFormat || 'stream-json';
  const mode = options.mode === undefined ? 'plan' : options.mode;
  const maxArgv = options.maxArgvChars ?? DEFAULT_MAX_ARGV_CHARS;
  const useStdin = prompt.length > maxArgv;
  const promptArg = useStdin ? STDIN_BRIDGE_INSTRUCTION : prompt;
  const args = [
    ...(options.prefixArgs ?? []),
    '--output-format',
    format,
    '--disable-slash-commands',
    ...(mode ? ['--mode', mode] : []),
    ...(options.model ? ['--model', options.model] : []),
    ...(options.extraArgs ?? []),
    '-p',
    promptArg,
  ];
  return { args, stdinPrompt: useStdin ? prompt : null };
}

export class AntigravityCliAdapter implements ExecutorAdapter {
  readonly id = 'antigravity' as const;
  readonly requiresApiKey = false;

  constructor(private readonly options: AntigravityCliAdapterOptions = {}) {}

  private get command(): string {
    return this.options.command || process.env.OXE_AGY_BIN || process.env.OXE_ANTIGRAVITY_BIN || 'agy';
  }

  private get allowedEnv(): string[] {
    return [...PROVIDER_CREDENTIAL_ENV, ...(this.options.allowEnv ?? [])];
  }

  private executable(): string | null {
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
      env: childProcessEnv(process.env, { allow: this.allowedEnv }),
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
    let promptTokens = 0;
    let completionTokens = 0;
    let lastText = '';
    const maxChars = this.options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
    const messages = fitTranscript(opts.messages, maxChars);

    for (let attempt = 0; attempt <= retries; attempt++) {
      const prompt = buildBridgePrompt(messages, opts.tools ?? [], attempt > 0);
      if (prompt.length > maxChars) {
        throw agyFailure({
          code: null,
          stdout: '',
          stderr: '',
          parsed: {
            events: [],
            conversationId: null,
            steps: [],
            responseText: '',
            structuredOutput: null,
            toolCalls: [],
            isError: true,
            subtype: 'prompt_over_limit',
            errorMessage: `Prompt is too long (estimated before the call, limit ${maxChars} chars)`,
            usage: { promptTokens: 0, completionTokens: 0, thinkingTokens: 0, totalTokens: 0, costUsd: 0 },
          },
          promptChars: prompt.length,
        });
      }

      const parsedStream = await singleFlight(async () => {
        await this.waitForMemory();
        return this.runOnce(prompt, opts.timeoutMs, opts.attemptModel || null);
      });

      costUsd += parsedStream.usage.costUsd;
      promptTokens += parsedStream.usage.promptTokens;
      completionTokens += parsedStream.usage.completionTokens;
      lastText = parsedStream.responseText;

      const parsedBridge = parseBridgeReply(parsedStream.responseText);
      if (parsedBridge) {
        return {
          content: parsedBridge.content,
          tool_calls: parsedBridge.tool_calls,
          finish_reason: parsedBridge.tool_calls.length ? 'tool_calls' : 'stop',
          usage: {
            input_tokens: promptTokens || undefined,
            output_tokens: completionTokens || undefined,
            cost_usd: costUsd,
          },
        };
      }

      if (parsedStream.toolCalls.length > 0) {
        const structuredContent = parsedStream.structuredOutput && typeof parsedStream.structuredOutput.content === 'string'
          ? parsedStream.structuredOutput.content
          : '';
        return {
          content: structuredContent,
          tool_calls: parsedStream.toolCalls,
          finish_reason: 'tool_calls',
          usage: {
            input_tokens: promptTokens || undefined,
            output_tokens: completionTokens || undefined,
            cost_usd: costUsd,
          },
        };
      }
    }

    return {
      content: lastText,
      tool_calls: [],
      finish_reason: 'stop',
      usage: {
        input_tokens: promptTokens || undefined,
        output_tokens: completionTokens || undefined,
        cost_usd: costUsd,
      },
    };
  }

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

  private runOnce(prompt: string, timeoutMs?: number, modelOverride?: string | null): Promise<ParsedAntigravityStream> {
    const executable = this.executable();
    if (!executable) return Promise.reject(new Error(`${this.command} não encontrado no PATH`));
    const chosen = modelOverride || this.options.model || null;
    const built = buildAntigravityArgs(prompt, {
      prefixArgs: this.options.prefixArgs,
      model: chosen,
      mode: this.options.mode,
      outputFormat: this.options.outputFormat,
      extraArgs: this.options.extraArgs,
      maxArgvChars: this.options.maxArgvChars,
    });
    const spawnable = buildSpawnable(executable, built.args);
    const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const proc = spawn(spawnable.file, spawnable.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childProcessEnv(process.env, { allow: this.allowedEnv }),
        windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        proc.kill();
        const e = new Error(`agy -p excedeu ${limit} ms (timeout por chamada; executor.timeout_ms / --llm-timeout-ms)`) as Error & { kind: string; costUsd: number };
        e.kind = 'timeout';
        e.costUsd = 0;
        reject(e);
      }, limit);
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.stderr.on('data', (chunk) => { err += chunk; });
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        const parsed = parseAntigravityEvents(out);
        if (code !== 0 || parsed.isError || (!parsed.events.length && !out.trim())) {
          return reject(agyFailure({ code, stdout: out, stderr: err, parsed, promptChars: prompt.length }));
        }
        if (!parsed.events.length) {
          // Plain text fallback when shim/CLI writes raw bridge JSON without NDJSON envelope
          parsed.responseText = out;
        }
        resolve(parsed);
      });
      if (built.stdinPrompt !== null) {
        proc.stdin.end(built.stdinPrompt);
      } else {
        proc.stdin.end();
      }
    });
  }
}
