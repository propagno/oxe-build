import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { GitWorktreeManager, unlinkExternalLinks } from '../src/workspace/strategies/git-worktree';

// Memória do projeto: `git worktree remove --force` com links de workspace (node_modules/@oxe/runtime → packages/
// runtime do repo principal) apagou o diretório REAL. O dispose desfaz os links que saem do worktree antes.

function linkDir(target: string, link: string) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('dispose seguro do git worktree', () => {
  test('unlinkExternalLinks remove só os links que saem do diretório, sem segui-los', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wt-links-'));
    try {
      const outside = path.join(base, 'real-package');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'index.js'), 'precious\n');
      const root = path.join(base, 'wt');
      fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'lib', 'own.js'), 'own\n');
      linkDir(outside, path.join(root, 'node_modules', '@oxe', 'runtime'));
      linkDir(path.join(root, 'lib'), path.join(root, 'node_modules', 'local'));
      const removed = unlinkExternalLinks(root);
      assert.deepEqual(removed.map((p) => path.relative(root, p).replace(/\\/g, '/')), ['node_modules/@oxe/runtime']);
      assert.equal(fs.readFileSync(path.join(outside, 'index.js'), 'utf8'), 'precious\n', 'o alvo real ficou intacto');
      assert.ok(fs.existsSync(path.join(root, 'node_modules', 'local', 'own.js')), 'link interno ao worktree fica');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('dispose de um worktree com link de workspace preserva o pacote real do repo', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-wt-repo-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
      git('init', '-q');
      git('config', 'user.email', 't@t');
      git('config', 'user.name', 't');
      fs.mkdirSync(path.join(repo, 'packages', 'runtime'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'packages', 'runtime', 'index.js'), 'real runtime\n');
      fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n.oxe/\n');
      git('add', '.');
      git('commit', '-qm', 'init');
      const manager = new GitWorktreeManager(repo);
      const lease = await manager.allocate({ work_item_id: 'T1', attempt_number: 1, strategy: 'git_worktree', mutation_scope: [] } as never);
      linkDir(path.join(repo, 'packages', 'runtime'), path.join(lease.root_path!, 'node_modules', '@oxe', 'runtime'));
      await manager.dispose(lease.workspace_id);
      assert.equal(fs.existsSync(lease.root_path!), false, 'worktree removido');
      assert.equal(fs.readFileSync(path.join(repo, 'packages', 'runtime', 'index.js'), 'utf8'), 'real runtime\n', 'packages/runtime real intacto');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
