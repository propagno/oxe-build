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
const child_process_1 = require("child_process");
const git_worktree_1 = require("../src/workspace/strategies/git-worktree");
// Memória do projeto: `git worktree remove --force` com links de workspace (node_modules/@oxe/runtime → packages/
// runtime do repo principal) apagou o diretório REAL. O dispose desfaz os links que saem do worktree antes.
function linkDir(target, link) {
    fs_1.default.mkdirSync(path_1.default.dirname(link), { recursive: true });
    fs_1.default.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
(0, node_test_1.describe)('dispose seguro do git worktree', () => {
    (0, node_test_1.test)('unlinkExternalLinks remove só os links que saem do diretório, sem segui-los', () => {
        const base = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-wt-links-'));
        try {
            const outside = path_1.default.join(base, 'real-package');
            fs_1.default.mkdirSync(outside);
            fs_1.default.writeFileSync(path_1.default.join(outside, 'index.js'), 'precious\n');
            const root = path_1.default.join(base, 'wt');
            fs_1.default.mkdirSync(path_1.default.join(root, 'lib'), { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(root, 'lib', 'own.js'), 'own\n');
            linkDir(outside, path_1.default.join(root, 'node_modules', '@oxe', 'runtime'));
            linkDir(path_1.default.join(root, 'lib'), path_1.default.join(root, 'node_modules', 'local'));
            const removed = (0, git_worktree_1.unlinkExternalLinks)(root);
            strict_1.default.deepEqual(removed.map((p) => path_1.default.relative(root, p).replace(/\\/g, '/')), ['node_modules/@oxe/runtime']);
            strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(outside, 'index.js'), 'utf8'), 'precious\n', 'o alvo real ficou intacto');
            strict_1.default.ok(fs_1.default.existsSync(path_1.default.join(root, 'node_modules', 'local', 'own.js')), 'link interno ao worktree fica');
        }
        finally {
            fs_1.default.rmSync(base, { recursive: true, force: true });
        }
    });
    (0, node_test_1.test)('dispose de um worktree com link de workspace preserva o pacote real do repo', async () => {
        const repo = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'oxe-wt-repo-'));
        try {
            const git = (...args) => (0, child_process_1.execFileSync)('git', args, { cwd: repo, stdio: 'pipe' });
            git('init', '-q');
            git('config', 'user.email', 't@t');
            git('config', 'user.name', 't');
            fs_1.default.mkdirSync(path_1.default.join(repo, 'packages', 'runtime'), { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(repo, 'packages', 'runtime', 'index.js'), 'real runtime\n');
            fs_1.default.writeFileSync(path_1.default.join(repo, '.gitignore'), 'node_modules/\n.oxe/\n');
            git('add', '.');
            git('commit', '-qm', 'init');
            const manager = new git_worktree_1.GitWorktreeManager(repo);
            const lease = await manager.allocate({ work_item_id: 'T1', attempt_number: 1, strategy: 'git_worktree', mutation_scope: [] });
            linkDir(path_1.default.join(repo, 'packages', 'runtime'), path_1.default.join(lease.root_path, 'node_modules', '@oxe', 'runtime'));
            await manager.dispose(lease.workspace_id);
            strict_1.default.equal(fs_1.default.existsSync(lease.root_path), false, 'worktree removido');
            strict_1.default.equal(fs_1.default.readFileSync(path_1.default.join(repo, 'packages', 'runtime', 'index.js'), 'utf8'), 'real runtime\n', 'packages/runtime real intacto');
        }
        finally {
            fs_1.default.rmSync(repo, { recursive: true, force: true });
        }
    });
});
