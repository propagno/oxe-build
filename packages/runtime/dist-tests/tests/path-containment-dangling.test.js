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
// Cross-review 15/11: a DANGLING link (target not created yet) failed realpath; realPathOf climbed past it and
// answered "inside the workspace" while the write followed the link out. Glob/grep never walk into links.
function tmp(prefix) { return fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), prefix)); }
(0, node_test_1.describe)('path containment: dangling links, case, walkers', () => {
    (0, node_test_1.test)('a dangling junction/dir link to outside is refused, and nothing is created outside', async () => {
        const base = tmp('oxe-dangle-');
        try {
            const ws = path_1.default.join(base, 'ws');
            fs_1.default.mkdirSync(ws, { recursive: true });
            const target = path_1.default.join(base, 'outside-not-yet');
            fs_1.default.symlinkSync(target, path_1.default.join(ws, 'out'), process.platform === 'win32' ? 'junction' : 'dir');
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(ws, 'out/pwned.txt'), built_in_tools_1.PathContainmentError);
            strict_1.default.equal(path_1.default.relative((0, built_in_tools_1.samePathKey)((0, built_in_tools_1.realPathOf)(path_1.default.join(ws, 'out', 'pwned.txt'))), (0, built_in_tools_1.samePathKey)(path_1.default.join(target, 'pwned.txt'))), '');
            const r = await built_in_tools_1.BUILT_IN_TOOLS.write_file.execute({ path: 'out/pwned.txt', content: 'x' }, ws).catch((e) => `[err] ${e.message}`);
            strict_1.default.ok(!fs_1.default.existsSync(path_1.default.join(target, 'pwned.txt')), `nothing written outside (${String(r).slice(0, 80)})`);
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('a dangling file symlink to outside is refused (skipped where symlinks need privileges)', (t) => {
        const base = tmp('oxe-dangle-f-');
        try {
            const ws = path_1.default.join(base, 'ws');
            fs_1.default.mkdirSync(ws, { recursive: true });
            try {
                fs_1.default.symlinkSync(path_1.default.join(base, 'pwned.txt'), path_1.default.join(ws, 'out-link'), 'file');
            }
            catch {
                t.skip('no symlink privilege');
                return;
            }
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(ws, 'out-link'), built_in_tools_1.PathContainmentError);
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('a link loop does not hang', (t) => {
        const base = tmp('oxe-loop-');
        try {
            try {
                fs_1.default.symlinkSync(path_1.default.join(base, 'b'), path_1.default.join(base, 'a'), 'file');
                fs_1.default.symlinkSync(path_1.default.join(base, 'a'), path_1.default.join(base, 'b'), 'file');
            }
            catch {
                t.skip('no symlink privilege');
                return;
            }
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(base, 'a'));
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('samePathKey folds case only on case-insensitive platforms', () => {
        const k = (0, built_in_tools_1.samePathKey)('C:/Src/A.TS');
        if (process.platform === 'win32' || process.platform === 'darwin')
            strict_1.default.equal(k, 'c:/src/a.ts');
        else
            strict_1.default.equal(k, 'C:/Src/A.TS');
    });
    (0, node_test_1.test)('glob and grep do not walk into a link that leaves the workspace', async () => {
        const base = tmp('oxe-walk-');
        try {
            const ws = path_1.default.join(base, 'ws');
            const outside = path_1.default.join(base, 'outside');
            fs_1.default.mkdirSync(path_1.default.join(ws, 'src'), { recursive: true });
            fs_1.default.mkdirSync(outside, { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(ws, 'src', 'in.txt'), 'needle inside');
            fs_1.default.writeFileSync(path_1.default.join(outside, 'secret.txt'), 'needle outside');
            fs_1.default.symlinkSync(outside, path_1.default.join(ws, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
            const g = await built_in_tools_1.BUILT_IN_TOOLS.grep.execute({ pattern: 'needle' }, ws);
            strict_1.default.match(String(g), /in\.txt/);
            strict_1.default.doesNotMatch(String(g), /secret/);
            const gl = await built_in_tools_1.BUILT_IN_TOOLS.glob.execute({ pattern: '**/*.txt' }, ws);
            strict_1.default.match(String(gl), /src\/in\.txt/);
            strict_1.default.doesNotMatch(String(gl), /secret/);
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
});
