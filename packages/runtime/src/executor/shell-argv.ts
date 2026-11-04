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

/**
 * 1.21.1 (OXB-042): one environment policy for every child the runtime starts (executor CLI, tools, verify, gates).
 * Only the dry-verify used to scrub: the oxespace terminal carries OXESPACE_MCP_TOKEN/EXECUTION_TOKEN/AGENT_HOOK_PORT of
 * the live app, which verify commands and `claude -p` children inherited (tokens leaked, tests hit the real app).
 */
const DEFAULT_SCRUB: RegExp[] = [/^OXESPACE_/i, /(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY)/i];
/** What the host CLI needs to authenticate itself (allowed only where the caller asks for provider credentials). */
export const PROVIDER_CREDENTIAL_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];

let extraScrub: RegExp[] = [];
let extraAllow: string[] = [];

/** Project policy (`config.json` `env_scrub` regex strings, `env_allow` names), set once per execute/verify. */
export function configureChildEnv(policy: { scrub?: string[]; allow?: string[] } = {}): void {
  extraScrub = (policy.scrub ?? []).map((source) => {
    try {
      return new RegExp(source, 'i');
    } catch {
      return null;
    }
  }).filter((re): re is RegExp => re !== null);
  extraAllow = (policy.allow ?? []).map(String);
}

/**
 * Environment for a child process: never the parent's node:test context, never the live app's or other secrets.
 * `allow` keeps named variables (e.g. the provider credentials of the executor CLI) despite the scrub.
 */
export function childProcessEnv(base: NodeJS.ProcessEnv = process.env, options: { allow?: string[] } = {}): NodeJS.ProcessEnv {
  const allow = new Set([...(options.allow ?? []), ...extraAllow]);
  const scrub = [...DEFAULT_SCRUB, ...extraScrub];
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === 'NODE_TEST_CONTEXT') continue;
    if (!allow.has(key) && scrub.some((re) => re.test(key))) continue;
    env[key] = value;
  }
  return env;
}

/** Names of the variables `childProcessEnv` would remove from `base` (for `doctor --project`). */
export function scrubbedEnvNames(base: NodeJS.ProcessEnv = process.env): string[] {
  const kept = childProcessEnv(base);
  return Object.keys(base).filter((key) => key !== 'NODE_TEST_CONTEXT' && !(key in kept));
}
