import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { ToolSchema } from './stream-completion';
import { shellInvocation, childProcessEnv } from './shell-argv';

export interface BuiltInToolHandler {
  schema: ToolSchema;
  idempotent: boolean;
  execute(args: Record<string, unknown>, cwd: string): Promise<string>;
}

export class PathContainmentError extends Error {
  constructor(candidate: unknown) {
    super(`path escapes workspace: ${String(candidate)}`);
    this.name = 'PathContainmentError';
  }
}

/**
 * Resolve a tool-supplied path and refuse anything outside the workspace root.
 * The LLM only ever sees relative paths; `..` or an absolute path elsewhere is a violation.
 */
export function resolveWithin(cwd: string, candidate: unknown): string {
  const root = path.resolve(cwd);
  const target = path.resolve(root, String(candidate ?? ''));
  const rel = path.relative(root, target);
  if (rel === '') return target;
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new PathContainmentError(candidate);
  // External review 15/11 (P0-2): a path through a symlink or a junction (the runtime itself links node_modules into
  // worktrees) lexically inside the root can land outside it. The REAL path must stay inside the real root.
  const realRoot = realPathOf(root);
  const realRel = path.relative(samePathKey(realRoot), samePathKey(realPathOf(target)));
  if (realRel !== '' && (realRel.startsWith('..') || path.isAbsolute(realRel))) throw new PathContainmentError(candidate);
  return target;
}

/**
 * The real path of `p`, following links. For a path that does not exist yet (a new file), the real path of its
 * nearest existing ancestor joined with the rest — a write through a linked directory is resolved too.
 */
export function realPathOf(p: string, depth = 0): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      // Cross-review 15/11: a DANGLING link (its target does not exist yet) fails realpath too; climbing past it
      // would answer "inside" while a write follows the link out. Resolve the link's target instead.
      let link: string | null = null;
      try { if (fs.lstatSync(cur).isSymbolicLink()) link = fs.readlinkSync(cur); } catch { link = null; }
      if (link !== null) {
        if (depth >= 40) throw new PathContainmentError(p);
        const target = path.resolve(path.dirname(cur), link);
        return realPathOf(rest.length ? path.join(target, ...rest.reverse()) : target, depth + 1);
      }
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Case-insensitive file systems (Windows, macOS): paths compare in lower case. */
export function samePathKey(p: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}

// ─── read_file ────────────────────────────────────────────────────────────────

const readFile: BuiltInToolHandler = {
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
    if (!fs.existsSync(filePath)) return `Error: file not found: ${args.path}`;
    const content = fs.readFileSync(filePath, 'utf8');
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

const writeFile: BuiltInToolHandler = {
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(args.content), 'utf8');
    return `Written ${String(args.content).length} bytes to ${args.path}`;
  },
};

// ─── patch_file ───────────────────────────────────────────────────────────────

const patchFile: BuiltInToolHandler = {
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
    if (!fs.existsSync(filePath)) return `Error: file not found: ${args.path}`;
    const content = fs.readFileSync(filePath, 'utf8');
    const oldStr = String(args.old_string);
    if (!content.includes(oldStr)) return `Error: old_string not found in ${args.path}`;
    const updated = content.replace(oldStr, String(args.new_string));
    fs.writeFileSync(filePath, updated, 'utf8');
    return `Patched ${args.path}`;
  },
};

// ─── glob ─────────────────────────────────────────────────────────────────────

const glob: BuiltInToolHandler = {
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

function globSync(pattern: string, root: string): string[] {
  const results: string[] = [];
  const parts = pattern.split('/');
  function walk(dir: string, remaining: string[]): void {
    if (!fs.existsSync(dir)) return;
    // `..` segments must not walk out of the workspace.
    const rel = path.relative(path.resolve(root), path.resolve(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;
    const [head, ...tail] = remaining;
    if (!head) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const matches = micromatch(entry.name, head);
      if (!matches) continue;
      // links (symlinks, junctions) are never walked into: the search stays in the real workspace
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (tail.length === 0) {
        results.push(path.relative(root, full).replace(/\\/g, '/'));
      } else if (entry.isDirectory()) {
        if (head === '**') {
          walk(full, remaining);
          walk(full, tail);
        } else {
          walk(full, tail);
        }
      }
    }
  }
  walk(root, parts);
  return results;
}

function micromatch(name: string, pattern: string): boolean {
  if (pattern === '**') return true;
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

const grep: BuiltInToolHandler = {
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
    const results: string[] = [];
    grepDir(searchRoot, regex, cwd, results);
    if (!results.length) return '(no matches)';
    const shown = results.slice(0, GREP_MAX_MATCHES).join('\n');
    return results.length > GREP_MAX_MATCHES ? `${shown}\n[… ${results.length - GREP_MAX_MATCHES} ocorrência(s) a mais: estreite o padrão ou o path]` : shown;
  },
};

function grepDir(dir: string, regex: RegExp, root: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    grepFile(dir, regex, root, out);
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (out.length > GREP_MAX_MATCHES * 5) return;
    if (entry.isSymbolicLink()) continue; // links are not followed (see globSync)
    if (entry.isDirectory() && !entry.name.startsWith('.') && !GREP_SKIP_DIRS.has(entry.name)) {
      grepDir(full, regex, root, out);
    } else if (entry.isFile() && !GREP_SKIP_FILE.test(entry.name)) {
      grepFile(full, regex, root, out);
    }
  }
}

function grepFile(filePath: string, regex: RegExp, root: string, out: string[]): void {
  try {
    if (fs.statSync(filePath).size > GREP_MAX_FILE_BYTES) return;
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach((line, i) => {
      if (regex.test(line)) {
        // a long line (minified, generated) is shown around the match only
        let shown = line;
        if (line.length > LINE_MAX) {
          const m = regex.exec(line);
          const at = m ? Math.max(0, m.index - 120) : 0;
          shown = `…${line.slice(at, at + LINE_MAX)}… [linha com ${line.length} chars]`;
        }
        out.push(`${path.relative(root, filePath).replace(/\\/g, '/')}:${i + 1}: ${shown}`);
      }
    });
  } catch { /* skip binary or unreadable files */ }
}

// ─── run_command ──────────────────────────────────────────────────────────────

const runCommand: BuiltInToolHandler = {
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
    const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30_000;
    return runShell(command, cwd, timeoutMs);
  },
};

/**
 * OxeSpace 14/11 (P0): a command that printed more than ~512 MB (a recursive grep that followed the node_modules
 * junction) made `Buffer.concat(out).toString()` throw ERR_STRING_TOO_LONG and killed the whole run. The output is now
 * bounded: the first and the last `keep` bytes, with the count of what was cut; past `hardLimit` the command is killed.
 */
export class BoundedOutput {
  private head: Buffer[] = [];
  private headBytes = 0;
  private tail: Buffer[] = [];
  private tailBytes = 0;
  total = 0;
  constructor(private readonly keep = 64 * 1024, readonly hardLimit = 64 * 1024 * 1024) {}

  push(chunk: Buffer): void {
    this.total += chunk.length;
    let c = chunk;
    if (this.headBytes < this.keep) {
      const take = Math.min(this.keep - this.headBytes, c.length);
      this.head.push(c.subarray(0, take));
      this.headBytes += take;
      c = c.subarray(take);
    }
    if (!c.length) return;
    this.tail.push(c);
    this.tailBytes += c.length;
    while (this.tail.length > 1 && this.tailBytes - this.tail[0].length >= this.keep) this.tailBytes -= this.tail.shift()!.length;
  }

  get overLimit(): boolean { return this.total > this.hardLimit; }

  text(): string {
    const head = Buffer.concat(this.head).toString('utf8');
    let tail = Buffer.concat(this.tail);
    if (tail.length > this.keep) tail = tail.subarray(tail.length - this.keep);
    const cut = this.total - this.headBytes - tail.length;
    if (cut <= 0) return (head + tail.toString('utf8')).trim();
    return `${head}\n[… ${cut} bytes cortados da saída (${this.total} no total) — restrinja o comando: exclua node_modules, dist e .git de buscas recursivas …]\n${tail.toString('utf8')}`.trim();
  }
}

/**
 * OxeSpace 14/11 (OxeChat F2 T5): the agent ran `… 2>$null` (PowerShell) through cmd.exe, which created a file named
 * `$null` in the worktree (a ScopeViolation). On Windows, a redirect to `$null` or `/dev/null` goes to `nul`.
 */
export function windowsNullRedirects(command: string): string {
  return command.replace(/(\d?>>?|&>)\s*(?:\$null|\/dev\/null)(?![\w/])/gi, (_m, op: string) => (op === '&>' ? '>nul 2>&1' : `${op}nul`));
}

function runShell(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const shell = shellInvocation(process.platform === 'win32' ? windowsNullRedirects(command) : command);
    // stdin is closed so a command that waits for input (e.g. grep without a file) ends instead of hanging.
    const proc = spawn(shell.file, shell.args, {
      cwd,
      env: childProcessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    });
    const out = new BoundedOutput();
    let timedOut = false;
    let killedForSize = false;

    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); }, timeoutMs);

    const onData = (c: Buffer) => {
      out.push(c);
      if (out.overLimit && !killedForSize) { killedForSize = true; proc.kill('SIGTERM'); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const text = out.text();
      if (killedForSize) resolve(`[interrompido: a saída passou de ${Math.round(out.hardLimit / (1024 * 1024))} MB — o comando foi parado; restrinja-o (exclua node_modules de buscas recursivas)]\n${text}`);
      else if (timedOut) resolve(`[timed out after ${timeoutMs}ms]\n${text}`);
      else resolve(code === 0 ? text || '(no output)' : `[exit ${code}]\n${text}`);
    });
    proc.on('error', (err) => { clearTimeout(timer); resolve(`[error] ${err}`); });
  });
}

// ─── finish_task ──────────────────────────────────────────────────────────────

const finishTask: BuiltInToolHandler = {
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

// ─── ask_orchestrator (OXB-125) ───────────────────────────────────────────────

export interface ExecutorQuestion { question: string; options: string[]; default?: string | null; blocking: boolean; task?: string | null }
export interface ExecutorAnswer { answer?: string | null; source?: string | null; provisional?: boolean; wait?: boolean; id?: string | null }
let questionResolver: ((q: ExecutorQuestion) => ExecutorAnswer) | null = null;
/** The orchestrator side (oxe-cc) answers from the artifacts, records decisions, queues what needs a person. */
export function setQuestionResolver(fn: ((q: ExecutorQuestion) => ExecutorAnswer) | null): void { questionResolver = fn; }

const askOrchestrator: BuiltInToolHandler = {
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
    const q: ExecutorQuestion = {
      question: String(args.question || ''),
      options: Array.isArray(args.options) ? args.options.map(String) : [],
      default: args.default != null ? String(args.default) : null,
      blocking: args.blocking === true,
    };
    const a = questionResolver ? questionResolver(q) : (q.default && !q.blocking ? { answer: q.default, provisional: true, source: null } : { wait: true });
    if (a.wait) return JSON.stringify({ __ask_blocked__: true, id: a.id || null, question: q.question });
    return JSON.stringify({ answer: a.answer, source: a.source || null, provisional: Boolean(a.provisional) });
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const BUILT_IN_TOOLS: Record<string, BuiltInToolHandler> = {
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
export const ALL_BUILT_IN_SCHEMAS: ToolSchema[] = Object.entries(BUILT_IN_TOOLS).filter(([name]) => name !== 'ask_orchestrator').map(([, t]) => t.schema);
