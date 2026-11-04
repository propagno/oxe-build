"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCliAdapter = void 0;
exports.resolveExecutable = resolveExecutable;
exports.buildSpawnable = buildSpawnable;
exports.renderTranscript = renderTranscript;
exports.buildBridgePrompt = buildBridgePrompt;
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
const DEFAULT_TIMEOUT_MS = 5 * 60000;
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
/** Parse the model's reply into content + tool calls; null when it is not the expected JSON. */
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
        for (let attempt = 0; attempt <= retries; attempt++) {
            const prompt = buildBridgePrompt(opts.messages, opts.tools ?? [], attempt > 0);
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
    runOnce(prompt, timeoutMs) {
        const executable = this.executable();
        if (!executable)
            return Promise.reject(new Error(`${this.command} não encontrado no PATH`));
        const model = this.options.model ? ['--model', this.options.model] : [];
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
                if (code !== 0)
                    return reject(new Error(`claude exit ${code}: ${err.slice(0, 400)}`));
                let envelope;
                try {
                    envelope = JSON.parse(out);
                }
                catch {
                    return reject(new Error(`claude devolveu saída não-JSON: ${out.slice(0, 400)}`));
                }
                if (envelope.is_error)
                    return reject(new Error(`claude reportou erro: ${String(envelope.result ?? '').slice(0, 400)}`));
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
