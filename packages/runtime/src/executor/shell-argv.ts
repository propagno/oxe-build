/**
 * Portable shell invocation for verify commands and the `run_command` tool.
 *
 * On Windows, `spawn('cmd', ['/c', command])` lets Node re-quote the argument (`"` → `\"`),
 * which cmd.exe does not understand: `grep -q "npm start" README.md` and `node -e "..."` broke
 * and agents burned retries on quoting instead of code. `cmd /d /s /c "<command>"` with
 * `windowsVerbatimArguments` hands cmd the command line exactly as written.
 */
export interface ShellInvocation {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

export function shellInvocation(command: string, platform: NodeJS.Platform = process.platform): ShellInvocation {
  if (platform === 'win32') {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  }
  return { file: 'sh', args: ['-c', command], windowsVerbatimArguments: false };
}

/** Environment for a child verify/test process: never inherit the parent's node:test context. */
export function childProcessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
