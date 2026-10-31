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
export declare function shellInvocation(command: string, platform?: NodeJS.Platform): ShellInvocation;
/** Environment for a child verify/test process: never inherit the parent's node:test context. */
export declare function childProcessEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
