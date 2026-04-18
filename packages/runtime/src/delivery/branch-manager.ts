import { execFileSync, spawnSync } from 'child_process';

export interface BranchInfo {
  name: string;
  current: boolean;
  commit: string;
}

export class BranchManager {
  constructor(private readonly projectRoot: string) {}

  currentBranch(): string {
    return this.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  }

  currentCommit(): string {
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  createSessionBranch(sessionId: string): string {
    const name = `oxe/${sessionId}`;
    this.git(['checkout', '-b', name]);
    return name;
  }

  createOxeBranch(name: string, base?: string): string {
    const fullName = name.startsWith('oxe/') ? name : `oxe/${name}`;
    if (base) {
      this.git(['checkout', '-b', fullName, base]);
    } else {
      this.git(['checkout', '-b', fullName]);
    }
    return fullName;
  }

  switchTo(branchName: string): void {
    this.git(['checkout', branchName]);
  }

  deleteBranch(name: string, force = false): void {
    const flag = force ? '-D' : '-d';
    this.git(['branch', flag, name]);
  }

  listOxeBranches(): BranchInfo[] {
    const raw = this.git(['branch', '--list', 'oxe/*', '--format=%(refname:short) %(objectname:short) %(HEAD)']);
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          name: parts[0],
          commit: parts[1] ?? '',
          current: parts[2] === '*',
        };
      });
  }

  mergeWorktreeBranch(worktreeBranch: string, targetBranch: string): void {
    const saved = this.currentBranch();
    try {
      this.git(['checkout', targetBranch]);
      this.git(['merge', '--no-ff', worktreeBranch, '-m', `oxe: merge ${worktreeBranch}`]);
    } finally {
      try { this.git(['checkout', saved]); } catch { /* best effort */ }
    }
  }

  branchExists(name: string): boolean {
    const result = spawnSync('git', ['rev-parse', '--verify', name], {
      cwd: this.projectRoot,
      encoding: 'utf8',
    });
    return result.status === 0;
  }

  private git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.projectRoot,
      encoding: 'utf8',
    });
  }
}
