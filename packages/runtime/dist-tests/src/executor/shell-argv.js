"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_CREDENTIAL_ENV = void 0;
exports.windowsLaunchers = windowsLaunchers;
exports.decodeConsoleOutput = decodeConsoleOutput;
exports.shellInvocation = shellInvocation;
exports.configureChildEnv = configureChildEnv;
exports.childProcessEnv = childProcessEnv;
exports.scrubbedEnvNames = scrubbedEnvNames;
/**
 * OXB-152: POSIX launchers written in plans (`./mobile/android/gradlew -p … test`, `./mvnw`) fail in cmd.exe ("'.' não é
 * reconhecido"). On Windows they map to their batch siblings (`mobile\android\gradlew.bat`, `mvnw.cmd`).
 */
function windowsLaunchers(command) {
    return String(command).replace(/(^|&&\s*|\|\|\s*|&\s*|;\s*)(?:\.\/)?((?:[\w.@-]+\/)*)(gradlew|mvnw)(?=\s|$)/g, (_m, lead, dir, name) => `${lead}${dir.replace(/\//g, '\\')}${name}${name === 'gradlew' ? '.bat' : '.cmd'}`);
}
const CP850_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
/** OXB-152: cmd.exe's own messages come in the OEM code page; valid UTF-8 stays UTF-8, anything else is read as cp850. */
function decodeConsoleOutput(buf) {
    if (buf == null)
        return '';
    if (typeof buf === 'string')
        return buf;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    }
    catch {
        let out = '';
        for (const byte of buf)
            out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
        return out;
    }
}
function shellInvocation(command, platform = process.platform) {
    if (platform === 'win32') {
        return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${windowsLaunchers(command)}"`], windowsVerbatimArguments: true };
    }
    return { file: 'sh', args: ['-c', command], windowsVerbatimArguments: false };
}
/**
 * 1.21.1 (OXB-042): one environment policy for every child the runtime starts (executor CLI, tools, verify, gates).
 * Only the dry-verify used to scrub: the oxespace terminal carries OXESPACE_MCP_TOKEN/EXECUTION_TOKEN/AGENT_HOOK_PORT of
 * the live app, which verify commands and `claude -p` children inherited (tokens leaked, tests hit the real app).
 */
const DEFAULT_SCRUB = [/^OXESPACE_/i, /(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY)/i];
/** What the host CLI needs to authenticate itself (allowed only where the caller asks for provider credentials). */
exports.PROVIDER_CREDENTIAL_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];
let extraScrub = [];
let extraAllow = [];
/** Project policy (`config.json` `env_scrub` regex strings, `env_allow` names), set once per execute/verify. */
function configureChildEnv(policy = {}) {
    extraScrub = (policy.scrub ?? []).map((source) => {
        try {
            return new RegExp(source, 'i');
        }
        catch {
            return null;
        }
    }).filter((re) => re !== null);
    extraAllow = (policy.allow ?? []).map(String);
}
/**
 * Environment for a child process: never the parent's node:test context, never the live app's or other secrets.
 * `allow` keeps named variables (e.g. the provider credentials of the executor CLI) despite the scrub.
 */
function childProcessEnv(base = process.env, options = {}) {
    const allow = new Set([...(options.allow ?? []), ...extraAllow]);
    const scrub = [...DEFAULT_SCRUB, ...extraScrub];
    const env = {};
    for (const [key, value] of Object.entries(base)) {
        if (key === 'NODE_TEST_CONTEXT')
            continue;
        if (!allow.has(key) && scrub.some((re) => re.test(key)))
            continue;
        env[key] = value;
    }
    return env;
}
/** Names of the variables `childProcessEnv` would remove from `base` (for `doctor --project`). */
function scrubbedEnvNames(base = process.env) {
    const kept = childProcessEnv(base);
    return Object.keys(base).filter((key) => key !== 'NODE_TEST_CONTEXT' && !(key in kept));
}
