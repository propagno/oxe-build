"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrokCliAdapter = void 0;
exports.buildGrokArgs = buildGrokArgs;
exports.parseGrokStdout = parseGrokStdout;
exports.grokBridgeText = grokBridgeText;
exports.grokFailure = grokFailure;
exports.grokTurnOutcome = grokTurnOutcome;
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const shell_argv_1 = require("../shell-argv");
const quota_patterns_1 = require("../quota-patterns");
const claude_cli_1 = require("./claude-cli");
/**
 * Tools the bridge must not let Grok run. The OXE prompt names the same ids (`read_file`, `grep`,
 * `list_dir`), and the plan profile still offers its own set (`search_tool`, `use_tool`, …).
 * A denylist that skips a name Grok actually has makes the model call that tool, spend the one
 * turn, and exit `max_turn_requests`. The runtime owns the tool loop. A name Grok does not have only warns.
 */
const GROK_DISALLOWED_TOOLS = [
    'read_file',
    'grep',
    'list_dir',
    'search_replace',
    'write',
    'run_terminal_cmd',
    'run_terminal_command',
    'web_search',
    'web_fetch',
    'image_gen',
    'image_edit',
    'image_to_video',
    'reference_to_video',
    'task',
    'spawn_subagent',
    'Agent',
    'Delete',
    'StrReplace',
    'monitor',
    'workflow',
    'lsp',
    'AskQuestion',
    'ask_user_question',
    'CreatePlan',
    'SwitchMode',
    'TodoWrite',
    'todo_write',
    'enter_plan_mode',
    'exit_plan_mode',
    'send_feedback',
    'CallMcpTool',
    'search_tool',
    'use_tool',
].join(',');
/** Forces the bridge object in the same turn. Without it Grok answers by calling a native tool. */
const GROK_BRIDGE_SCHEMA = JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['content', 'tool_calls'],
    properties: {
        content: { type: 'string' },
        tool_calls: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'arguments'],
                properties: {
                    name: { type: 'string' },
                    arguments: { type: 'object' },
                },
            },
        },
    },
});
const DEFAULT_TIMEOUT_MS = 20 * 60000;
const BRIDGE_RULES = 'Reply with only one JSON object of the requested shape. Do not call tools. Do not edit files.';
let turnChain = Promise.resolve();
function singleFlight(work) {
    const next = turnChain.then(work, work);
    turnChain = next.catch(() => undefined);
    return next;
}
let promptSeq = 0;
const CONTEXT_RE = /prompt is too long|too many tokens|context (window|length)|input is too long|maximum context|exceeds? the (model'?s? )?(context|token)/i;
const POLICY_RE = /safeguards? (have )?flagged|usage polic(y|ies)|violat(e|es|ing) (our|the) (usage )?polic|request was (refused|blocked)|content_filter/i;
const FAIL_STOP = new Set(['refusal', 'max_tokens', 'max_turn_requests', 'hook_blocked', 'hook_stopped', 'cancelled']);
/** Args after the executable. The prompt itself is never an argv (Windows limit); it is `--prompt-file`. */
function buildGrokArgs(promptFile, options = {}) {
    const args = [
        '--prompt-file', promptFile,
        '--output-format', 'json',
        '--max-turns', '1',
        '--no-plan',
        '--no-subagents',
        '--no-auto-update',
        '--verbatim',
        '--disable-web-search',
        '--disallowed-tools', GROK_DISALLOWED_TOOLS,
        '--json-schema', GROK_BRIDGE_SCHEMA,
        '--rules', BRIDGE_RULES,
    ];
    if (options.cwd)
        args.push('--cwd', options.cwd);
    if (options.model)
        args.push('--model', options.model);
    if (options.extraArgs?.length)
        args.push(...options.extraArgs);
    return args;
}
/** The JSON object `grok --output-format json` prints. Null when stdout is not that object. */
function parseGrokStdout(stdout) {
    const raw = String(stdout ?? '').trim();
    if (!raw)
        return null;
    const candidates = [raw];
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start)
        candidates.push(raw.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                return parsed;
        }
        catch { /* next candidate */ }
    }
    return null;
}
/** The bridge JSON: `structuredOutput` when `--json-schema` filled it, otherwise `text`. */
function grokBridgeText(envelope) {
    if (!envelope)
        return '';
    const structured = envelope.structuredOutput ?? envelope.structured_output;
    if (structured && typeof structured === 'object')
        return JSON.stringify(structured);
    if (typeof structured === 'string' && structured.trim())
        return structured;
    return String(envelope.text ?? '');
}
function grokFailure(input) {
    const env = input.envelope !== undefined ? input.envelope : parseGrokStdout(input.stdout);
    const stop = env && typeof env.stopReason === 'string' ? env.stopReason : null;
    const message = env ? String(env.message ?? env.error ?? '') : '';
    const text = env && env.type !== 'error' ? grokBridgeText(env) : '';
    const stderr = String(input.stderr || '').trim().slice(0, 400);
    const stdoutTail = text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const blob = [stop, message, text, stderr].filter(Boolean).join(' · ');
    const kind = stop === 'refusal' || POLICY_RE.test(blob) ? 'policy'
        : stop === 'max_tokens' || CONTEXT_RE.test(blob) ? 'context'
            : quota_patterns_1.CLI_FAILURE_QUOTA_RE.test(blob) ? 'quota'
                : stop === 'max_turn_requests' ? 'llm'
                    : 'env';
    const parts = [
        `grok exit ${input.code ?? '?'}`,
        stop ? `stopReason=${stop}` : null,
        message ? `message=${message.slice(0, 400)}` : null,
        stdoutTail ? `stdout=${stdoutTail}` : null,
        stderr ? `stderr=${stderr}` : null,
        input.promptChars ? `prompt=${input.promptChars} chars (~${Math.round(input.promptChars / 4)} tokens)` : null,
        `kind=${kind}`,
    ].filter(Boolean);
    const error = new Error(parts.join(' · '));
    error.kind = kind;
    error.costUsd = env && typeof env.total_cost_usd === 'number' ? env.total_cost_usd : 0;
    error.subtype = stop;
    error.exitCode = input.code;
    return error;
}
const HARD_STOP = new Set(['refusal', 'max_tokens', 'hook_blocked', 'hook_stopped', 'cancelled']);
/** True when the body is the bridge object (`content` string + `tool_calls` array), not prose. */
function grokHasBridgeBody(text) {
    if (!(0, claude_cli_1.parseBridgeReply)(text))
        return false;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return false;
    try {
        const obj = JSON.parse(text.slice(start, end + 1));
        return typeof obj.content === 'string' && Array.isArray(obj.tool_calls);
    }
    catch {
        return false;
    }
}
/**
 * Accept the turn when Grok printed the bridge JSON. A `max_turn_requests` envelope (exit 1) still
 * carries that JSON when the model answered in text and the CLI then reported the turn cap.
 * Refusal, context, hooks and a bare error object stay failures.
 */
function grokTurnOutcome(input) {
    const envelope = parseGrokStdout(input.stdout);
    const stop = envelope && typeof envelope.stopReason === 'string' ? envelope.stopReason : null;
    const failed = input.code !== 0 || !envelope || envelope.type === 'error' || (stop != null && FAIL_STOP.has(stop));
    const text = grokBridgeText(envelope);
    const costUsd = envelope && typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : 0;
    if (!failed)
        return { ok: true, text, costUsd };
    if (envelope && envelope.type !== 'error' && (stop == null || !HARD_STOP.has(stop)) && grokHasBridgeBody(text)) {
        return { ok: true, text, costUsd };
    }
    return { ok: false, error: grokFailure(input) };
}
class GrokCliAdapter {
    constructor(options = {}) {
        this.options = options;
        this.id = 'grok';
        this.requiresApiKey = false;
    }
    get command() {
        return this.options.command || process.env.OXE_GROK_BIN || 'grok';
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
        const hard = this.options.maxPromptChars ?? claude_cli_1.DEFAULT_MAX_PROMPT_CHARS;
        const messages = (0, claude_cli_1.fitTranscript)(opts.messages, hard);
        for (let attempt = 0; attempt <= retries; attempt++) {
            const prompt = (0, claude_cli_1.buildBridgePrompt)(messages, opts.tools ?? [], attempt > 0);
            if (prompt.length > hard) {
                throw grokFailure({
                    code: null,
                    stdout: '',
                    stderr: '',
                    envelope: { type: 'error', stopReason: 'max_tokens', message: `Prompt is too long (estimated before the call, limit ${hard} chars)` },
                    promptChars: prompt.length,
                });
            }
            const reply = await singleFlight(async () => {
                await this.waitForMemory();
                return this.runOnce(prompt, opts.timeoutMs, opts.attemptModel || null);
            });
            costUsd += reply.costUsd;
            lastText = reply.text;
            const parsed = (0, claude_cli_1.parseBridgeReply)(reply.text);
            if (parsed) {
                return {
                    content: parsed.content,
                    tool_calls: parsed.tool_calls,
                    finish_reason: parsed.tool_calls.length ? 'tool_calls' : 'stop',
                    usage: { cost_usd: costUsd },
                };
            }
        }
        return { content: lastText, tool_calls: [], finish_reason: 'stop', usage: { cost_usd: costUsd } };
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
        const chosen = modelOverride || this.options.model;
        const promptFile = this.writePromptFile(prompt);
        const spawnable = (0, claude_cli_1.buildSpawnable)(executable, [
            ...(this.options.prefixArgs ?? []),
            ...buildGrokArgs(promptFile, { model: chosen || null, cwd: this.options.cwd, extraArgs: this.options.extraArgs }),
        ]);
        const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(spawnable.file, spawnable.args, {
                cwd: this.options.cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: (0, shell_argv_1.childProcessEnv)(process.env, { allow: shell_argv_1.PROVIDER_CREDENTIAL_ENV }),
                windowsVerbatimArguments: spawnable.windowsVerbatimArguments,
            });
            let out = '';
            let err = '';
            const timer = setTimeout(() => {
                proc.kill();
                const e = new Error(`grok -p excedeu ${limit} ms (timeout por chamada; executor.timeout_ms / --llm-timeout-ms)`);
                e.kind = 'timeout';
                e.costUsd = 0;
                reject(e);
            }, limit);
            const finish = (fn) => {
                clearTimeout(timer);
                try {
                    fs_1.default.unlinkSync(promptFile);
                }
                catch { /* already gone */ }
                fn();
            };
            proc.stdout.on('data', (chunk) => { out += chunk; });
            proc.stderr.on('data', (chunk) => { err += chunk; });
            proc.on('error', (e) => finish(() => reject(e)));
            proc.on('close', (code) => finish(() => {
                const outcome = grokTurnOutcome({ code, stdout: out, stderr: err, promptChars: prompt.length });
                if (!outcome.ok)
                    return reject(outcome.error);
                resolve({ text: outcome.text, costUsd: outcome.costUsd });
            }));
        });
    }
    writePromptFile(prompt) {
        const root = this.options.cwd ? path_1.default.join(this.options.cwd, '.oxe', 'tmp') : os_1.default.tmpdir();
        fs_1.default.mkdirSync(root, { recursive: true });
        const file = path_1.default.join(root, `grok-bridge-${process.pid}-${++promptSeq}.txt`);
        fs_1.default.writeFileSync(file, prompt, 'utf8');
        return file;
    }
}
exports.GrokCliAdapter = GrokCliAdapter;
