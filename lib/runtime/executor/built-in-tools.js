"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_BUILT_IN_SCHEMAS = exports.BUILT_IN_TOOLS = exports.BoundedOutput = exports.PathContainmentError = void 0;
exports.resolveWithin = resolveWithin;
exports.realPathOf = realPathOf;
exports.samePathKey = samePathKey;
exports.windowsNullRedirects = windowsNullRedirects;
exports.setQuestionResolver = setQuestionResolver;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const shell_argv_1 = require("./shell-argv");
class PathContainmentError extends Error {
    constructor(candidate) {
        super(`path escapes workspace: ${String(candidate)}`);
        this.name = 'PathContainmentError';
    }
}
exports.PathContainmentError = PathContainmentError;
/**
 * Resolve a tool-supplied path and refuse anything outside the workspace root.
 * The LLM only ever sees relative paths; `..` or an absolute path elsewhere is a violation.
 */
function resolveWithin(cwd, candidate) {
    const root = path_1.default.resolve(cwd);
    const target = path_1.default.resolve(root, String(candidate ?? ''));
    const rel = path_1.default.relative(root, target);
    if (rel === '')
        return target;
    if (rel.startsWith('..') || path_1.default.isAbsolute(rel))
        throw new PathContainmentError(candidate);
    // External review 15/11 (P0-2): a path through a symlink or a junction (the runtime itself links node_modules into
    // worktrees) lexically inside the root can land outside it. The REAL path must stay inside the real root.
    const realRoot = realPathOf(root);
    const realRel = path_1.default.relative(samePathKey(realRoot), samePathKey(realPathOf(target)));
    if (realRel !== '' && (realRel.startsWith('..') || path_1.default.isAbsolute(realRel)))
        throw new PathContainmentError(candidate);
    return target;
}
/**
 * The real path of `p`, following links. For a path that does not exist yet (a new file), the real path of its
 * nearest existing ancestor joined with the rest — a write through a linked directory is resolved too.
 */
function realPathOf(p, depth = 0) {
    let cur = path_1.default.resolve(p);
    const rest = [];
    for (;;) {
        try {
            const real = fs_1.default.realpathSync.native(cur);
            return rest.length ? path_1.default.join(real, ...rest.reverse()) : real;
        }
        catch {
            // Cross-review 15/11: a DANGLING link (its target does not exist yet) fails realpath too; climbing past it
            // would answer "inside" while a write follows the link out. Resolve the link's target instead.
            let link = null;
            try {
                if (fs_1.default.lstatSync(cur).isSymbolicLink())
                    link = fs_1.default.readlinkSync(cur);
            }
            catch {
                link = null;
            }
            if (link !== null) {
                if (depth >= 40)
                    throw new PathContainmentError(p);
                const target = path_1.default.resolve(path_1.default.dirname(cur), link);
                return realPathOf(rest.length ? path_1.default.join(target, ...rest.reverse()) : target, depth + 1);
            }
            const parent = path_1.default.dirname(cur);
            if (parent === cur)
                return path_1.default.resolve(p);
            rest.push(path_1.default.basename(cur));
            cur = parent;
        }
    }
}
/** Case-insensitive file systems (Windows, macOS): paths compare in lower case. */
function samePathKey(p) {
    return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}
// ─── read_file ────────────────────────────────────────────────────────────────
const readFile = {
    idempotent: true,
    schema: {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    offset: { type: 'integer', description: 'Line to start reading from (1-based)' },
                    limit: { type: 'integer', description: 'Maximum number of lines to read' },
                },
                required: ['path'],
            },
        },
    },
    async execute(args, cwd) {
        const filePath = resolveWithin(cwd, args.path);
        if (!fs_1.default.existsSync(filePath))
            return `Error: file not found: ${args.path}`;
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const offset = typeof args.offset === 'number' ? args.offset - 1 : 0;
        // OXB-148: a whole big file in the transcript is paid again on every following turn; default to a window.
        const limit = typeof args.limit === 'number' ? args.limit : Math.min(lines.length, READ_DEFAULT_LINES);
        const slice = lines.slice(offset, offset + limit).map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}… [linha com ${l.length} chars cortada]` : l)).join('\n');
        const more = offset + limit < lines.length ? `\n[… ${lines.length - (offset + limit)} linha(s) a mais: use offset/limit]` : '';
        return slice + more;
    },
};
// ─── write_file ───────────────────────────────────────────────────────────────
const writeFile = {
    idempotent: false,
    schema: {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file (creates or overwrites)',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    content: { type: 'string', description: 'Content to write' },
                },
                required: ['path', 'content'],
            },
        },
    },
    async execute(args, cwd) {
        const filePath = resolveWithin(cwd, args.path);
        fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
        fs_1.default.writeFileSync(filePath, String(args.content), 'utf8');
        return `Written ${String(args.content).length} bytes to ${args.path}`;
    },
};
// ─── patch_file ───────────────────────────────────────────────────────────────
const patchFile = {
    idempotent: false,
    schema: {
        type: 'function',
        function: {
            name: 'patch_file',
            description: 'Replace an exact string in a file with new content',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    old_string: { type: 'string', description: 'Exact string to replace' },
                    new_string: { type: 'string', description: 'Replacement string' },
                },
                required: ['path', 'old_string', 'new_string'],
            },
        },
    },
    async execute(args, cwd) {
        const filePath = resolveWithin(cwd, args.path);
        if (!fs_1.default.existsSync(filePath))
            return `Error: file not found: ${args.path}`;
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        const oldStr = String(args.old_string);
        if (!content.includes(oldStr))
            return `Error: old_string not found in ${args.path}`;
        const updated = content.replace(oldStr, String(args.new_string));
        fs_1.default.writeFileSync(filePath, updated, 'utf8');
        return `Patched ${args.path}`;
    },
};
// ─── glob ─────────────────────────────────────────────────────────────────────
const glob = {
    idempotent: true,
    schema: {
        type: 'function',
        function: {
            name: 'glob',
            description: 'List files matching a glob pattern within the workspace',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob pattern, e.g. src/**/*.ts' },
                },
                required: ['pattern'],
            },
        },
    },
    async execute(args, cwd) {
        const results = globSync(String(args.pattern), cwd);
        return results.length ? results.join('\n') : '(no files matched)';
    },
};
function globSync(pattern, root) {
    const results = [];
    const parts = pattern.split('/');
    function walk(dir, remaining) {
        if (!fs_1.default.existsSync(dir))
            return;
        // `..` segments must not walk out of the workspace.
        const rel = path_1.default.relative(path_1.default.resolve(root), path_1.default.resolve(dir));
        if (rel.startsWith('..') || path_1.default.isAbsolute(rel))
            return;
        const [head, ...tail] = remaining;
        if (!head)
            return;
        const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const matches = micromatch(entry.name, head);
            if (!matches)
                continue;
            // links (symlinks, junctions) are never walked into: the search stays in the real workspace
            if (entry.isSymbolicLink())
                continue;
            const full = path_1.default.join(dir, entry.name);
            if (tail.length === 0) {
                results.push(path_1.default.relative(root, full).replace(/\\/g, '/'));
            }
            else if (entry.isDirectory()) {
                if (head === '**') {
                    walk(full, remaining);
                    walk(full, tail);
                }
                else {
                    walk(full, tail);
                }
            }
        }
    }
    walk(root, parts);
    return results;
}
function micromatch(name, pattern) {
    if (pattern === '**')
        return true;
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    return regex.test(name);
}
// ─── grep ─────────────────────────────────────────────────────────────────────
/** OXB-148: caps that keep a tool result from flooding the transcript (F2-T1: a 2.29M-char prompt). */
const READ_DEFAULT_LINES = 800;
const LINE_MAX = 400;
const GREP_MAX_MATCHES = 200;
const GREP_MAX_FILE_BYTES = 1024 * 1024;
/** Generated / vendored trees the search never walks (minified bundles have megabyte lines). */
const GREP_SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', 'coverage', 'release', 'releases', '.next', 'target', 'vendor', 'bower_components', 'storybook-static', 'playwright-report', 'test-results']);
const GREP_SKIP_FILE = /(\.min\.(js|css)|\.map|\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm|node|exe|dll|so|dylib|woff2?|ttf|mp4|mp3))$/i;
const grep = {
    idempotent: true,
    schema: {
        type: 'function',
        function: {
            name: 'grep',
            description: 'Search for a regex pattern in files',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Regex pattern to search for' },
                    path: { type: 'string', description: 'File or directory to search in (relative to workspace)' },
                },
                required: ['pattern'],
            },
        },
    },
    async execute(args, cwd) {
        const searchRoot = args.path ? resolveWithin(cwd, args.path) : cwd;
        const regex = new RegExp(String(args.pattern));
        const results = [];
        grepDir(searchRoot, regex, cwd, results);
        if (!results.length)
            return '(no matches)';
        const shown = results.slice(0, GREP_MAX_MATCHES).join('\n');
        return results.length > GREP_MAX_MATCHES ? `${shown}\n[… ${results.length - GREP_MAX_MATCHES} ocorrência(s) a mais: estreite o padrão ou o path]` : shown;
    },
};
function grepDir(dir, regex, root, out) {
    if (!fs_1.default.existsSync(dir))
        return;
    const stat = fs_1.default.statSync(dir);
    if (stat.isFile()) {
        grepFile(dir, regex, root, out);
        return;
    }
    for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const full = path_1.default.join(dir, entry.name);
        if (out.length > GREP_MAX_MATCHES * 5)
            return;
        if (entry.isSymbolicLink())
            continue; // links are not followed (see globSync)
        if (entry.isDirectory() && !entry.name.startsWith('.') && !GREP_SKIP_DIRS.has(entry.name)) {
            grepDir(full, regex, root, out);
        }
        else if (entry.isFile() && !GREP_SKIP_FILE.test(entry.name)) {
            grepFile(full, regex, root, out);
        }
    }
}
function grepFile(filePath, regex, root, out) {
    try {
        if (fs_1.default.statSync(filePath).size > GREP_MAX_FILE_BYTES)
            return;
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        content.split('\n').forEach((line, i) => {
            if (regex.test(line)) {
                // a long line (minified, generated) is shown around the match only
                let shown = line;
                if (line.length > LINE_MAX) {
                    const m = regex.exec(line);
                    const at = m ? Math.max(0, m.index - 120) : 0;
                    shown = `…${line.slice(at, at + LINE_MAX)}… [linha com ${line.length} chars]`;
                }
                out.push(`${path_1.default.relative(root, filePath).replace(/\\/g, '/')}:${i + 1}: ${shown}`);
            }
        });
    }
    catch { /* skip binary or unreadable files */ }
}
// ─── run_command ──────────────────────────────────────────────────────────────
const runCommand = {
    idempotent: false,
    schema: {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Run a shell command in the workspace directory (on Windows the shell is cmd.exe: discard output with 2>nul; elsewhere sh: 2>/dev/null). The output is cut to its first and last 64 KB, and a command printing more than 64 MB is stopped. node_modules may be a link to a shared dependencies folder: exclude node_modules, dist and .git from recursive grep/find/cat (prefer the search tool).',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to execute' },
                    timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 30000)' },
                },
                required: ['command'],
            },
        },
    },
    async execute(args, cwd) {
        const command = String(args.command);
        const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30000;
        return runShell(command, cwd, timeoutMs);
    },
};
/**
 * OxeSpace 14/11 (P0): a command that printed more than ~512 MB (a recursive grep that followed the node_modules
 * junction) made `Buffer.concat(out).toString()` throw ERR_STRING_TOO_LONG and killed the whole run. The output is now
 * bounded: the first and the last `keep` bytes, with the count of what was cut; past `hardLimit` the command is killed.
 */
class BoundedOutput {
    constructor(keep = 64 * 1024, hardLimit = 64 * 1024 * 1024) {
        this.keep = keep;
        this.hardLimit = hardLimit;
        this.head = [];
        this.headBytes = 0;
        this.tail = [];
        this.tailBytes = 0;
        this.total = 0;
    }
    push(chunk) {
        this.total += chunk.length;
        let c = chunk;
        if (this.headBytes < this.keep) {
            const take = Math.min(this.keep - this.headBytes, c.length);
            this.head.push(c.subarray(0, take));
            this.headBytes += take;
            c = c.subarray(take);
        }
        if (!c.length)
            return;
        this.tail.push(c);
        this.tailBytes += c.length;
        while (this.tail.length > 1 && this.tailBytes - this.tail[0].length >= this.keep)
            this.tailBytes -= this.tail.shift().length;
    }
    get overLimit() { return this.total > this.hardLimit; }
    text() {
        const head = Buffer.concat(this.head).toString('utf8');
        let tail = Buffer.concat(this.tail);
        if (tail.length > this.keep)
            tail = tail.subarray(tail.length - this.keep);
        const cut = this.total - this.headBytes - tail.length;
        if (cut <= 0)
            return (head + tail.toString('utf8')).trim();
        return `${head}\n[… ${cut} bytes cortados da saída (${this.total} no total) — restrinja o comando: exclua node_modules, dist e .git de buscas recursivas …]\n${tail.toString('utf8')}`.trim();
    }
}
exports.BoundedOutput = BoundedOutput;
/**
 * OxeSpace 14/11 (OxeChat F2 T5): the agent ran `… 2>$null` (PowerShell) through cmd.exe, which created a file named
 * `$null` in the worktree (a ScopeViolation). On Windows, a redirect to `$null` or `/dev/null` goes to `nul`.
 */
function windowsNullRedirects(command) {
    return command.replace(/(\d?>>?|&>)\s*(?:\$null|\/dev\/null)(?![\w/])/gi, (_m, op) => (op === '&>' ? '>nul 2>&1' : `${op}nul`));
}
function runShell(command, cwd, timeoutMs) {
    return new Promise((resolve) => {
        const shell = (0, shell_argv_1.shellInvocation)(process.platform === 'win32' ? windowsNullRedirects(command) : command);
        // stdin is closed so a command that waits for input (e.g. grep without a file) ends instead of hanging.
        const proc = (0, child_process_1.spawn)(shell.file, shell.args, {
            cwd,
            env: (0, shell_argv_1.childProcessEnv)(),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsVerbatimArguments: shell.windowsVerbatimArguments,
        });
        const out = new BoundedOutput();
        let timedOut = false;
        let killedForSize = false;
        const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); }, timeoutMs);
        const onData = (c) => {
            out.push(c);
            if (out.overLimit && !killedForSize) {
                killedForSize = true;
                proc.kill('SIGTERM');
            }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('close', (code) => {
            clearTimeout(timer);
            const text = out.text();
            if (killedForSize)
                resolve(`[interrompido: a saída passou de ${Math.round(out.hardLimit / (1024 * 1024))} MB — o comando foi parado; restrinja-o (exclua node_modules de buscas recursivas)]\n${text}`);
            else if (timedOut)
                resolve(`[timed out after ${timeoutMs}ms]\n${text}`);
            else
                resolve(code === 0 ? text || '(no output)' : `[exit ${code}]\n${text}`);
        });
        proc.on('error', (err) => { clearTimeout(timer); resolve(`[error] ${err}`); });
    });
}
// ─── finish_task ──────────────────────────────────────────────────────────────
const finishTask = {
    idempotent: true,
    schema: {
        type: 'function',
        function: {
            name: 'finish_task',
            description: 'Signal that the task is complete. Call this when ALL required actions have been performed.',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Summary of what was accomplished' },
                    evidence_paths: { type: 'array', items: { type: 'string' }, description: 'Paths to files created or modified' },
                },
                required: ['summary'],
            },
        },
    },
    async execute(args, _cwd) {
        return JSON.stringify({
            __finish_task__: true,
            summary: String(args.summary || ''),
            evidence_paths: Array.isArray(args.evidence_paths) ? args.evidence_paths : [],
        });
    },
};
let questionResolver = null;
/** The orchestrator side (oxe-cc) answers from the artifacts, records decisions, queues what needs a person. */
function setQuestionResolver(fn) { questionResolver = fn; }
const askOrchestrator = {
    idempotent: false,
    schema: {
        type: 'function',
        function: {
            name: 'ask_orchestrator',
            description: 'Ask the orchestrator when the contract is ambiguous (two readings, an anchor that does not decide, a test and the code disagreeing) instead of guessing. Give the options and your default; blocking=true when going on with the default could do harm.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string' },
                    options: { type: 'array', items: { type: 'string' } },
                    default: { type: 'string' },
                    blocking: { type: 'boolean' },
                },
                required: ['question', 'options'],
            },
        },
    },
    async execute(args, _cwd) {
        const q = {
            question: String(args.question || ''),
            options: Array.isArray(args.options) ? args.options.map(String) : [],
            default: args.default != null ? String(args.default) : null,
            blocking: args.blocking === true,
        };
        const a = questionResolver ? questionResolver(q) : (q.default && !q.blocking ? { answer: q.default, provisional: true, source: null } : { wait: true });
        if (a.wait)
            return JSON.stringify({ __ask_blocked__: true, id: a.id || null, question: q.question });
        return JSON.stringify({ answer: a.answer, source: a.source || null, provisional: Boolean(a.provisional) });
    },
};
// ─── Registry ─────────────────────────────────────────────────────────────────
exports.BUILT_IN_TOOLS = {
    read_file: readFile,
    write_file: writeFile,
    patch_file: patchFile,
    glob,
    grep,
    run_command: runCommand,
    finish_task: finishTask,
    ask_orchestrator: askOrchestrator,
};
// OXB-125: ask_orchestrator is offered only when the run opts in (execute.ask_orchestrator) — see selectToolsForActions.
exports.ALL_BUILT_IN_SCHEMAS = Object.entries(exports.BUILT_IN_TOOLS).filter(([name]) => name !== 'ask_orchestrator').map(([, t]) => t.schema);
