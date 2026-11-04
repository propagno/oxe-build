"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const shell_argv_1 = require("../src/executor/shell-argv");
const built_in_tools_1 = require("../src/executor/built-in-tools");
const verification_compiler_1 = require("../src/verification/verification-compiler");
// Regressão do e2e "linkly" (Windows): `cmd /c` com re-quoting do Node quebrava `"..."` em
// grep/node -e e os agentes gastaram retries depurando o shell em vez do código.
(0, node_test_1.describe)('shell-argv — invocação portável', () => {
    (0, node_test_1.test)('win32 usa cmd /d /s /c "<cmd>" com argumentos verbatim', () => {
        const inv = (0, shell_argv_1.shellInvocation)('node -e "console.log(1)" && echo ok', 'win32');
        strict_1.default.equal(inv.file, 'cmd.exe');
        strict_1.default.deepEqual(inv.args, ['/d', '/s', '/c', '"node -e "console.log(1)" && echo ok"']);
        strict_1.default.equal(inv.windowsVerbatimArguments, true);
    });
    (0, node_test_1.test)('posix usa sh -c sem verbatim', () => {
        const inv = (0, shell_argv_1.shellInvocation)('echo "a b"', 'linux');
        strict_1.default.deepEqual([inv.file, ...inv.args], ['sh', '-c', 'echo "a b"']);
        strict_1.default.equal(inv.windowsVerbatimArguments, false);
    });
    (0, node_test_1.test)('childProcessEnv remove NODE_TEST_CONTEXT e preserva o resto', () => {
        const env = (0, shell_argv_1.childProcessEnv)({ NODE_TEST_CONTEXT: 'child-v8', PATH: '/bin' });
        strict_1.default.equal(env.NODE_TEST_CONTEXT, undefined);
        strict_1.default.equal(env.PATH, '/bin');
    });
    (0, node_test_1.test)('aspas duplas sobrevivem no run_command e no verify (plataforma atual)', async () => {
        const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-shell-'));
        try {
            fs_1.default.writeFileSync(path_1.default.join(tmp, 'README.md'), 'Use npm start para subir.\n', 'utf8');
            const cmd = 'node -e "const s=require(\'fs\').readFileSync(\'README.md\',\'utf8\'); if(!s.includes(\'npm start\')) process.exit(3); console.log(\'has npm start\')"';
            const out = await built_in_tools_1.BUILT_IN_TOOLS.run_command.execute({ command: cmd }, tmp);
            strict_1.default.equal(out, 'has npm start');
            const result = await (0, verification_compiler_1.runCheck)({ id: 'c', type: 'custom', command: cmd, evidence_type_expected: 'stdout', acceptance_ref: null, description: 'c' }, tmp);
            strict_1.default.equal(result.status, 'pass', `${result.stderr}${result.error ?? ''}`);
        }
        finally {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('run_command não fica pendurado esperando stdin', async () => {
        const out = await built_in_tools_1.BUILT_IN_TOOLS.run_command.execute({ command: 'node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.log(\'eof\'))"', timeout_ms: 10000 }, os_1.default.tmpdir());
        strict_1.default.equal(out, 'eof');
    });
});
