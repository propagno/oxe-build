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
const built_in_tools_1 = require("../src/executor/built-in-tools");
(0, node_test_1.describe)('built-in tools — contenção de caminhos ao workspace', () => {
    let outer;
    let workspace;
    (0, node_test_1.test)('setup', () => {
        outer = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-contain-'));
        workspace = path_1.default.join(outer, 'ws');
        fs_1.default.mkdirSync(path_1.default.join(workspace, 'src'), { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(workspace, 'src', 'a.txt'), 'hello\n', 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outer, 'secret.txt'), 'top secret\n', 'utf8');
    });
    (0, node_test_1.test)('resolveWithin aceita caminhos relativos dentro do workspace e recusa escapes', () => {
        strict_1.default.equal((0, built_in_tools_1.resolveWithin)(workspace, 'src/a.txt'), path_1.default.join(workspace, 'src', 'a.txt'));
        strict_1.default.equal((0, built_in_tools_1.resolveWithin)(workspace, '.'), path_1.default.resolve(workspace));
        strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(workspace, '../secret.txt'), built_in_tools_1.PathContainmentError);
        strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(workspace, path_1.default.join(outer, 'secret.txt')), built_in_tools_1.PathContainmentError);
    });
    (0, node_test_1.test)('read_file não lê fora do workspace', async () => {
        await strict_1.default.rejects(() => built_in_tools_1.BUILT_IN_TOOLS.read_file.execute({ path: '../secret.txt' }, workspace), built_in_tools_1.PathContainmentError);
        strict_1.default.equal(await built_in_tools_1.BUILT_IN_TOOLS.read_file.execute({ path: 'src/a.txt' }, workspace), 'hello\n');
    });
    (0, node_test_1.test)('write_file e patch_file não escrevem fora do workspace', async () => {
        await strict_1.default.rejects(() => built_in_tools_1.BUILT_IN_TOOLS.write_file.execute({ path: '../escaped.txt', content: 'x' }, workspace), built_in_tools_1.PathContainmentError);
        strict_1.default.equal(fs_1.default.existsSync(path_1.default.join(outer, 'escaped.txt')), false);
        await strict_1.default.rejects(() => built_in_tools_1.BUILT_IN_TOOLS.patch_file.execute({ path: '../secret.txt', old_string: 'top', new_string: 'no' }, workspace), built_in_tools_1.PathContainmentError);
        strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(outer, 'secret.txt'), 'utf8'), 'top secret\n');
    });
    (0, node_test_1.test)('grep e glob não saem do workspace', async () => {
        await strict_1.default.rejects(() => built_in_tools_1.BUILT_IN_TOOLS.grep.execute({ pattern: 'secret', path: '..' }, workspace), built_in_tools_1.PathContainmentError);
        strict_1.default.equal(await built_in_tools_1.BUILT_IN_TOOLS.glob.execute({ pattern: '../*.txt' }, workspace), '(no files matched)');
        strict_1.default.equal(await built_in_tools_1.BUILT_IN_TOOLS.glob.execute({ pattern: 'src/*.txt' }, workspace), 'src/a.txt');
    });
    (0, node_test_1.test)('teardown', () => {
        fs_1.default.rmSync(outer, { recursive: true, force: true });
    });
});
