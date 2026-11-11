"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntigravityCliAdapter = void 0;
exports.parseAntigravityEvents = parseAntigravityEvents;
exports.agyFailure = agyFailure;
exports.buildAntigravityArgs = buildAntigravityArgs;
const os_1 = __importDefault(require("os"));
const quota_patterns_1 = require("../quota-patterns");
const child_process_1 = require("child_process");
const shell_argv_1 = require("../shell-argv");
const claude_cli_1 = require("./claude-cli");
const DEFAULT_TIMEOUT_MS = 20 * 60000;
const DEFAULT_MAX_ARGV_CHARS = 16000;
const STDIN_BRIDGE_INSTRUCTION = 'Follow the OXE bridge prompt on stdin and output ONLY the JSON object.';
const CONTEXT_RE = /prompt is too long|too many tokens|context (window|length)|input is too long|maximum context|exceeds? the (model'?s? )?(context|token)|token limit exceeded/i;
const QUOTA_RE = quota_patterns_1.CLI_FAILURE_QUOTA_RE;
let agyTurnChain = Promise.resolve();
function singleFlight(work) {
    const next = agyTurnChain.then(work, work);
    agyTurnChain = next.catch(() => undefined);
    return next;
}
let agyCallSeq = 0;
function normalizeToolCallEntry(raw, seq, index) {
    if (!raw || typeof raw !== 'object')
        return null;
    const obj = raw;
    const fnObj = obj.function && typeof obj.function === 'object' ? obj.function : null;
    const name = typeof obj.name === 'string'
        ? obj.name
        : (fnObj && typeof fnObj.name === 'string' ? fnObj.name : null);
    if (!name)
        return null;
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
function parseAntigravityEvents(stdout) {
    const events = [];
    let conversationId = null;
    const steps = [];
    let responseText = '';
    let structuredOutput = null;
    const toolCalls = [];
    let isError = false;
    let subtype = null;
    let errorMessage = null;
    const usage = {
        promptTokens: 0,
        completionTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        costUsd: 0,
    };
    const trimmed = String(stdout ?? '').trim();
    const lines = trimmed ? trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    const parsedObjects = [];
    for (const line of lines) {
        try {
            const val = JSON.parse(line);
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                parsedObjects.push(val);
            }
        }
        catch {
            // ignore non-JSON diagnostic lines when other valid JSON lines exist; whole-stdout fallback below handles multi-line JSON
        }
    }
    if (!parsedObjects.length && trimmed.startsWith('{')) {
        try {
            const whole = JSON.parse(trimmed);
            if (whole && typeof whole === 'object' && !Array.isArray(whole)) {
                parsedObjects.push(whole);
            }
        }
        catch {
            // leave parsedObjects empty; caller treats raw text or exit code accordingly
        }
    }
    const seq = ++agyCallSeq;
    for (const ev of parsedObjects) {
        events.push(ev);
        const type = typeof ev.type === 'string' ? ev.type : '';
        if (type === 'init' && typeof ev.conversation_id === 'string') {
            conversationId = ev.conversation_id;
        }
        else if (type === 'step_update') {
            steps.push({
                state: typeof ev.state === 'string' ? ev.state : '',
                message: typeof ev.message === 'string' ? ev.message : '',
            });
        }
        else if (type === 'tool_call' || type === 'tool_use') {
            const tc = normalizeToolCallEntry(ev, seq, toolCalls.length);
            if (tc)
                toolCalls.push(tc);
        }
        else if (type === 'error') {
            isError = true;
            errorMessage = typeof ev.error === 'string' ? ev.error : (typeof ev.message === 'string' ? ev.message : JSON.stringify(ev));
        }
        if (ev.usage && typeof ev.usage === 'object') {
            const u = ev.usage;
            if (typeof u.input_tokens === 'number')
                usage.promptTokens = u.input_tokens;
            else if (typeof u.prompt_tokens === 'number')
                usage.promptTokens = u.prompt_tokens;
            if (typeof u.output_tokens === 'number')
                usage.completionTokens = u.output_tokens;
            else if (typeof u.completion_tokens === 'number')
                usage.completionTokens = u.completion_tokens;
            if (typeof u.thinking_tokens === 'number')
                usage.thinkingTokens = u.thinking_tokens;
            if (typeof u.total_tokens === 'number')
                usage.totalTokens = u.total_tokens;
            if (typeof u.cost_usd === 'number')
                usage.costUsd = u.cost_usd;
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
            }
            else if (statusUpper === 'SUCCESS' || statusUpper === 'DONE' || statusUpper === 'OK') {
                if (typeof ev.response === 'string')
                    responseText = ev.response;
                if (ev.structured_output && typeof ev.structured_output === 'object' && !Array.isArray(ev.structured_output)) {
                    structuredOutput = ev.structured_output;
                }
            }
        }
        // Claude-compatible `{ type: "result", result, is_error }` envelope
        if (type === 'result') {
            if (typeof ev.subtype === 'string')
                subtype = ev.subtype;
            if (ev.is_error) {
                isError = true;
                errorMessage = typeof ev.result === 'string' && ev.result
                    ? ev.result
                    : (typeof ev.error === 'string' ? ev.error : 'agy is_error=true');
            }
            else if (typeof ev.result === 'string') {
                responseText = ev.result;
            }
        }
        // Direct bridge JSON object (`{"content": "...", "tool_calls": [...]}`) emitted as a line
        if (!type && ev.status === undefined && (Array.isArray(ev.tool_calls) || typeof ev.content === 'string')) {
            if (typeof ev.content === 'string' && !responseText)
                responseText = JSON.stringify(ev);
            if (Array.isArray(ev.tool_calls)) {
                for (const item of ev.tool_calls) {
                    const tc = normalizeToolCallEntry(item, seq, toolCalls.length);
                    if (tc)
                        toolCalls.push(tc);
                }
            }
        }
    }
    if (structuredOutput && Array.isArray(structuredOutput.tool_calls)) {
        for (const item of structuredOutput.tool_calls) {
            const tc = normalizeToolCallEntry(item, seq, toolCalls.length);
            if (tc)
                toolCalls.push(tc);
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
function agyFailure(input) {
    const parsed = input.parsed ?? null;
    const subtype = parsed?.subtype ?? null;
    const result = parsed?.errorMessage || parsed?.responseText || '';
    const stdoutTail = result ? '' : String(input.stdout || '').trim().slice(-400);
    const stderr = String(input.stderr || '').trim().slice(0, 400);
    const text = [subtype, result, stdoutTail, stderr].filter(Boolean).join(' · ');
    const kind = CONTEXT_RE.test(text)
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
    const error = new Error(parts.join(' · '));
    error.kind = kind;
    error.costUsd = parsed?.usage.costUsd ?? 0;
    error.subtype = subtype;
    error.exitCode = input.code;
    return error;
}
function buildAntigravityArgs(prompt, options = {}) {
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
class AntigravityCliAdapter {
    constructor(options = {}) {
        this.options = options;
        this.id = 'antigravity';
        this.requiresApiKey = false;
    }
    get command() {
        return this.options.command || process.env.OXE_AGY_BIN || process.env.OXE_ANTIGRAVITY_BIN || 'agy';
    }
    get allowedEnv() {
        return [...shell_argv_1.PROVIDER_CREDENTIAL_ENV, ...(this.options.allowEnv ?? [])];
    }
    executable() {
        if (this.options.prefixArgs?.length)
            return this.command;
        return (0, claude_cli_1.resolveExecutable)(this.command);
    }
    detect() {
        const executable = this.executable();
        if (!executable) {
            return { available: false, version: null, binary: null, error: `${this.command} não encontrado no PATH` };
        }
        const spawnable = (0, claude_cli_1.buildSpawnable)(executable, [...(this.options.prefixArgs ?? []), '--version']);
        const res = (0, child_process_1.spawnSync)(spawnable.file, spawnable.args, {
            encoding: 'utf8',
            timeout: 15000,
            env: (0, shell_argv_1.childProcessEnv)(process.env, { allow: this.allowedEnv }),
            windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
        });
        if (res.status !== 0) {
            return { available: false, version: null, binary: executable, error: String(res.error ?? res.stderr ?? `exit ${res.status}`).slice(0, 300) };
        }
        return { available: true, version: String(res.stdout).trim().split(/\r?\n/)[0] || null, binary: executable, error: null };
    }
    createCompletion() {
        return (opts) => this.complete(opts);
    }
    async complete(opts) {
        const retries = this.options.parseRetries ?? 2;
        let costUsd = 0;
        let promptTokens = 0;
        let completionTokens = 0;
        let lastText = '';
        const maxChars = this.options.maxPromptChars ?? claude_cli_1.DEFAULT_MAX_PROMPT_CHARS;
        const messages = (0, claude_cli_1.fitTranscript)(opts.messages, maxChars);
        for (let attempt = 0; attempt <= retries; attempt++) {
            const prompt = (0, claude_cli_1.buildBridgePrompt)(messages, opts.tools ?? [], attempt > 0);
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
            const parsedBridge = (0, claude_cli_1.parseBridgeReply)(parsedStream.responseText);
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
    async waitForMemory() {
        const floorMb = this.options.minFreeMemoryMb ?? Number(process.env.OXE_EXECUTOR_MIN_FREE_MB || 0);
        if (!floorMb || floorMb <= 0)
            return;
        const read = this.options.freeMemory ?? (() => os_1.default.freemem());
        const poll = this.options.memoryPollMs ?? 5000;
        const deadline = Date.now() + (this.options.memoryWaitMs ?? 10 * 60000);
        for (;;) {
            const freeMb = read() / (1024 * 1024);
            if (freeMb >= floorMb)
                return;
            if (Date.now() >= deadline) {
                throw new Error(`memória livre ${Math.round(freeMb)} MB abaixo do mínimo ${floorMb} MB — executor pausado até o limite e desistiu`);
            }
            await new Promise((resolve) => setTimeout(resolve, poll));
        }
    }
    runOnce(prompt, timeoutMs, modelOverride) {
        const executable = this.executable();
        if (!executable)
            return Promise.reject(new Error(`${this.command} não encontrado no PATH`));
        const chosen = modelOverride || this.options.model || null;
        const built = buildAntigravityArgs(prompt, {
            prefixArgs: this.options.prefixArgs,
            model: chosen,
            mode: this.options.mode,
            outputFormat: this.options.outputFormat,
            extraArgs: this.options.extraArgs,
            maxArgvChars: this.options.maxArgvChars,
        });
        const spawnable = (0, claude_cli_1.buildSpawnable)(executable, built.args);
        const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(spawnable.file, spawnable.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: (0, shell_argv_1.childProcessEnv)(process.env, { allow: this.allowedEnv }),
                windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
            });
            let out = '';
            let err = '';
            const timer = setTimeout(() => {
                proc.kill();
                const e = new Error(`agy -p excedeu ${limit} ms (timeout por chamada; executor.timeout_ms / --llm-timeout-ms)`);
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
            }
            else {
                proc.stdin.end();
            }
        });
    }
}
exports.AntigravityCliAdapter = AntigravityCliAdapter;
