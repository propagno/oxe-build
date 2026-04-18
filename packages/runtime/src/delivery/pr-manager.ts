import { spawnSync } from 'child_process';

export interface PRDraftOptions {
  title: string;
  body: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  head: string;
  base: string;
}

export interface PRResult {
  success: boolean;
  url?: string;
  error?: string;
  pr?: PRInfo;
}

function isGhAvailable(cwd: string): boolean {
  const result = spawnSync('gh', ['--version'], { cwd, encoding: 'utf8' });
  return result.status === 0;
}

export class PRManager {
  constructor(private readonly projectRoot: string) {}

  isAvailable(): boolean {
    return isGhAvailable(this.projectRoot);
  }

  createDraft(opts: PRDraftOptions): PRResult {
    if (!this.isAvailable()) {
      return { success: false, error: 'gh CLI not available — install from https://cli.github.com' };
    }
    const args = [
      'pr', 'create',
      '--title', opts.title,
      '--body', opts.body,
    ];
    if (opts.draft !== false) args.push('--draft');
    if (opts.base) args.push('--base', opts.base);
    if (opts.head) args.push('--head', opts.head);

    const result = spawnSync('gh', args, {
      cwd: this.projectRoot,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      return { success: false, error: result.stderr?.trim() ?? 'gh pr create failed' };
    }
    const url = result.stdout?.trim();
    return { success: true, url };
  }

  view(prNumberOrUrl: string | number): PRResult {
    if (!this.isAvailable()) {
      return { success: false, error: 'gh CLI not available' };
    }
    const result = spawnSync(
      'gh',
      ['pr', 'view', String(prNumberOrUrl), '--json', 'number,title,url,state,isDraft,headRefName,baseRefName'],
      { cwd: this.projectRoot, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      return { success: false, error: result.stderr?.trim() };
    }
    try {
      const raw = JSON.parse(result.stdout) as {
        number: number; title: string; url: string; state: string;
        isDraft: boolean; headRefName: string; baseRefName: string;
      };
      return {
        success: true,
        url: raw.url,
        pr: {
          number: raw.number,
          title: raw.title,
          url: raw.url,
          state: raw.state.toLowerCase(),
          draft: raw.isDraft,
          head: raw.headRefName,
          base: raw.baseRefName,
        },
      };
    } catch {
      return { success: false, error: 'Failed to parse gh output' };
    }
  }

  mergePR(prNumber: number, method: 'merge' | 'squash' | 'rebase' = 'merge'): PRResult {
    if (!this.isAvailable()) {
      return { success: false, error: 'gh CLI not available' };
    }
    const result = spawnSync('gh', ['pr', 'merge', String(prNumber), `--${method}`, '--delete-branch'], {
      cwd: this.projectRoot,
      encoding: 'utf8',
    });
    return result.status === 0
      ? { success: true }
      : { success: false, error: result.stderr?.trim() };
  }
}
