"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BranchManager = void 0;
const child_process_1 = require("child_process");
class BranchManager {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    currentBranch() {
        return this.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    }
    currentCommit() {
        return this.git(['rev-parse', 'HEAD']).trim();
    }
    createSessionBranch(sessionId) {
        const name = `oxe/${sessionId}`;
        this.git(['checkout', '-b', name]);
        return name;
    }
    createOxeBranch(name, base) {
        const fullName = name.startsWith('oxe/') ? name : `oxe/${name}`;
        if (base) {
            this.git(['checkout', '-b', fullName, base]);
        }
        else {
            this.git(['checkout', '-b', fullName]);
        }
        return fullName;
    }
    switchTo(branchName) {
        this.git(['checkout', branchName]);
    }
    deleteBranch(name, force = false) {
        const flag = force ? '-D' : '-d';
        this.git(['branch', flag, name]);
    }
    listOxeBranches() {
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
    mergeWorktreeBranch(worktreeBranch, targetBranch) {
        const saved = this.currentBranch();
        try {
            this.git(['checkout', targetBranch]);
            this.git(['merge', '--no-ff', worktreeBranch, '-m', `oxe: merge ${worktreeBranch}`]);
        }
        finally {
            try {
                this.git(['checkout', saved]);
            }
            catch { /* best effort */ }
        }
    }
    branchExists(name) {
        const result = (0, child_process_1.spawnSync)('git', ['rev-parse', '--verify', name], {
            cwd: this.projectRoot,
            encoding: 'utf8',
        });
        return result.status === 0;
    }
    git(args) {
        return (0, child_process_1.execFileSync)('git', args, {
            cwd: this.projectRoot,
            encoding: 'utf8',
        });
    }
}
exports.BranchManager = BranchManager;
