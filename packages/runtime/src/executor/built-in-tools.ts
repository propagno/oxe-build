import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { ToolSchema } from './stream-completion';

export interface BuiltInToolHandler {
  schema: ToolSchema;
  idempotent: boolean;
  execute(args: Record<string, unknown>, cwd: string): Promise<string>;
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
    const filePath = path.resolve(cwd, String(args.path));
    if (!fs.existsSync(filePath)) return `Error: file not found: ${args.path}`;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const offset = typeof args.offset === 'number' ? args.offset - 1 : 0;
    const limit = typeof args.limit === 'number' ? args.limit : lines.length;
    return lines.slice(offset, offset + limit).join('\n');
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
    const filePath = path.resolve(cwd, String(args.path));
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
    const filePath = path.resolve(cwd, String(args.path));
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
    const [head, ...tail] = remaining;
    if (!head) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const matches = micromatch(entry.name, head);
      if (!matches) continue;
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
    const searchRoot = args.path ? path.resolve(cwd, String(args.path)) : cwd;
    const regex = new RegExp(String(args.pattern));
    const results: string[] = [];
    grepDir(searchRoot, regex, cwd, results);
    return results.length ? results.slice(0, 200).join('\n') : '(no matches)';
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
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      grepDir(full, regex, root, out);
    } else if (entry.isFile()) {
      grepFile(full, regex, root, out);
    }
  }
}

function grepFile(filePath: string, regex: RegExp, root: string, out: string[]): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach((line, i) => {
      if (regex.test(line)) {
        out.push(`${path.relative(root, filePath).replace(/\\/g, '/')}:${i + 1}: ${line}`);
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
      description: 'Run a shell command in the workspace directory',
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

function runShell(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd' : 'sh';
    const shellArgs = isWin ? ['/c', command] : ['-c', command];
    const proc = spawn(shell, shellArgs, { cwd, stdio: 'pipe' });
    const out: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => out.push(c));
    proc.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8').trim();
      if (timedOut) resolve(`[timed out after ${timeoutMs}ms]\n${text}`);
      else resolve(code === 0 ? text || '(no output)' : `[exit ${code}]\n${text}`);
    });
    proc.on('error', (err) => { clearTimeout(timer); resolve(`[error] ${err}`); });
  });
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const BUILT_IN_TOOLS: Record<string, BuiltInToolHandler> = {
  read_file: readFile,
  write_file: writeFile,
  patch_file: patchFile,
  glob,
  grep,
  run_command: runCommand,
};

export const ALL_BUILT_IN_SCHEMAS: ToolSchema[] = Object.values(BUILT_IN_TOOLS).map((t) => t.schema);
