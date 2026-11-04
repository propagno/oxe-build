"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shellInvocation = shellInvocation;
exports.childProcessEnv = childProcessEnv;
function shellInvocation(command, platform = process.platform) {
    if (platform === 'win32') {
        return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
    }
    return { file: 'sh', args: ['-c', command], windowsVerbatimArguments: false };
}
/** Environment for a child verify/test process: never inherit the parent's node:test context. */
function childProcessEnv(base = process.env) {
    const env = { ...base };
    delete env.NODE_TEST_CONTEXT;
    return env;
}
