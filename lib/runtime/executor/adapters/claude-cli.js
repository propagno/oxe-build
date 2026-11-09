"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCliAdapter = exports.DEFAULT_MAX_PROMPT_CHARS = void 0;
exports.fitTranscript = fitTranscript;
exports.resolveExecutable = resolveExecutable;
exports.buildSpawnable = buildSpawnable;
exports.renderTranscript = renderTranscript;
exports.buildBridgePrompt = buildBridgePrompt;
exports.cliFailure = cliFailure;
exports.parseBridgeReply = parseBridgeReply;
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const shell_argv_1 = require("../shell-argv");
/** One `claude -p` at a time per process: turns of parallel nodes queue instead of stacking CLI processes. */
let turnChain = Promise.resolve();
function singleFlight(work) {
    const next = turnChain.then(work, work);
    turnChain = next.catch(() => undefined);
    return next;
}
const CLAUDE_FLAGS = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config'];
/** OXB-153: one turn that writes a big module or a migration takes more than 5 min (F4-P1: 9 turns, then killed). */
const DEFAULT_TIMEOUT_MS = 20 * 60000;
/**
 * OXB-148: F2-T1's 2.29M-char prompt was ~1.37M tokens (≈1.7 chars/token for code + Portuguese). The window is 1M
 * tokens; 1.2M chars keeps a margin. Tool results older than the last few are elided from 600k chars on.
 */
exports.DEFAULT_MAX_PROMPT_CHARS = 1200000;
const ELIDE_FROM_CHARS = 600000;
const KEEP_RECENT_TOOL_RESULTS = 6;
/** Elides the oldest tool results (keeping the last few) until the conversation fits the soft budget. */
function fitTranscript(messages, hardLimit = exports.DEFAULT_MAX_PROMPT_CHARS) {
    const size = (ms) => ms.reduce((n, m) => n + String(m.content ?? '').length, 0);
    const soft = Math.min(ELIDE_FROM_CHARS, hardLimit);
    if (size(messages) <= soft)
        return messages;
    const out = messages.map((m) => ({ ...m }));
    const toolIdx = out.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
    const elidable = toolIdx.slice(0, Math.max(0, toolIdx.length - KEEP_RECENT_TOOL_RESULTS));
    for (const i of elidable) {
        if (size(out) <= soft)
            break;
        const len = String(out[i].content ?? '').length;
        if (len > 400)
            out[i].content = `[resultado antigo omitido para caber na janela: ${len} chars — leia de novo se precisar]`;
    }
    return out;
}
let callSeq = 0;
/** First matching executable on PATH (on Windows also tries .exe/.cmd/.bat), or null. */
function resolveExecutable(command, platform = process.platform, envPath = process.env.PATH ?? '') {
    if (command.includes('/') || command.includes('\\'))
        return fs_1.default.existsSync(command) ? command : null;
    const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    const delimiter = platform === 'win32' ? ';' : ':';
    for (const dir of envPath.split(delimiter).filter(Boolean)) {
        for (const ext of extensions) {
            const candidate = path_1.default.join(dir, command + ext);
            try {
                if (fs_1.default.statSync(candidate).isFile())
                    return candidate;
            }
            catch { /* not here */ }
        }
    }
    return null;
}
function quoteWindowsArg(arg) {
    if (arg === '')
        return '""';
    return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
/** `.cmd`/`.bat` shims need cmd.exe; everything else is spawned directly (no shell, no re-quoting). */
function buildSpawnable(executable, args, platform = process.platform) {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
        const line = [quoteWindowsArg(executable), ...args.map(quoteWindowsArg)].join(' ');
        return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
    }
    return { file: executable, args, windowsVerbatimArguments: false };
}
function renderTranscript(messages) {
    return messages
        .map((m) => {
        if (m.role === 'tool')
            return `### TOOL RESULT (${m.name}, id=${m.tool_call_id})\n${m.content ?? ''}`;
        if (m.role === 'assistant') {
            const calls = (m.tool_calls ?? []).map((tc) => `CALL ${tc.function.name} ${tc.function.arguments}`).join('\n');
            return `### ASSISTANT\n${m.content ?? ''}\n${calls}`.trim();
        }
        return `### ${m.role.toUpperCase()}\n${m.content ?? ''}`;
    })
        .join('\n\n');
}
function buildBridgePrompt(messages, tools = [], retryHint = false) {
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
const CONTEXT_RE = /prompt is too long|too many tokens|context (window|length)|input is too long|maximum context|exceeds? the (model'?s? )?(context|token)/i;
const QUOTA_RE = /usage limit|rate.?limit|limit reached|quota|credit balance|overloaded|resets? (at|in)|try again (later|in)|429/i;
function cliFailure(input) {
    const env = input.envelope;
    const subtype = env && typeof env.subtype === 'string' ? env.subtype : null;
    const result = env ? String(env.result ?? '') : '';
    const stdoutTail = env ? '' : String(input.stdout || '').trim().slice(-400);
    const stderr = String(input.stderr || '').trim().slice(0, 400);
    const text = [subtype, result, stdoutTail, stderr].filter(Boolean).join(' · ');
    const kind = CONTEXT_RE.test(text) ? 'context' : QUOTA_RE.test(text) ? 'quota' : subtype === 'error_max_turns' ? 'llm' : 'env';
    const parts = [
        `claude exit ${input.code ?? '?'}`,
        subtype ? `subtype=${subtype}` : null,
        result ? `result=${result.slice(0, 400)}` : null,
        stdoutTail ? `stdout=${stdoutTail}` : null,
        stderr ? `stderr=${stderr}` : null,
        input.promptChars ? `prompt=${input.promptChars} chars (~${Math.round(input.promptChars / 4)} tokens)` : null,
        `kind=${kind}`,
    ].filter(Boolean);
    const error = new Error(parts.join(' · '));
    error.kind = kind;
    error.costUsd = env && typeof env.total_cost_usd === 'number' ? env.total_cost_usd : 0;
    error.subtype = subtype;
    error.exitCode = input.code;
    return error;
}
function parseBridgeReply(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object')
        return null;
    const obj = parsed;
    if (obj.tool_calls !== undefined && !Array.isArray(obj.tool_calls))
        return null;
    const seq = ++callSeq;
    const calls = (Array.isArray(obj.tool_calls) ? obj.tool_calls : [])
        .filter((c) => Boolean(c) && typeof c.name === 'string')
        .map((c, index) => ({
        id: `call_${seq}_${index}`,
        type: 'function',
        function: {
            name: c.name,
            arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
        },
    }));
    return { content: typeof obj.content === 'string' ? obj.content : '', tool_calls: calls };
}
class ClaudeCliAdapter {
    constructor(options = {}) {
        this.options = options;
        this.id = 'claude';
        this.requiresApiKey = false;
    }
    get command() {
        return this.options.command || process.env.OXE_CLAUDE_BIN || 'claude';
    }
    executable() {
        // With prefixArgs the command is an interpreter given by the caller (tests, wrappers).
        if (this.options.prefixArgs?.length)
            return this.command;
        return resolveExecutable(this.command);
    }
    detect() {
        const executable = this.executable();
        if (!executable) {
            return { available: false, version: null, binary: null, error: `${this.command} não encontrado no PATH` };
        }
        const spawnable = buildSpawnable(executable, [...(this.options.prefixArgs ?? []), '--version']);
        const res = (0, child_process_1.spawnSync)(spawnable.file, spawnable.args, {
            encoding: 'utf8',
            timeout: 15000,
            env: (0, shell_argv_1.childProcessEnv)(process.env, { allow: shell_argv_1.PROVIDER_CREDENTIAL_ENV }),
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
        let lastText = '';
        // OXB-148: the whole conversation is re-sent on every turn. Old tool results are elided first; a prompt still over
        // the hard limit fails fast as `context` without paying for a call that cannot fit.
        const messages = fitTranscript(opts.messages, this.options.maxPromptChars ?? exports.DEFAULT_MAX_PROMPT_CHARS);
        for (let attempt = 0; attempt <= retries; attempt++) {
            const prompt = buildBridgePrompt(messages, opts.tools ?? [], attempt > 0);
            if (prompt.length > (this.options.maxPromptChars ?? exports.DEFAULT_MAX_PROMPT_CHARS)) {
                throw cliFailure({ code: null, stdout: '', stderr: '', envelope: { is_error: true, subtype: 'prompt_over_limit', result: `Prompt is too long (estimated before the call, limit ${this.options.maxPromptChars ?? exports.DEFAULT_MAX_PROMPT_CHARS} chars)` }, promptChars: prompt.length });
            }
            const reply = await singleFlight(async () => {
                await this.waitForMemory();
                // rc.39: only the attempt's own model (tier/override) overrides the adapter. opts.model is the http provider's
                // default (claude-sonnet-4-6) and forced every turn of rc.37/rc.38 onto that old model.
                return this.runOnce(prompt, opts.timeoutMs, opts.attemptModel || null);
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
        return this.runOnceRaw(prompt, timeoutMs, modelOverride);
    }
    runOnceRaw(prompt, timeoutMs, modelOverride) {
        const executable = this.executable();
        if (!executable)
            return Promise.reject(new Error(`${this.command} não encontrado no PATH`));
        // OXB-131: the attempt's model (tier escalation) wins over the adapter's default.
        const chosen = modelOverride || this.options.model;
        const model = chosen ? ['--model', chosen] : [];
        const spawnable = buildSpawnable(executable, [
            ...(this.options.prefixArgs ?? []),
            ...CLAUDE_FLAGS,
            ...model,
            ...(this.options.extraArgs ?? []),
        ]);
        const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(spawnable.file, spawnable.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: (0, shell_argv_1.childProcessEnv)(process.env, { allow: shell_argv_1.PROVIDER_CREDENTIAL_ENV }),
                windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
            });
            let out = '';
            let err = '';
            const timer = setTimeout(() => {
                proc.kill();
                // OXB-153: a per-call timeout is its own class — the attempt continues instead of restarting from zero.
                const e = new Error(`claude -p excedeu ${limit} ms (timeout por chamada; executor.timeout_ms / --llm-timeout-ms)`);
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
                // OXB-148: `claude -p --output-format json` puts the real reason in STDOUT (is_error, subtype, result), also on a
                // non-zero exit with an empty stderr. F2's T1 failed 3/3 as "claude exit 1: " with nothing to act on.
                let envelope = null;
                try {
                    envelope = JSON.parse(out);
                }
                catch {
                    envelope = null;
                }
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
exports.ClaudeCliAdapter = ClaudeCliAdapter;
