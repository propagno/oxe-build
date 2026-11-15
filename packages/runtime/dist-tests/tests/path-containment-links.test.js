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
// External review 15/11 (P0-2): resolveWithin compared lexical paths only; a junction or a symlink inside the
// workspace (the runtime links node_modules into worktrees) let a tool reach a file outside it.
(0, node_test_1.describe)('path containment through links', () => {
    (0, node_test_1.test)('a path through a junction/symlink that leaves the workspace is refused; a plain inner path is not', () => {
        const base = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-contain-'));
        try {
            const ws = path_1.default.join(base, 'ws');
            const outside = path_1.default.join(base, 'outside');
            fs_1.default.mkdirSync(path_1.default.join(ws, 'src'), { recursive: true });
            fs_1.default.mkdirSync(outside, { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(outside, 'secret.txt'), 'x');
            fs_1.default.symlinkSync(outside, path_1.default.join(ws, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(ws, 'link/secret.txt'), built_in_tools_1.PathContainmentError);
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(ws, 'link/new-file.txt'), built_in_tools_1.PathContainmentError, 'a new file through the link too');
            strict_1.default.equal((0, built_in_tools_1.resolveWithin)(ws, 'src/a.ts'), path_1.default.join(ws, 'src', 'a.ts'));
            strict_1.default.equal((0, built_in_tools_1.resolveWithin)(ws, 'src/not-yet/b.ts'), path_1.default.join(ws, 'src', 'not-yet', 'b.ts'));
            strict_1.default.throws(() => (0, built_in_tools_1.resolveWithin)(ws, '../outside/secret.txt'), built_in_tools_1.PathContainmentError);
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('realPathOf of a path that does not exist yet resolves its nearest existing ancestor', () => {
        const base = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-realp-'));
        try {
            const real = fs_1.default.realpathSync.native(base);
            strict_1.default.equal((0, built_in_tools_1.realPathOf)(path_1.default.join(base, 'a', 'b.txt')), path_1.default.join(real, 'a', 'b.txt'));
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
});
