"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const built_in_tools_1 = require("../src/executor/built-in-tools");
// OxeSpace 14/11 (OxeChat F2 T5): `2>$null` through cmd.exe created a file named `$null` in the worktree.
(0, node_test_1.describe)('redirecionamento para o nulo no Windows', () => {
    (0, node_test_1.test)('$null e /dev/null viram nul; o resto do comando não muda', () => {
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('git status 2>$null'), 'git status 2>nul');
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('npm ls >/dev/null 2>&1'), 'npm ls >nul 2>&1');
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('x 2>> /dev/null'), 'x 2>>nul');
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('x &> /dev/null'), 'x >nul 2>&1');
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('echo $nullable > out.txt'), 'echo $nullable > out.txt');
        strict_1.default.equal((0, built_in_tools_1.windowsNullRedirects)('cat /dev/null/x'), 'cat /dev/null/x');
    });
});
// OxeSpace 14/11 (P0): a command printing more than ~512 MB made Buffer.concat(...).toString() throw
// ERR_STRING_TOO_LONG and killed the whole run. The shell output is bounded: head + tail + what was cut.
(0, node_test_1.describe)('saída do run_command com limite', () => {
    (0, node_test_1.test)('pequena: sai inteira', () => {
        const o = new built_in_tools_1.BoundedOutput(16, 1024);
        o.push(Buffer.from('abc'));
        o.push(Buffer.from('def'));
        strict_1.default.equal(o.text(), 'abcdef');
        strict_1.default.equal(o.overLimit, false);
    });
    (0, node_test_1.test)('grande: o começo, o fim e quantos bytes foram cortados', () => {
        const o = new built_in_tools_1.BoundedOutput(8, 1 << 20);
        o.push(Buffer.from('HEAD1234'));
        for (let i = 0; i < 1000; i += 1)
            o.push(Buffer.from('xxxxxxxxxx'));
        o.push(Buffer.from('TAIL5678'));
        const t = o.text();
        strict_1.default.ok(t.startsWith('HEAD1234'), t.slice(0, 40));
        strict_1.default.ok(t.endsWith('TAIL5678'), t.slice(-40));
        strict_1.default.match(t, /\[… 10000 bytes cortados da saída \(10016 no total\)/);
        strict_1.default.ok(t.length < 400, `bounded (${t.length})`);
    });
    (0, node_test_1.test)('o limite duro é sinalizado; a memória fica limitada ao começo e ao fim', () => {
        const o = new built_in_tools_1.BoundedOutput(1024, 64 * 1024);
        const chunk = Buffer.alloc(8 * 1024, 0x61);
        for (let i = 0; i < 20; i += 1)
            o.push(chunk);
        strict_1.default.equal(o.overLimit, true);
        strict_1.default.ok(o.text().length < 4 * 1024);
    });
});
