"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRManager = void 0;
const child_process_1 = require("child_process");
function isGhAvailable(cwd) {
    const result = (0, child_process_1.spawnSync)('gh', ['--version'], { cwd, encoding: 'utf8' });
    return result.status === 0;
}
class PRManager {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    isAvailable() {
        return isGhAvailable(this.projectRoot);
    }
    createDraft(opts) {
        if (!this.isAvailable()) {
            return { success: false, error: 'gh CLI not available — install from https://cli.github.com' };
        }
        const args = [
            'pr', 'create',
            '--title', opts.title,
            '--body', opts.body,
        ];
        if (opts.draft !== false)
            args.push('--draft');
        if (opts.base)
            args.push('--base', opts.base);
        if (opts.head)
            args.push('--head', opts.head);
        const result = (0, child_process_1.spawnSync)('gh', args, {
            cwd: this.projectRoot,
            encoding: 'utf8',
        });
        if (result.status !== 0) {
            return { success: false, error: result.stderr?.trim() ?? 'gh pr create failed' };
        }
        const url = result.stdout?.trim();
        return { success: true, url };
    }
    view(prNumberOrUrl) {
        if (!this.isAvailable()) {
            return { success: false, error: 'gh CLI not available' };
        }
        const result = (0, child_process_1.spawnSync)('gh', ['pr', 'view', String(prNumberOrUrl), '--json', 'number,title,url,state,isDraft,headRefName,baseRefName'], { cwd: this.projectRoot, encoding: 'utf8' });
        if (result.status !== 0) {
            return { success: false, error: result.stderr?.trim() };
        }
        try {
            const raw = JSON.parse(result.stdout);
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
        }
        catch {
            return { success: false, error: 'Failed to parse gh output' };
        }
    }
    mergePR(prNumber, method = 'merge') {
        if (!this.isAvailable()) {
            return { success: false, error: 'gh CLI not available' };
        }
        const result = (0, child_process_1.spawnSync)('gh', ['pr', 'merge', String(prNumber), `--${method}`, '--delete-branch'], {
            cwd: this.projectRoot,
            encoding: 'utf8',
        });
        return result.status === 0
            ? { success: true }
            : { success: false, error: result.stderr?.trim() };
    }
}
exports.PRManager = PRManager;
