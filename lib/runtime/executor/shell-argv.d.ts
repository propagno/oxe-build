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
/** What the host CLI needs to authenticate itself (allowed only where the caller asks for provider credentials). */
export declare const PROVIDER_CREDENTIAL_ENV: string[];
/** Project policy (`config.json` `env_scrub` regex strings, `env_allow` names), set once per execute/verify. */
export declare function configureChildEnv(policy?: {
    scrub?: string[];
    allow?: string[];
}): void;
/**
 * Environment for a child process: never the parent's node:test context, never the live app's or other secrets.
 * `allow` keeps named variables (e.g. the provider credentials of the executor CLI) despite the scrub.
 */
export declare function childProcessEnv(base?: NodeJS.ProcessEnv, options?: {
    allow?: string[];
}): NodeJS.ProcessEnv;
/** Names of the variables `childProcessEnv` would remove from `base` (for `doctor --project`). */
export declare function scrubbedEnvNames(base?: NodeJS.ProcessEnv): string[];
